// Unit tests for account security (H1). No database: npm test loads tests/unit-env.js, which points
// every DB setting at a closed port; the tests below use in-memory fakes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcrypt");

const prisma = require("../src/config/database");
const tokens = require("../src/lib/tokens");
const delivery = require("../src/modules/auth/auth-delivery");
const rateBuckets = require("../src/modules/auth/rate-buckets");
const account = require("../src/modules/auth/account.service");
const { createSessionGuard } = require("../src/middleware/session-guard");
const trust = require("../src/modules/membership/membership-trust.service");
const emailProvider = require("../src/modules/notifications/email-provider");
const { assertProductionConfig } = require("../src/config/startup-checks");
const { createMemoryQuota } = require("../src/lib/memory-quota");
const invitations = require("../src/modules/invitations/invitation.service");

function stub(t, target, name, value) {
    const original = target[name];
    target[name] = value;
    t.after(() => {
        target[name] = original;
    });
}

// ------------------------------------------------------------------ tokens

test("tokens are 256-bit base64url values stored only as SHA-256 hex", () => {
    const { raw, hash } = tokens.generateToken();
    assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hash, tokens.hashToken(raw));
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, raw);
    assert.ok(tokens.isWellFormedToken(raw));
    for (const bad of ["", "short", `${raw}x`, "a".repeat(42) + "!", null, 42]) assert.equal(tokens.isWellFormedToken(bad), false);
    assert.notEqual(tokens.generateToken().raw, raw);
});

test("rate-limit keys derived from an email are keyed hashes that never contain the email", () => {
    const key = tokens.keyedHash("rate:SIGNUP", "ada@example.com");
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.ok(!key.includes("ada"));
    assert.notEqual(key, tokens.sha256Hex("rate:SIGNUP:ada@example.com"));
    assert.equal(tokens.maskEmail("ada@example.com"), "a***@example.com");
});

// ------------------------------------------------------------------ in-memory auth_tokens fake

function matches(row, where) {
    return Object.entries(where).every(([key, condition]) => {
        const value = row[key];
        if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
            if ("in" in condition) return condition.in.includes(value);
            if ("lt" in condition) return value < condition.lt;
            if ("lte" in condition) return value <= condition.lte;
            if ("gt" in condition) return value > condition.gt;
            return false;
        }
        if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
        return value === condition;
    });
}

function applyData(row, data) {
    for (const [key, value] of Object.entries(data)) {
        row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
    }
}

function fakeDb({ user }) {
    const rows = [];
    const db = {
        rows,
        user: { ...user },
        failNextCommit: false,
        authToken: {
            async create({ data }) {
                const row = { id: rows.length + 1, consumedAt: null, consumedReason: null, replacesTokenId: null, deliveryError: null, ...data };
                rows.push(row);
                return { id: row.id };
            },
            async updateMany({ where, data }) {
                let count = 0;
                for (const row of rows) if (matches(row, where)) {
                    applyData(row, data);
                    count += 1;
                }
                return { count };
            },
            async findUnique({ where }) {
                const row = rows.find((r) => r.id === where.id);
                return row ? { ...row, user: { name: db.user.name, locale: "en" } } : null;
            },
            async findMany({ where, take }) {
                return rows.filter((r) => matches(r, where)).sort((a, b) => a.nextRetryAt - b.nextRetryAt).slice(0, take).map((r) => ({ id: r.id, userId: r.userId }));
            },
            async count({ where }) {
                return rows.filter((r) => matches(r, where)).length;
            },
        },
        async $queryRaw(strings) {
            const sql = strings.join("?");
            if (sql.includes("FROM users")) return [{ id: db.user.id, email: db.user.email, emailVerifiedAt: db.user.emailVerifiedAt }];
            if (sql.includes("FROM auth_tokens")) return [{ id: 1 }];
            return [];
        },
        async $executeRaw() {
            return 0;
        },
        async $transaction(work) {
            // Snapshot → run → (simulated) rollback on failure.
            const snapshot = rows.map((r) => ({ ...r }));
            try {
                const result = await work(db);
                if (db.failNextCommit) {
                    db.failNextCommit = false;
                    throw new Error("crash before commit");
                }
                return result;
            } catch (error) {
                rows.splice(0, rows.length, ...snapshot);
                throw error;
            }
        },
    };
    return db;
}

const T0 = new Date("2026-11-27T10:00:00.000Z");
const clockAt = (ms) => () => new Date(T0.getTime() + ms);

async function queueVerification(db) {
    return db.$transaction((tx) => delivery.createGeneration(tx, { userId: 1, purpose: "EMAIL_VERIFY", email: "ada@example.com", now: T0 }));
}

// ------------------------------------------------------------------ delivery state machine

test("a generation that was created but never sent never counts as an attempt and is never marked FAILED", async () => {
    const db = fakeDb({ user: { id: 1, name: "Ada", email: "ada@example.com", emailVerifiedAt: null } });
    await queueVerification(db); // crash: the process died before sending
    // Recovery passes keep regenerating (new token each time) without consuming attempts.
    for (let i = 1; i <= 5; i += 1) {
        const crashSend = async () => {
            throw new Error("must not be called");
        };
        const gen = await delivery.recoverOne({ id: db.rows.at(-1).id, userId: 1 }, { db, clock: clockAt(i * 61_000) });
        assert.ok(gen, `pass ${i} regenerates`);
        assert.equal(db.rows.at(-1).sendAttempts, 0);
        assert.equal(db.rows.at(-1).deliveryStatus, "QUEUED");
        void crashSend;
    }
    assert.equal(db.rows.filter((r) => r.deliveryStatus === "FAILED").length, 0);
    assert.equal(db.rows.filter((r) => r.deliveryStatus === "REPLACED").length, 5);
    // Every replaced actionable token is invalid.
    assert.ok(db.rows.filter((r) => r.deliveryStatus === "REPLACED").every((r) => r.consumedReason === "SUPERSEDED"));
});

test("at most MAX_SEND_ATTEMPTS real provider calls per chain, then FAILED MAX_ATTEMPTS", async () => {
    const db = fakeDb({ user: { id: 1, name: "Ada", email: "ada@example.com", emailVerifiedAt: null } });
    let gen = await queueVerification(db);
    let calls = 0;
    const transient = async () => {
        calls += 1;
        return { status: "RETRYABLE", code: "TIMEOUT" };
    };
    let now = 0;
    await delivery.sendGeneration(gen, { db, clock: clockAt(now), deliverFn: transient });
    for (let i = 0; i < 5; i += 1) {
        now += 10 * 60_000;
        const due = db.rows.find((r) => ["QUEUED", "SENDING", "RETRYABLE"].includes(r.deliveryStatus));
        if (!due) break;
        gen = await delivery.recoverOne({ id: due.id, userId: 1 }, { db, clock: clockAt(now) });
        if (gen) await delivery.sendGeneration(gen, { db, clock: clockAt(now), deliverFn: transient });
    }
    assert.equal(calls, delivery.MAX_SEND_ATTEMPTS);
    const last = db.rows.at(-1);
    assert.equal(last.deliveryStatus, "FAILED");
    assert.equal(last.deliveryError, "MAX_ATTEMPTS");
    assert.equal(last.sendAttempts, 3);
    assert.equal(db.rows.filter((r) => ["QUEUED", "SENDING", "RETRYABLE"].includes(r.deliveryStatus)).length, 0);
});

test("a crash after the provider accepted (lease expiry) uses one attempt and resends with a new token", async () => {
    const db = fakeDb({ user: { id: 1, name: "Ada", email: "ada@example.com", emailVerifiedAt: null } });
    const gen = await queueVerification(db);
    // Claim + provider call happened, then the process died before the callback was stored.
    await db.authToken.updateMany({ where: { id: gen.id, deliveryStatus: "QUEUED" }, data: { deliveryStatus: "SENDING", sendAttempts: { increment: 1 }, nextRetryAt: new Date(T0.getTime() + delivery.SENDING_LEASE_MS) } });
    assert.equal(await delivery.recoverOne({ id: gen.id, userId: 1 }, { db, clock: clockAt(60_000) }), null, "lease not expired yet");
    const replacement = await delivery.recoverOne({ id: gen.id, userId: 1 }, { db, clock: clockAt(delivery.SENDING_LEASE_MS + 1) });
    assert.ok(replacement);
    assert.notEqual(replacement.tokenHash, gen.tokenHash);
    assert.equal(db.rows.find((r) => r.id === gen.id).consumedReason, "SUPERSEDED");
    assert.equal(db.rows.find((r) => r.id === replacement.id).sendAttempts, 1);
});

test("a crash before the recovery commit leaves the original row untouched and still due", async () => {
    const db = fakeDb({ user: { id: 1, name: "Ada", email: "ada@example.com", emailVerifiedAt: null } });
    const gen = await queueVerification(db);
    db.failNextCommit = true;
    await assert.rejects(delivery.recoverOne({ id: gen.id, userId: 1 }, { db, clock: clockAt(61_000) }), /crash before commit/);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].deliveryStatus, "QUEUED");
    assert.ok(await delivery.recoverOne({ id: gen.id, userId: 1 }, { db, clock: clockAt(62_000) }));
});

test("delivery callbacks are conditional on the exact generation: a stale callback changes nothing", async () => {
    const db = fakeDb({ user: { id: 1, name: "Ada", email: "ada@example.com", emailVerifiedAt: null } });
    const genA = await queueVerification(db);
    let releaseA;
    const slow = () => new Promise((resolve) => (releaseA = () => resolve({ status: "FAILED", code: "LATE" })));
    const sendingA = delivery.sendGeneration(genA, { db, clock: clockAt(0), deliverFn: slow });
    await new Promise((r) => setImmediate(r));
    // Meanwhile the lease expires and recovery replaces A with B, which is sent successfully.
    const genB = await delivery.recoverOne({ id: genA.id, userId: 1 }, { db, clock: clockAt(delivery.SENDING_LEASE_MS + 1) });
    await delivery.sendGeneration(genB, { db, clock: clockAt(delivery.SENDING_LEASE_MS + 2), deliverFn: async () => ({ status: "SENT" }) });
    releaseA();
    assert.equal(await sendingA, null);
    assert.equal(db.rows.find((r) => r.id === genA.id).deliveryStatus, "REPLACED");
    assert.equal(db.rows.find((r) => r.id === genB.id).deliveryStatus, "SENT");
    // Claiming twice is impossible too.
    assert.equal(await delivery.sendGeneration(genB, { db, deliverFn: async () => ({ status: "SENT" }) }), null);
});

test("ACCOUNT_NOTICE: born consumed and unusable, yet recovered after a crash (not treated as obsolete)", async () => {
    const db = fakeDb({ user: { id: 1, name: "Ada", email: "ada@example.com", emailVerifiedAt: new Date(0) } });
    const notice = await db.$transaction((tx) => delivery.createGeneration(tx, { userId: 1, purpose: "ACCOUNT_NOTICE", email: "ada@example.com", now: T0 }));
    assert.equal(notice.raw, null, "no raw token exists for a notice");
    assert.equal(db.rows[0].consumedReason, "NOTICE");
    const replacement = await delivery.recoverOne({ id: notice.id, userId: 1 }, { db, clock: clockAt(61_000) });
    assert.ok(replacement, "notice is regenerated, not closed as consumed");
    assert.equal(replacement.purpose, "ACCOUNT_NOTICE");
    assert.equal(replacement.raw, null);
    assert.equal(db.rows.at(-1).consumedReason, "NOTICE");
    const sent = await delivery.sendGeneration(replacement, { db, deliverFn: async () => ({ status: "SENT" }) });
    assert.equal(sent, "SENT");
});

test("recovery decisions: expired chain, changed email, already verified, newer generation, permanent failure", () => {
    const base = { deliveryStatus: "RETRYABLE", purpose: "EMAIL_VERIFY", email: "a@x.test", consumedAt: null, sendAttempts: 1, chainStartedAt: T0 };
    const user = { email: "a@x.test", emailVerifiedAt: null };
    const now = new Date(T0.getTime() + 60_000);
    assert.equal(delivery.decideRecovery(base, user, { now, hasNewer: false }).action, "regenerate");
    assert.equal(delivery.decideRecovery(base, user, { now: new Date(T0.getTime() + 25 * 3_600_000), hasNewer: false }).reason, "EXPIRED");
    assert.equal(delivery.decideRecovery(base, { ...user, email: "b@x.test" }, { now, hasNewer: false }).reason, "EMAIL_CHANGED");
    assert.equal(delivery.decideRecovery(base, { ...user, emailVerifiedAt: now }, { now, hasNewer: false }).reason, "ALREADY_VERIFIED");
    assert.equal(delivery.decideRecovery(base, user, { now, hasNewer: true }).reason, "SUPERSEDED");
    assert.equal(delivery.decideRecovery({ ...base, consumedAt: now }, user, { now, hasNewer: false }).reason, "CONSUMED");
    assert.equal(delivery.decideRecovery({ ...base, sendAttempts: 3 }, user, { now, hasNewer: false }).action, "fail");
    assert.equal(delivery.decideRecovery({ ...base, deliveryStatus: "QUEUED", sendAttempts: 3 }, user, { now, hasNewer: false }).action, "regenerate");
    for (const final of ["SENT", "FAILED", "SKIPPED", "REPLACED"]) {
        assert.equal(delivery.decideRecovery({ ...base, deliveryStatus: final }, user, { now, hasNewer: false }).action, "skip", `${final} is never retried`);
    }
    // A permanent provider failure is final immediately; transient failures back off.
    assert.equal(delivery.outcomeData({ status: "FAILED", code: "BAD_ADDRESS" }, 1, now).deliveryStatus, "FAILED");
    assert.equal(delivery.outcomeData({ status: "RETRYABLE" }, 1, now).deliveryStatus, "RETRYABLE");
    assert.equal(delivery.outcomeData({ status: "RETRYABLE" }, 3, now).deliveryError, "MAX_ATTEMPTS");
});

// ------------------------------------------------------------------ per-email rate buckets

test("per-email quota: one atomic upsert per request, no raw email, and N concurrent requests allow exactly `limit`", async () => {
    const counts = new Map();
    const statements = [];
    let queue = Promise.resolve();
    // Fake that behaves like InnoDB for this statement pair: the upsert takes the row lock and
    // holds it until the transaction ends, so concurrent transactions run one after another.
    async function transaction(work) {
        const run = queue.then(async () => {
            const tx = {
                async $executeRaw(strings, ...values) {
                    statements.push({ sql: strings.join("?"), values });
                    const key = values.slice(0, 3).join("|");
                    counts.set(key, (counts.get(key) ?? 0) + 1);
                    return 1;
                },
                async $queryRaw(strings, ...values) {
                    return [{ count: counts.get(values.slice(0, 3).join("|")) }];
                },
            };
            return work(tx);
        });
        queue = run.catch(() => {});
        return run;
    }
    const now = new Date("2026-11-27T10:15:00.000Z");
    const results = await Promise.all(
        Array.from({ length: 10 }, () => transaction((tx) => rateBuckets.takeEmailQuota(tx, { kind: "SIGNUP", email: "ada@example.com", limit: 3, now })))
    );
    assert.equal(results.filter(Boolean).length, 3);
    assert.match(statements[0].sql, /ON DUPLICATE KEY UPDATE request_count = request_count \+ 1/);
    assert.ok(statements.every((s) => !JSON.stringify(s.values).includes("ada@example.com")), "raw email never stored");
    assert.equal(statements[0].values[2], "2026-11-27 10:00:00.000", "fixed one-hour window");
});

// ------------------------------------------------------------------ signup / forgot-password anti-enumeration

function signupTx(t, { existing }) {
    const log = [];
    const tx = {
        async $executeRaw(strings) {
            log.push(strings.join("?").includes("auth_rate_buckets") ? "quota" : "user-upsert");
            return 1;
        },
        async $queryRaw(strings, ...values) {
            const sql = strings.join("?");
            if (sql.includes("request_count")) return [{ count: 1 }];
            log.push("user-select");
            // password_hash equals the fresh hash only for a newly inserted row.
            return [{ id: 9, passwordHash: existing ? "stored-old-hash" : values[0] === undefined ? "x" : currentHash, emailVerifiedAt: existing === "verified" ? new Date() : null }];
        },
        authToken: {
            async updateMany() {
                log.push("supersede");
                return { count: 0 };
            },
            async create({ data }) {
                log.push(`token:${data.purpose}`);
                return { id: 1 };
            },
        },
        auditLog: {
            async create({ data }) {
                log.push(`audit:${data.action}`);
            },
        },
    };
    let currentHash;
    stub(t, bcrypt, "hash", async () => {
        currentHash = `fresh-${Math.random()}`;
        return currentHash;
    });
    stub(t, prisma, "$transaction", async (work) => work(tx));
    stub(t, delivery, "dispatchAfterCommit", () => {});
    return log;
}

test("signup runs the same database statements and commits whether or not the address has an account", async (t) => {
    const shapes = {};
    for (const existing of [false, "verified", "unverified"]) {
        const log = signupTx(t, { existing });
        await account.register({ name: "Ada", email: "ada@example.com", password: "correct-horse" }, { floorMs: 0 });
        shapes[String(existing)] = log.map((entry) => entry.replace(/:.*/, ""));
    }
    assert.deepEqual(shapes.false, shapes.verified);
    assert.deepEqual(shapes.false, shapes.unverified);
    assert.deepEqual(shapes.false, ["quota", "user-upsert", "user-select", "supersede", "supersede", "token", "audit"]);
});

test("signup never modifies an existing account and the response floor hides timing", async (t) => {
    const log = signupTx(t, { existing: "verified" });
    const started = Date.now();
    await account.register({ name: "Mallory", email: "ada@example.com", password: "attacker-pass" }, { floorMs: 120 });
    assert.ok(Date.now() - started >= 115);
    assert.ok(log.includes("token:ACCOUNT_NOTICE"), "existing verified account gets a notice, not a new account");
    assert.ok(log.includes("audit:auth.signup_existing_email"));
    assert.ok(!log.some((entry) => entry.startsWith("token:EMAIL_VERIFY")));
});

// ------------------------------------------------------------------ login snapshot (login vs reset race)

test("login snapshot: a password reset between the check and the session destroys the new session", async (t) => {
    let regenerated = 0;
    const req = { session: { regenerate: (cb) => { regenerated += 1; cb(null); } } };
    stub(t, prisma.user, "findUnique", async () => ({ passwordHash: "new-hash", sessionVersion: 1 }));
    await assert.rejects(account.confirmLoginSnapshot(req, { id: 1, passwordHash: "old-hash", sessionVersion: 0 }), { status: 401, code: "INVALID_CREDENTIALS" });
    assert.equal(regenerated, 1);

    prisma.user.findUnique = async () => ({ passwordHash: "same", sessionVersion: 4 });
    await account.confirmLoginSnapshot(req, { id: 1, passwordHash: "same", sessionVersion: 4 });
    assert.equal(regenerated, 1, "unchanged credential keeps the session");

    prisma.user.findUnique = async () => {
        throw new Error("db down");
    };
    await assert.rejects(account.confirmLoginSnapshot(req, { id: 1, passwordHash: "same", sessionVersion: 4 }), /db down/);
    assert.equal(regenerated, 2, "a failed re-check never leaves a usable session behind");
});

test("verification tokens: malformed or unknown tokens fail with one generic error", async (t) => {
    stub(t, prisma.authToken, "findUnique", async () => null);
    for (const raw of ["", "nope", tokens.generateToken().raw]) {
        await assert.rejects(account.verifyEmail(raw), { status: 400, code: "TOKEN_INVALID" });
    }
    prisma.authToken.findUnique = async () => ({ id: 1, userId: 1, purpose: "PASSWORD_RESET" });
    await assert.rejects(account.verifyEmail(tokens.generateToken().raw), { code: "TOKEN_INVALID" }, "a reset token cannot verify an email");
});

// ------------------------------------------------------------------ session guard

function runGuard(guard, req) {
    return new Promise((resolve) => {
        guard(req, { clearCookie() {} }, (error) => resolve(error ?? null));
    });
}

test("sessionGuard: guests trigger no lookup; sessions without sv count as version 0", async () => {
    let lookups = 0;
    const db = { user: { findUnique: async () => { lookups += 1; return { sessionVersion: 0 }; } } };
    const guard = createSessionGuard({ db });
    assert.equal(await runGuard(guard, { session: {} }), null);
    assert.equal(lookups, 0);
    const req = { session: { user: { id: 3, name: "Ada" } } };
    assert.equal(await runGuard(guard, req), null);
    assert.equal(lookups, 1);
    assert.equal(req.sessionRevoked, undefined);
});

test("sessionGuard: a stale version is regenerated BEFORE the request continues as a guest", async () => {
    const order = [];
    const db = { user: { findUnique: async () => ({ sessionVersion: 2 }) } };
    const req = {
        session: {
            user: { id: 3, sv: 1 },
            regenerate(cb) {
                order.push("regenerate");
                setTimeout(() => {
                    req.session = { csrfToken: undefined };
                    cb(null);
                }, 5);
            },
        },
    };
    const error = await new Promise((resolve) => createSessionGuard({ db })(req, { clearCookie: () => order.push("clear") }, (e) => { order.push("next"); resolve(e ?? null); }));
    assert.equal(error, null);
    assert.deepEqual(order, ["regenerate", "clear", "next"]);
    assert.equal(req.sessionRevoked, true);
    assert.equal(req.session.user, undefined);
    assert.equal(req.session.csrfToken, undefined, "no CSRF token: a stale POST fails CSRF");
});

test("sessionGuard fails closed: lookup or regeneration failure is a 5xx, never a silent guest", async () => {
    const boom = new Error("db down");
    let regenerated = false;
    const req = { session: { user: { id: 3, sv: 0 }, regenerate: (cb) => { regenerated = true; cb(null); } } };
    const error = await runGuard(createSessionGuard({ db: { user: { findUnique: async () => { throw boom; } } } }), req);
    assert.equal(error, boom);
    assert.equal(regenerated, false, "session left untouched on a transient failure");

    const failing = { session: { user: { id: 3, sv: 0 }, regenerate: (cb) => cb(new Error("store down")) } };
    const error2 = await runGuard(createSessionGuard({ db: { user: { findUnique: async () => null } } }), failing);
    assert.match(error2.message, /store down/);
});

// ------------------------------------------------------------------ membership trust

test("trust proofs: only an accepted invitation for this user/member/role/email grants trust", async () => {
    const tx = { clinicMember: { create: async ({ data }) => data, updateMany: async () => ({ count: 1 }) } };
    const now = new Date();
    const user = { id: 5, email: "doc@x.test", emailVerified: true };
    const invitation = { id: 9, clinicId: 1, kind: "NEW_MEMBER", status: "ACCEPTED", acceptedByUserId: 5, email: "doc@x.test", role: "DOCTOR", memberId: null };
    const created = await trust.createInvitedMembership(tx, { invitation, user, now });
    assert.equal(created.trustSource, "INVITATION");
    assert.equal(created.trustedViaInvitationId, 9);

    const bad = [
        [{ ...invitation, status: "PENDING" }, user],
        [{ ...invitation, acceptedByUserId: 6 }, user],
        [invitation, { ...user, emailVerified: false }],
        [invitation, { ...user, email: "other@x.test" }],
        [{ ...invitation, kind: "RECONFIRM" }, user],
    ];
    for (const [inv, u] of bad) await assert.rejects(trust.createInvitedMembership(tx, { invitation: inv, user: u, now }), trust.TrustProofError);

    const member = { id: 3, clinicId: 1, userId: 5, role: "DOCTOR", status: "ACTIVE", trustState: "LEGACY_UNREVIEWED" };
    const reconfirm = { ...invitation, kind: "RECONFIRM", memberId: 3 };
    await trust.trustReconfirmedMembership(tx, { invitation: reconfirm, member, user, now });
    for (const m of [{ ...member, role: "OWNER" }, { ...member, userId: 6 }, { ...member, trustState: "TRUSTED" }, { ...member, status: "DISABLED" }, { ...member, clinicId: 2 }]) {
        await assert.rejects(trust.trustReconfirmedMembership(tx, { invitation: reconfirm, member: m, user, now }), trust.TrustProofError);
    }
    await assert.rejects(trust.createCreatorMembership(tx, { clinicId: 1, userId: 5, userEmailVerified: false, now }), trust.TrustProofError);
});

test("no code outside membership-trust.service writes trust fields", () => {
    const root = path.join(__dirname, "..", "src");
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".js") && !full.endsWith(path.join("membership", "membership-trust.service.js"))) {
                const text = fs.readFileSync(full, "utf8");
                // Any TRUSTED write must set trust_source (CHECK constraint), so a write shows up as an
                // assignment of trustSource / trustedAt / trustedViaInvitationId to something other
                // than `true` (a Prisma select), or as raw SQL setting trust_*.
                if (/\b(trustSource|trustedAt|trustedViaInvitationId)\s*:\s*(?!true\b)\S/.test(text) || /SET[^;]*\btrust_(state|source)\b/i.test(text)) {
                    offenders.push(path.relative(root, full));
                }
            }
        }
    };
    walk(root);
    assert.deepEqual(offenders, []);
});

// ------------------------------------------------------------------ invitations (pure parts)

test("invitation keys and delivery labels", () => {
    assert.equal(invitations.activeKey("n", 1, "a@x.test"), invitations.activeKey("n", 1, "a@x.test"));
    assert.notEqual(invitations.activeKey("n", 1, "a@x.test"), invitations.activeKey("n", 2, "a@x.test"));
    assert.notEqual(invitations.activeKey("n", 1, "a@x.test"), invitations.activeKey("r", 1, "a@x.test"));
    const now = new Date();
    assert.equal(invitations.deliveryOf({ deliveryStatus: "PENDING", lastSentAt: now }, now), "pending");
    assert.equal(invitations.deliveryOf({ deliveryStatus: "PENDING", lastSentAt: new Date(now - 11 * 60_000) }, now), "unknown");
    assert.equal(invitations.deliveryOf({ deliveryStatus: "FAILED", lastSentAt: now }, now), "failed");
});

test("memory quota allows `limit` per window", () => {
    const quota = createMemoryQuota({ windowMs: 1000, limit: 3 });
    const results = [0, 1, 2, 3].map(() => quota.take("k", 0).allowed);
    assert.deepEqual(results, [true, true, true, false]);
    assert.equal(quota.take("k", 1001).allowed, true);
});

// ------------------------------------------------------------------ email providers and production checks

test("outbox and development providers can never run in production", async (t) => {
    stub(t, process.env, "NODE_ENV", "production");
    stub(t, process.env, "EMAIL_PROVIDER", "outbox");
    assert.throws(() => emailProvider.getEmailProvider(), /development only/);
    assert.throws(() => assertProductionConfig({ NODE_ENV: "production", EMAIL_PROVIDER: "outbox" }), /cannot be used in production/);
    assert.throws(() => assertProductionConfig({ NODE_ENV: "production", EMAIL_PROVIDER: "none" }), /cannot be used in production/);
    assert.throws(() => assertProductionConfig({ NODE_ENV: "production" }), /cannot be used in production/);
    assert.doesNotThrow(() => assertProductionConfig({ NODE_ENV: "development" }));
});

test("deliver(): none/log report SKIPPED (never SENT), errors are classified, nothing throws", async (t) => {
    stub(t, process.env, "EMAIL_PROVIDER", "none");
    assert.deepEqual(await emailProvider.deliver({ to: "a@x.test", subject: "s", text: "secret-link" }), { status: "SKIPPED" });
    process.env.EMAIL_PROVIDER = "log";
    assert.deepEqual(await emailProvider.deliver({ to: "a@x.test", subject: "s", text: "secret-link" }), { status: "SKIPPED" });
    const original = emailProvider.providers.none.send;
    t.after(() => {
        emailProvider.providers.none.send = original;
    });
    process.env.EMAIL_PROVIDER = "none";
    emailProvider.providers.none.send = async () => {
        throw new emailProvider.EmailDeliveryError("BAD_ADDRESS", { permanent: true });
    };
    assert.deepEqual(await emailProvider.deliver({ to: "a@x.test", subject: "s", text: "t" }), { status: "FAILED", code: "BAD_ADDRESS" });
    emailProvider.providers.none.send = async () => {
        throw new Error("socket hang up: secret-link");
    };
    assert.deepEqual(await emailProvider.deliver({ to: "a@x.test", subject: "s", text: "t" }), { status: "RETRYABLE", code: "PROVIDER_ERROR" });
    emailProvider.providers.none.send = () => new Promise(() => {});
    assert.deepEqual(await emailProvider.deliver({ to: "a@x.test", subject: "s", text: "t" }, { timeoutMs: 20 }), { status: "RETRYABLE", code: "TIMEOUT" });
});

test("the email outbox is outside the web roots and ignored by Git", () => {
    const repo = path.join(__dirname, "..");
    const outbox = path.relative(repo, emailProvider.outboxDir).split(path.sep).join("/");
    assert.equal(outbox, "var/mail-outbox");
    assert.match(fs.readFileSync(path.join(repo, ".gitignore"), "utf8"), /^var\/$/m);
    assert.match(fs.readFileSync(path.join(repo, "web", "vite.config.ts"), "utf8"), /\*\*\/var\/mail-outbox\/\*\*/);
    assert.doesNotMatch(fs.readFileSync(path.join(repo, "src", "app.js"), "utf8"), /mail-outbox/);
});
