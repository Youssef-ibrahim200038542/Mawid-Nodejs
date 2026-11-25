// An error whose code and message are safe to show to the client.
// `code` is stable and machine-readable so the frontend can translate it (en / ar).
class AppError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.details = details;
        this.expose = true;
    }
}

const notFound = () => new AppError(404, "NOT_FOUND", "This resource doesn't exist.");
const forbidden = () => new AppError(403, "FORBIDDEN", "You don't have permission to do that.");
const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Log in to continue.");

module.exports = { AppError, notFound, forbidden, unauthenticated };
