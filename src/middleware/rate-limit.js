const { rateLimit } = require("express-rate-limit");

// In-memory store: correct for a single process. A shared store (e.g. the DB or Redis)
// is required before running more than one instance.
function createLimiter({ windowMs, limit, skipSuccessfulRequests = false }) {
    return rateLimit({
        windowMs,
        limit,
        skipSuccessfulRequests,
        standardHeaders: "draft-8",
        legacyHeaders: false,
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
