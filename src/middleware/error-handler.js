const logger = require("../lib/logger");
const { AppError } = require("../lib/errors");

const publicErrors = {
    400: ["BAD_REQUEST", "The request could not be read. Check the form and try again."],
    401: ["UNAUTHENTICATED", "Log in to continue."],
    403: ["FORBIDDEN", "You don't have access to this page."],
    404: ["NOT_FOUND", "This page doesn't exist."],
    413: ["PAYLOAD_TOO_LARGE", "The request is too large."],
    429: ["RATE_LIMITED", "Too many attempts. Wait a few minutes and try again."],
};
const serverError = ["INTERNAL_ERROR", "Something went wrong on our side. Try again in a moment."];

function resolveStatus(error) {
    const status = error && (error.status || error.statusCode);
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

function wantsJson(req) {
    return req.originalUrl.startsWith("/api/") || req.accepts(["html", "json"]) === "json";
}

// Never sends stack traces, database errors or internal messages to the client.
// Only AppError carries a message written for users; everything else gets a generic one.
function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    const status = resolveStatus(error);
    const log = req.log || logger;
    if (status >= 500) {
        log.error({ err: error }, "Unhandled error");
    } else {
        log.warn({ status, code: error && error.code, reason: error && error.type }, "Request rejected");
    }

    const exposed = error instanceof AppError && status < 500;
    const [defaultCode, defaultMessage] = status >= 500 ? serverError : publicErrors[status] || ["REQUEST_FAILED", "The request could not be completed."];
    const code = exposed ? error.code : defaultCode;
    const message = exposed ? error.message : defaultMessage;

    res.status(status);

    if (wantsJson(req)) {
        const body = { status, code, message };
        if (exposed && error.details) body.details = error.details;
        return res.json({ error: body });
    }

    res.render("error", { status, message, user: res.locals.user ?? null }, (renderError, html) => {
        if (renderError) {
            log.error({ err: renderError }, "Error page failed to render");
            return res.type("text/plain").send(message);
        }
        res.send(html);
    });
}

module.exports = errorHandler;
