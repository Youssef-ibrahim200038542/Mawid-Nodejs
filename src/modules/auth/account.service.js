// Account security: signup, email verification, password reset and the login snapshot check.
// Shared by the JSON API (auth.api.routes.js) and the legacy EJS pages (auth.controller.js).
//
// Anti-enumeration: signup and forgot-password always do their database work before answering,
// commit in every branch (the per-email rate bucket is written for every request), send email only
// after the commit, and answer no sooner than RESPONSE_FLOOR_MS, so neither the response nor its
// timing says whether the address has an account.
const bcrypt = require("bcrypt");
const prisma = require("../../config/database");
const { AppError } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const { hashToken, isWellFormedToken } = require("../../lib/tokens");
const { takeEmailQuota } = require("./rate-buckets");
const delivery = require("./auth-delivery");

const BCRYPT_COST = 12;
const RESPONSE_FLOOR_MS = 400;
const SIGNUP_EMAILS_PER_HOUR = 3;
const RESET_EMAILS_PER_HOUR = 3;
const RESEND_COOLDOWN_MS = 60_000;
const txOptions = { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 };

const tokenInvalid = () => new AppError(400, "TOKEN_INVALID", "This link is invalid or has expired. Request a new one.");

async function waitForFloor(startedAt, floorMs = RESPONSE_FLOOR_MS) {
    const remaining = startedAt + floorMs - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

// Creates the account if the email is new; otherwise leaves the existing account untouched and
// queues an "account notice" (verified) or a fresh verification link (unverified).
async function register({ name, email, password, locale = "en", ipAddress = null }, { floorMs = RESPONSE_FLOOR_MS } = {}) {
    const startedAt = Date.now();
    try {
        const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
        const generation = await prisma.$transaction(async (tx) => {
            const now = new Date();
            const allowed = await takeEmailQuota(tx, { kind: "SIGNUP", email, limit: SIGNUP_EMAILS_PER_HOUR, now });
            // No-op for an existing address: `id = id` changes nothing on that row.
            await tx.$executeRaw`
                INSERT INTO users (name, email, password_hash, locale) VALUES (${name}, ${email}, ${passwordHash}, ${locale})
                ON DUPLICATE KEY UPDATE id = id
            `;
            const rows = await tx.$queryRaw`
                SELECT id, password_hash AS passwordHash, email_verified_at AS emailVerifiedAt FROM users WHERE email = ${email} FOR UPDATE
            `;
            const user = rows[0];
            // A fresh bcrypt hash has a random salt: it equals the stored hash only if we just inserted it.
            const created = user.passwordHash === passwordHash;
            // Over the per-email limit: no new email and no change to the earlier links. (The limit
            // is per address whether or not it has an account, so this branch reveals nothing.)
            if (!allowed) return null;
            await delivery.supersedeOpen(tx, user.id, ["EMAIL_VERIFY", "ACCOUNT_NOTICE"], now);
            const purpose = !created && user.emailVerifiedAt ? "ACCOUNT_NOTICE" : "EMAIL_VERIFY";
            const generation = await delivery.createGeneration(tx, { userId: user.id, purpose, email, now });
            await recordAudit(tx, {
                actorUserId: created ? user.id : null,
                action: created ? "auth.signup_requested" : "auth.signup_existing_email",
                targetType: "user",
                targetId: user.id,
                metadata: { email: purpose === "EMAIL_VERIFY" ? "verification" : "notice" },
                ipAddress,
            });
            return generation;
        }, txOptions);
        delivery.dispatchAfterCommit(generation);
    } finally {
        await waitForFloor(startedAt, floorMs);
    }
}

async function requestPasswordReset({ email, ipAddress = null }, { floorMs = RESPONSE_FLOOR_MS } = {}) {
    const startedAt = Date.now();
    try {
        const generation = await prisma.$transaction(async (tx) => {
            const now = new Date();
            const allowed = await takeEmailQuota(tx, { kind: "PASSWORD_RESET", email, limit: RESET_EMAILS_PER_HOUR, now });
            const rows = await tx.$queryRaw`SELECT id FROM users WHERE email = ${email} FOR UPDATE`;
            if (rows.length === 0 || !allowed) return null;
            const userId = rows[0].id;
            await delivery.supersedeOpen(tx, userId, ["PASSWORD_RESET"], now);
            const generation = await delivery.createGeneration(tx, { userId, purpose: "PASSWORD_RESET", email, now });
            await recordAudit(tx, { actorUserId: null, action: "auth.password_reset_requested", targetType: "user", targetId: userId, ipAddress });
            return generation;
        }, txOptions);
        delivery.dispatchAfterCommit(generation);
    } finally {
        await waitForFloor(startedAt, floorMs);
    }
}

// Looks a token up by hash, then (in a transaction holding the user row) checks it is still the
// right purpose, unconsumed, unexpired and issued for the account's CURRENT email, and consumes it
// atomically. Returns { user, now } inside `work`'s transaction.
async function consumeToken(raw, purpose, work) {
    if (!isWellFormedToken(raw)) throw tokenInvalid();
    const tokenHash = hashToken(raw);
    const found = await prisma.authToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true, purpose: true } });
    if (!found || found.purpose !== purpose) throw tokenInvalid();

    const outcome = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const users = await tx.$queryRaw`SELECT id, email, email_verified_at AS emailVerifiedAt FROM users WHERE id = ${found.userId} FOR UPDATE`;
        if (users.length === 0) return { ok: false };
        const user = users[0];
        const token = await tx.authToken.findUnique({ where: { id: found.id }, select: { email: true, consumedAt: true, expiresAt: true } });
        if (!token || token.consumedAt || token.expiresAt <= now) return { ok: false };
        if (token.email !== user.email) {
            await tx.authToken.updateMany({ where: { id: found.id, consumedAt: null }, data: { consumedAt: now, consumedReason: "EMAIL_CHANGED" } });
            return { ok: false };
        }
        const consumed = await tx.authToken.updateMany({
            where: { id: found.id, tokenHash, purpose, consumedAt: null, expiresAt: { gt: now } },
            data: { consumedAt: now, consumedReason: "USED" },
        });
        if (consumed.count !== 1) return { ok: false };
        return { ok: true, value: await work(tx, user, now) };
    }, txOptions);
    if (!outcome.ok) throw tokenInvalid();
    return outcome.value;
}

async function verifyEmail(raw, { ipAddress = null } = {}) {
    await consumeToken(raw, "EMAIL_VERIFY", async (tx, user, now) => {
        if (!user.emailVerifiedAt) {
            await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
        }
        await delivery.supersedeOpen(tx, user.id, ["EMAIL_VERIFY"], now);
        await recordAudit(tx, { actorUserId: user.id, action: "auth.email_verified", targetType: "user", targetId: user.id, ipAddress });
    });
}

async function resendVerification(userId, { ipAddress = null } = {}) {
    const generation = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const users = await tx.$queryRaw`SELECT id, email, email_verified_at AS emailVerifiedAt FROM users WHERE id = ${userId} FOR UPDATE`;
        if (users.length === 0) throw new AppError(401, "UNAUTHENTICATED", "Log in to continue.");
        const user = users[0];
        if (user.emailVerifiedAt) throw new AppError(409, "ALREADY_VERIFIED", "Your email address is already confirmed.");
        const latest = await tx.authToken.findFirst({
            where: { userId, purpose: "EMAIL_VERIFY" },
            orderBy: { id: "desc" },
            select: { createdAt: true, deliveryStatus: true },
        });
        const failed = latest && ["FAILED", "RETRYABLE"].includes(latest.deliveryStatus);
        if (latest && !failed && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
            const retryAfterSeconds = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime())) / 1000);
            throw new AppError(429, "VERIFICATION_COOLDOWN", "Wait a minute before asking for another email.", { retryAfterSeconds });
        }
        await delivery.supersedeOpen(tx, userId, ["EMAIL_VERIFY"], now);
        const generation = await delivery.createGeneration(tx, { userId, purpose: "EMAIL_VERIFY", email: user.email, now });
        await recordAudit(tx, { actorUserId: userId, action: "auth.email_verification_sent", targetType: "user", targetId: userId, ipAddress });
        return generation;
    }, txOptions);
    // The caller is logged in and asked for it: wait for the provider and report honestly.
    const status = await delivery.sendGeneration(generation);
    return deliveryLabel(status);
}

function deliveryLabel(status) {
    if (status === "SENT") return "sent";
    if (status === "SKIPPED") return "skipped";
    if (status === "FAILED" || status === "RETRYABLE") return "failed";
    return "pending";
}

async function resetPassword(raw, password, { ipAddress = null } = {}) {
    // Hash before taking any row lock.
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await consumeToken(raw, "PASSWORD_RESET", async (tx, user, now) => {
        // Same transaction: new credential, all sessions invalidated, the email proven.
        await tx.user.update({
            where: { id: user.id },
            data: { passwordHash, sessionVersion: { increment: 1 }, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: now }) },
        });
        await delivery.supersedeOpen(tx, user.id, ["PASSWORD_RESET", "EMAIL_VERIFY"], now);
        await recordAudit(tx, {
            actorUserId: user.id,
            action: "auth.password_reset_completed",
            targetType: "user",
            targetId: user.id,
            metadata: { sessionsRevoked: true },
            ipAddress,
        });
    });
}

// Login race guard (snapshot / re-check). `snapshot` is { id, passwordHash, sessionVersion } as read
// BEFORE bcrypt.compare. Called AFTER the session was saved with sv = snapshot.sessionVersion.
// If a password reset (or anything else changing the credential or session version) committed in
// between, the just-created session is destroyed and the login fails like a wrong password.
// A reset committing after this check is caught by sessionGuard on the next request (stale sv).
async function confirmLoginSnapshot(req, snapshot) {
    let fresh;
    try {
        fresh = await prisma.user.findUnique({ where: { id: snapshot.id }, select: { passwordHash: true, sessionVersion: true } });
    } catch (error) {
        await regenerateSession(req).catch(() => {});
        throw error;
    }
    if (!fresh || fresh.passwordHash !== snapshot.passwordHash || fresh.sessionVersion !== snapshot.sessionVersion) {
        await regenerateSession(req);
        throw new AppError(401, "INVALID_CREDENTIALS", "Wrong email or password.");
    }
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
}

module.exports = {
    register,
    requestPasswordReset,
    verifyEmail,
    resendVerification,
    resetPassword,
    confirmLoginSnapshot,
    regenerateSession,
    deliveryLabel,
    waitForFloor,
    RESPONSE_FLOOR_MS,
    SIGNUP_EMAILS_PER_HOUR,
    RESET_EMAILS_PER_HOUR,
};
