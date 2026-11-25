const { unauthenticated } = require("../lib/errors");

function requireApiAuth(req, res, next) {
    if (!req.session || !req.session.user || !Number.isInteger(req.session.user.id)) {
        return next(unauthenticated());
    }
    next();
}

module.exports = requireApiAuth;
