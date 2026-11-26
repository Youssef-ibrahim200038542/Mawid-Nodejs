// Small in-process fixed-window counters for limits whose key is only known inside a service
// (e.g. "3 invitation resends per clinic + recipient per hour"). Single process only, like the
// express-rate-limit memory store; the database-backed cooldowns are the cross-instance guard.
function createMemoryQuota({ windowMs, limit, maxKeys = 50_000 }) {
    const buckets = new Map();

    function take(key, now = Date.now()) {
        const current = buckets.get(key);
        if (!current || now >= current.resetAt) {
            if (buckets.size >= maxKeys) {
                for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
                if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
            }
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return { allowed: true, retryAfterSeconds: 0 };
        }
        if (current.count >= limit) {
            return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
        }
        current.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
    }

    return { take, reset: () => buckets.clear() };
}

module.exports = { createMemoryQuota };
