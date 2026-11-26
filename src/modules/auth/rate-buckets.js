// Per-email limits for signup and password reset, stored in auth_rate_buckets.
//
// Concurrency guarantee: the increment is one atomic statement,
//   INSERT … VALUES (…, 1) ON DUPLICATE KEY UPDATE request_count = request_count + 1
// keyed by (kind, key_hash, window_start). InnoDB serialises it on that primary-key row (a
// concurrent first insert waits on the duplicate-key lock and then takes the UPDATE branch), and
// the row stays locked by the caller's transaction until COMMIT, so the following SELECT reads
// exactly this request's position in the window. N concurrent requests from any number of app
// instances therefore see the distinct values 1…N and at most `limit` of them are allowed.
// The key is an HMAC of the normalised email; no email or IP is stored. Fixed one-hour windows.
const { keyedHash } = require("../../lib/tokens");
const { sqlDateTime } = require("./auth-delivery");

const WINDOW_MS = 3_600_000;

function windowStartFor(now) {
    return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

// Must run inside the caller's transaction. Returns true while the email is within the limit.
async function takeEmailQuota(tx, { kind, email, limit, now }) {
    const keyHash = keyedHash(`rate:${kind}`, email);
    const windowStart = sqlDateTime(windowStartFor(now));
    await tx.$executeRaw`
        INSERT INTO auth_rate_buckets (kind, key_hash, window_start, request_count)
        VALUES (${kind}, ${keyHash}, ${windowStart}, 1)
        ON DUPLICATE KEY UPDATE request_count = request_count + 1
    `;
    const rows = await tx.$queryRaw`
        SELECT request_count AS count FROM auth_rate_buckets
        WHERE kind = ${kind} AND key_hash = ${keyHash} AND window_start = ${windowStart}
    `;
    return Number(rows[0].count) <= limit;
}

module.exports = { takeEmailQuota, windowStartFor, WINDOW_MS };
