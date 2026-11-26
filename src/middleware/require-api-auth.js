const { AppError, unauthenticated } = require("../lib/errors");

function requireApiAuth(req, res, next) {
    if (!req.session || !req.session.user || !Number.isInteger(req.session.user.id)) {
        if (req.sessionRevoked) {
            return next(new AppError(401, "SESSION_REVOKED", "You were signed out. Log in again to continue."));
        }
        return next(unauthenticated());
    }
    next();
}

module.exports = requireApiAuth;
