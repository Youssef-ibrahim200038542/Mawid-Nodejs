// Durable delivery of account emails (email verification, password reset, account notices).
//
// Each auth_tokens row is ONE delivery generation. States (delivery_status):
//   QUEUED     generation stored; the provider has not been called for it. next_retry_at = grace end.
//   SENDING    a provider attempt started: send_attempts was incremented in the same UPDATE that
//              claimed the row. next_retry_at = lease end.
//   SENT / SKIPPED / FAILED        final outcome reported by the provider (FAILED = permanent).
//   RETRYABLE  transient provider failure; next_retry_at = backoff end.
//   REPLACED   closed: a newer generation took over, or the message is no longer needed.
//
// send_attempts counts ACTUAL provider calls for the whole chain (copied to replacements), capped at
// MAX_SEND_ATTEMPTS. A generation that was created but never sent never counts as an attempt and is
// never marked FAILED; it is regenerated (the raw token only ever lived in the crashed process).
//
// Recovery (startup + every minute) picks open rows whose next_retry_at passed. In ONE transaction
// it locks the user row then the token row (the same order every account flow uses), re-checks
// everything, closes the old row and inserts the replacement generation (new raw token, old token
// invalidated). Only after COMMIT is the replacement sent. A crash before the commit leaves the
// old row untouched and due; a crash after it leaves the QUEUED replacement due. Nothing is lost.
// Delivery is at-least-once: a provider may accept a message and the process die before the
// callback is stored; the lease then expires and a replacement (with a new token, the old one
// invalidated) is sent, so the recipient can get two emails and only the newest link works.
//
// Every callback UPDATE is conditional on (id, token_hash, delivery_status = 'SENDING'), so a late
// callback from an older generation or a replaced row can never overwrite newer state.
const prisma = require("../../config/database");
const logger = require("../../lib/logger");
const background = require("../../lib/background-work");
const { generateToken, unusableTokenHash } = require("../../lib/tokens");
const { deliver } = require("../notifications/email-provider");
const { buildAuthEmail } = require("./auth.emails");

const MAX_SEND_ATTEMPTS = 3;
const QUEUED_GRACE_MS = 60_000;
const SENDING_LEASE_MS = 120_000;
const RETRY_BACKOFF_MS = [60_000, 300_000];
const HOUR = 3_600_000;
const TOKEN_TTL_MS = { EMAIL_VERIFY: 24 * HOUR, PASSWORD_RESET: HOUR, ACCOUNT_NOTICE: 24 * HOUR };
const openStatuses = ["QUEUED", "SENDING", "RETRYABLE"];

const isActionable = (purpose) => purpose !== "ACCOUNT_NOTICE";
const at = (date, ms) => new Date(date.getTime() + ms);

// Creates a QUEUED generation inside the caller's transaction. For ACCOUNT_NOTICE the row is
// born consumed (reason NOTICE) with a hash that matches no raw token, so it can never be redeemed.
async function createGeneration(tx, { userId, purpose, email, now, chainStartedAt = now, sendAttempts = 0, replacesTokenId = null }) {
    const notice = !isActionable(purpose);
    const token = notice ? { raw: null, hash: unusableTokenHash() } : generateToken();
    const row = await tx.authToken.create({
        data: {
            userId,
            purpose,
            email,
            tokenHash: token.hash,
            createdAt: now,
            expiresAt: at(now, TOKEN_TTL_MS[purpose]),
            consumedAt: notice ? now : null,
            consumedReason: notice ? "NOTICE" : null,
            chainStartedAt,
            replacesTokenId,
            sendAttempts,
            deliveryStatus: "QUEUED",
            nextRetryAt: at(now, QUEUED_GRACE_MS),
        },
        select: { id: true },
    });
    return { id: row.id, tokenHash: token.hash, purpose, userId, raw: token.raw };
}

// Invalidates every open token of these purposes and closes their open deliveries.
// Always issues the same two statements (keeps signup / reset timing uniform).
async function supersedeOpen(tx, userId, purposes, now) {
    await tx.authToken.updateMany({
        where: { userId, purpose: { in: purposes.filter(isActionable) }, consumedAt: null },
        data: { consumedAt: now, consumedReason: "SUPERSEDED" },
    });
    await tx.authToken.updateMany({
        where: { userId, purpose: { in: purposes }, deliveryStatus: { in: openStatuses } },
        data: { deliveryStatus: "REPLACED", nextRetryAt: null, deliveryError: "SUPERSEDED" },
    });
}

// Maps a provider outcome to the row's next state. attempts = send_attempts including this one.
function outcomeData(outcome, attempts, when) {
    switch (outcome.status) {
        case "SENT":
            return { deliveryStatus: "SENT", nextRetryAt: null, deliveryError: null };
        case "SKIPPED":
            return { deliveryStatus: "SKIPPED", nextRetryAt: null, deliveryError: null };
        case "FAILED":
            return { deliveryStatus: "FAILED", nextRetryAt: null, deliveryError: outcome.code || "PERMANENT" };
        default:
            if (attempts >= MAX_SEND_ATTEMPTS) return { deliveryStatus: "FAILED", nextRetryAt: null, deliveryError: "MAX_ATTEMPTS" };
            return { deliveryStatus: "RETRYABLE", nextRetryAt: at(when, RETRY_BACKOFF_MS[attempts - 1] ?? RETRY_BACKOFF_MS.at(-1)), deliveryError: outcome.code || "RETRYABLE" };
    }
}

// Claims a QUEUED generation (QUEUED → SENDING, send_attempts + 1) and sends it.
// Returns the final delivery status, or null when another process already claimed/closed it.
async function sendGeneration(generation, { db = prisma, clock = () => new Date(), deliverFn = deliver } = {}) {
    const startedAt = clock();
    const claimed = await db.authToken.updateMany({
        where: { id: generation.id, tokenHash: generation.tokenHash, deliveryStatus: "QUEUED", sendAttempts: { lt: MAX_SEND_ATTEMPTS } },
        data: { deliveryStatus: "SENDING", sendAttempts: { increment: 1 }, nextRetryAt: at(startedAt, SENDING_LEASE_MS) },
    });
    if (claimed.count !== 1) return null;

    const row = await db.authToken.findUnique({
        where: { id: generation.id },
        select: { email: true, sendAttempts: true, user: { select: { name: true, locale: true } } },
    });
    const message = buildAuthEmail({ purpose: generation.purpose, locale: row.user.locale, name: row.user.name, raw: generation.raw });
    const outcome = await deliverFn({ to: row.email, subject: message.subject, text: message.text, purpose: generation.purpose });
    const data = outcomeData(outcome, row.sendAttempts, clock());
    const stored = await db.authToken.updateMany({
        where: { id: generation.id, tokenHash: generation.tokenHash, deliveryStatus: "SENDING" },
        data,
    });
    if (stored.count !== 1) return null;
    if (data.deliveryStatus === "FAILED" || data.deliveryStatus === "RETRYABLE") {
        logger.warn({ tokenId: generation.id, purpose: generation.purpose, code: data.deliveryError }, "Account email delivery failed");
    }
    return data.deliveryStatus;
}

// Fire-and-track after the transaction committed (signup, forgot password).
function dispatchAfterCommit(generation) {
    if (!generation) return;
    background.runAfterResponse(() => sendGeneration(generation));
}

// Pure decision for one due, open row. `user` is the locked user row (null if gone).
function decideRecovery(row, user, { now, hasNewer }) {
    if (!openStatuses.includes(row.deliveryStatus) || !user) return { action: "skip" };
    if (row.chainStartedAt.getTime() + TOKEN_TTL_MS[row.purpose] <= now.getTime()) return { action: "close", reason: "EXPIRED" };
    if (row.email !== user.email) return { action: "close", reason: "EMAIL_CHANGED" };
    if (hasNewer) return { action: "close", reason: "SUPERSEDED" };
    // Only actionable tokens can be used up; an ACCOUNT_NOTICE is always born "consumed" and
    // that must not make it look obsolete.
    if (isActionable(row.purpose)) {
        if (row.consumedAt) return { action: "close", reason: "CONSUMED" };
        if (row.purpose === "EMAIL_VERIFY" && user.emailVerifiedAt) return { action: "close", reason: "ALREADY_VERIFIED" };
    }
    // A QUEUED row was never sent, so it never exhausts attempts. SENDING (lease expired) and
    // RETRYABLE rows already used send_attempts real attempts.
    if (row.deliveryStatus !== "QUEUED" && row.sendAttempts >= MAX_SEND_ATTEMPTS) return { action: "fail", reason: "MAX_ATTEMPTS" };
    return { action: "regenerate" };
}

async function closeRow(tx, row, { now, status, reason }) {
    const consume = isActionable(row.purpose) && !row.consumedAt;
    await tx.authToken.updateMany({
        where: { id: row.id, tokenHash: row.tokenHash, deliveryStatus: { in: openStatuses } },
        data: {
            deliveryStatus: status,
            nextRetryAt: null,
            deliveryError: reason,
            ...(consume ? { consumedAt: now, consumedReason: reason === "EMAIL_CHANGED" ? "EMAIL_CHANGED" : "SUPERSEDED" } : {}),
        },
    });
}

// One recovery step for one candidate. Returns a new generation to send (after commit) or null.
async function recoverOne(candidate, { db = prisma, clock = () => new Date() } = {}) {
    return db.$transaction(
        async (tx) => {
            const now = clock();
            const users = await tx.$queryRaw`SELECT id, email, email_verified_at AS emailVerifiedAt FROM users WHERE id = ${candidate.userId} FOR UPDATE`;
            const locked = await tx.$queryRaw`SELECT id FROM auth_tokens WHERE id = ${candidate.id} FOR UPDATE`;
            if (locked.length === 0) return null;
            const row = await tx.authToken.findUnique({
                where: { id: candidate.id },
                select: { id: true, userId: true, purpose: true, email: true, tokenHash: true, consumedAt: true, chainStartedAt: true, sendAttempts: true, deliveryStatus: true, nextRetryAt: true },
            });
            if (!row || !openStatuses.includes(row.deliveryStatus) || !row.nextRetryAt || row.nextRetryAt > now) return null;
            const newer = await tx.authToken.count({ where: { userId: row.userId, purpose: row.purpose, id: { gt: row.id } } });
            const decision = decideRecovery(row, users[0] ?? null, { now, hasNewer: newer > 0 });

            if (decision.action === "skip") return null;
            if (decision.action === "close") {
                await closeRow(tx, row, { now, status: "REPLACED", reason: decision.reason });
                return null;
            }
            if (decision.action === "fail") {
                await tx.authToken.updateMany({
                    where: { id: row.id, tokenHash: row.tokenHash, deliveryStatus: { in: openStatuses } },
                    data: { deliveryStatus: "FAILED", nextRetryAt: null, deliveryError: decision.reason },
                });
                return null;
            }
            await closeRow(tx, row, { now, status: "REPLACED", reason: "RECOVERED" });
            return createGeneration(tx, {
                userId: row.userId,
                purpose: row.purpose,
                email: row.email,
                now,
                chainStartedAt: row.chainStartedAt,
                sendAttempts: row.sendAttempts,
                replacesTokenId: row.id,
            });
        },
        { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 }
    );
}

function sqlDateTime(date) {
    return date.toISOString().replace("T", " ").replace("Z", "");
}

// Rate buckets are fixed one-hour windows; keep two hours, delete in small batches.
async function cleanupRateBuckets(db, now) {
    const cutoff = sqlDateTime(at(now, -2 * HOUR));
    await db.$executeRaw`DELETE FROM auth_rate_buckets WHERE window_start < ${cutoff} LIMIT 500`;
}

let timer = null;
let stopping = false;
let running = null;

async function runRecoveryPass({ db = prisma, clock = () => new Date(), limit = 20, deliverFn = deliver } = {}) {
    const candidates = await db.authToken.findMany({
        where: { deliveryStatus: { in: openStatuses }, nextRetryAt: { lte: clock() } },
        select: { id: true, userId: true },
        orderBy: { nextRetryAt: "asc" },
        take: limit,
    });
    let regenerated = 0;
    for (const candidate of candidates) {
        if (stopping) break;
        const generation = await recoverOne(candidate, { db, clock });
        if (generation) {
            regenerated += 1;
            await sendGeneration(generation, { db, clock, deliverFn });
        }
    }
    if (!stopping) await cleanupRateBuckets(db, clock());
    return { candidates: candidates.length, regenerated };
}

function startDeliveryRecovery({ intervalMs = 60_000 } = {}) {
    stopping = false;
    const tick = () => {
        if (stopping || running) return;
        running = runRecoveryPass()
            .catch((error) => logger.warn({ err: { name: error.name, code: error.code } }, "Delivery recovery pass failed"))
            .finally(() => {
                running = null;
            });
    };
    tick();
    timer = setInterval(tick, intervalMs);
    timer.unref();
}

// Stops claiming new rows and waits for the row in progress (bounded by the provider timeout).
async function stopDeliveryRecovery() {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
}

module.exports = {
    MAX_SEND_ATTEMPTS,
    QUEUED_GRACE_MS,
    SENDING_LEASE_MS,
    RETRY_BACKOFF_MS,
    TOKEN_TTL_MS,
    openStatuses,
    createGeneration,
    supersedeOpen,
    outcomeData,
    sendGeneration,
    dispatchAfterCommit,
    decideRecovery,
    recoverOne,
    runRecoveryPass,
    startDeliveryRecovery,
    stopDeliveryRecovery,
    sqlDateTime,
};
