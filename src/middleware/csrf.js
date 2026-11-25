const { randomBytes, timingSafeEqual } = require("node:crypto");
const { AppError } = require("../lib/errors");

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

// Synchronizer token stored in the session. The SPA fetches it from
// GET /api/v1/auth/csrf and sends it back in the X-CSRF-Token header.
// The session is regenerated on login/signup, so the client must fetch a new token after auth.
function issueCsrfToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = randomBytes(32).toString("base64url");
    }
    return req.session.csrfToken;
}

function tokensMatch(expected, received) {
    if (typeof expected !== "string" || typeof received !== "string") return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
}

function csrfProtection(req, res, next) {
    if (safeMethods.has(req.method)) return next();

    if (!tokensMatch(req.session && req.session.csrfToken, req.get("x-csrf-token"))) {
        return next(new AppError(403, "CSRF_INVALID", "Your session expired. Refresh the page and try again."));
    }
    next();
}

module.exports = { issueCsrfToken, csrfProtection };
