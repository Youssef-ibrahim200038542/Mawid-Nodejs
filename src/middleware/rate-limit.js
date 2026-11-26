const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// In-memory store: correct for a single process. A shared store (e.g. the DB or Redis)
// is required before running more than one instance.
// keyByUser: limit per logged-in user instead of per IP (many patients can share one IP,
// e.g. an office or mobile-carrier NAT); anonymous requests still fall back to the IP.
// keyGenerator (optional): a custom key, e.g. per owner + clinic. It must never contain a raw
// email address; use lib/tokens.keyedHash for anything derived from one.
function createLimiter({ windowMs, limit, skipSuccessfulRequests = false, keyByUser = false, keyGenerator = null }) {
    return rateLimit({
        windowMs,
        limit,
        skipSuccessfulRequests,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        ...(keyGenerator ? { keyGenerator } : {}),
        ...(keyByUser && !keyGenerator
            ? {
                keyGenerator(req) {
                    const userId = req.session && req.session.user && req.session.user.id;
                    return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip)}`;
                },
            }
            : {}),
        handler(req, res, next) {
            const error = new Error("Rate limit exceeded");
            error.status = 429;
            next(error);
        },
    });
}

// Only failed attempts count, so a user who logs in normally is never locked out.
const loginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true });
const signupLimiter = createLimiter({ windowMs: 60 * 60 * 1000, limit: 10 });
const publicRegistrationLimiter = createLimiter({ windowMs: 10 * 60 * 1000, limit: 20 });

module.exports = {
    createLimiter,
    loginLimiter,
    signupLimiter,
    publicRegistrationLimiter,
};
