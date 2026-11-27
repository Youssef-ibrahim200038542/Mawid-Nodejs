// Mounted right after the session middleware, in front of BOTH the JSON API and the legacy EJS
// pages. For a logged-in session it compares the session's `sv` with users.session_version
// (sessions created before this check existed have no `sv` and count as 0 = the column default).
//   - guest session            → no database lookup.
//   - lookup fails             → 500 (fail closed); the session is left untouched.
//   - user gone / sv mismatch  → the session is regenerated (old row deleted from the store,
//                                req.session replaced by an empty one) and only THEN does the
//                                request continue as a guest. Protected API routes answer
//                                401 SESSION_REVOKED, protected EJS pages redirect to /login.
//                                The fresh session has no CSRF token, so a stale POST fails CSRF.
//   - regeneration fails       → 500.
const prisma = require("../config/database");

const { cookieName: sessionCookieName } = require("../config/session-cookie");

function regenerate(req) {
    return new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
}

function createSessionGuard({ db = prisma } = {}) {
    return async function sessionGuard(req, res, next) {
        const sessionUser = req.session && req.session.user;
        if (!sessionUser) return next();

        let row = null;
        if (Number.isInteger(sessionUser.id)) {
            try {
                row = await db.user.findUnique({ where: { id: sessionUser.id }, select: { sessionVersion: true } });
            } catch (error) {
                return next(error);
            }
        }
        if (row && (sessionUser.sv ?? 0) === row.sessionVersion) return next();

        try {
            await regenerate(req);
        } catch (error) {
            return next(error);
        }
        res.clearCookie(sessionCookieName, { path: "/" });
        req.sessionRevoked = true;
        next();
    };
}

module.exports = { createSessionGuard, sessionGuard: createSessionGuard(), sessionCookieName };
