const logger = require("../lib/logger");

const publicMessages = {
    400: "The request could not be read. Check the form and try again.",
    403: "You don't have access to this page.",
    404: "This page doesn't exist.",
    413: "The request is too large.",
    429: "Too many attempts. Wait a few minutes and try again.",
};
const serverErrorMessage = "Something went wrong on our side. Try again in a moment.";

function resolveStatus(error) {
    const status = error && (error.status || error.statusCode);
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

function wantsJson(req) {
    return req.path.startsWith("/api/") || req.accepts(["html", "json"]) === "json";
}

// Never sends stack traces, database errors or internal messages to the client.
function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    const status = resolveStatus(error);
    const log = req.log || logger;
    if (status >= 500) {
        log.error({ err: error }, "Unhandled error");
    } else {
        log.warn({ status, reason: error && error.type }, "Request rejected");
    }

    const message = status >= 500 ? serverErrorMessage : publicMessages[status] || "The request could not be completed.";
    res.status(status);

    if (wantsJson(req)) {
        return res.json({ error: { status, message } });
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
