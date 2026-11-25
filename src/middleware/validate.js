const { AppError } = require("../lib/errors");

function toDetails(issues) {
    return issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
    }));
}

// Parses req.body or req.query with a zod schema. Unknown keys are rejected by the
// schemas themselves (strictObject), so fields like clinicId can never sneak in.
// The parsed body replaces req.body; the parsed query goes to req.validatedQuery
// because req.query is read-only in Express 5.
function validate(schema, source = "body") {
    return function validateRequest(req, res, next) {
        const result = schema.safeParse(source === "query" ? req.query : req.body ?? {});
        if (!result.success) {
            return next(new AppError(400, "VALIDATION_FAILED", "Some fields are missing or invalid.", toDetails(result.error.issues)));
        }

        if (source === "query") {
            req.validatedQuery = result.data;
        } else {
            req.body = result.data;
        }
        next();
    };
}

module.exports = validate;
