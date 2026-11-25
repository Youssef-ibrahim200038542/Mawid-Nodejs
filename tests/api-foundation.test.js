const test = require("node:test");
const assert = require("node:assert/strict");
const { issueCsrfToken, csrfProtection } = require("../src/middleware/csrf");
const validate = require("../src/middleware/validate");
const { createClinicSchema, updateClinicSchema, paginationSchema } = require("../src/modules/clinics/clinic.schemas");
const { assertMawidDatabase } = require("../src/config/db-guard");
const errorHandler = require("../src/middleware/error-handler");
const { AppError } = require("../src/lib/errors");

function runMiddleware(middleware, req) {
    let result;
    middleware(req, {}, (error) => {
        result = error ?? null;
    });
    return result;
}

function csrfRequest(method, sessionToken, headerToken) {
    return {
        method,
        session: sessionToken ? { csrfToken: sessionToken } : {},
        get: (name) => (name.toLowerCase() === "x-csrf-token" ? headerToken : undefined),
    };
}

test("csrf: issues one stable random token per session", () => {
    const req = { session: {} };
    const token = issueCsrfToken(req);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(issueCsrfToken(req), token);
});

test("csrf: safe methods pass, unsafe methods need the matching header", () => {
    assert.equal(runMiddleware(csrfProtection, csrfRequest("GET")), null);
    assert.equal(runMiddleware(csrfProtection, csrfRequest("POST", "abc", "abc")), null);

    for (const req of [
        csrfRequest("POST", "abc", undefined),
        csrfRequest("PATCH", "abc", "abd"),
        csrfRequest("DELETE", undefined, "abc"),
        csrfRequest("POST", "abc", "abcd"),
    ]) {
        const error = runMiddleware(csrfProtection, req);
        assert.equal(error.status, 403);
        assert.equal(error.code, "CSRF_INVALID");
    }
});

test("clinic schemas reject unknown fields such as clinicId", () => {
    const result = createClinicSchema.safeParse({ name: "Nile Dental", slug: "nile-dental", clinicId: 2 });
    assert.equal(result.success, false);

    const update = updateClinicSchema.safeParse({ slug: "stolen" });
    assert.equal(update.success, false);
});

test("clinic schema normalises input and applies Cairo/English defaults", () => {
    const result = createClinicSchema.parse({ name: "  Nile Dental ", slug: "Nile-Dental", email: "", phone: "" });
    assert.deepEqual(result, {
        name: "Nile Dental",
        slug: "nile-dental",
        timezone: "Africa/Cairo",
        defaultLocale: "en",
        email: null,
        phone: null,
    });
});

test("clinic schema rejects reserved slugs, bad slugs, unknown timezones and locales", () => {
    for (const input of [
        { name: "Admin", slug: "admin" },
        { name: "Bad", slug: "bad--slug" },
        { name: "Bad", slug: "عيادة" },
        { name: "Tz", slug: "tz-clinic", timezone: "Mars/Olympus" },
        { name: "Locale", slug: "locale-clinic", defaultLocale: "fr" },
    ]) {
        assert.equal(createClinicSchema.safeParse(input).success, false, JSON.stringify(input));
    }
    assert.equal(updateClinicSchema.safeParse({}).success, false);
});

test("validate middleware returns 400 with field details", () => {
    const req = { body: { slug: "x" } };
    const error = runMiddleware(validate(createClinicSchema), req);
    assert.equal(error.status, 400);
    assert.equal(error.code, "VALIDATION_FAILED");
    assert.ok(error.details.some((detail) => detail.path === "name"));
});

test("validate middleware stores parsed query on req.validatedQuery", () => {
    const req = { query: { page: "3" } };
    assert.equal(runMiddleware(validate(paginationSchema, "query"), req), null);
    assert.deepEqual(req.validatedQuery, { page: 3, pageSize: 25 });
});

test("db guard refuses any database other than mawid / mawid_*", () => {
    assert.throws(() => assertMawidDatabase({ dbName: "car_rental" }), /refusing/);
    assert.throws(() => assertMawidDatabase({ databaseUrl: "mysql://root@127.0.0.1:3306/car_rental" }), /refusing/);
    assert.throws(() => assertMawidDatabase({ databaseUrl: "mysql://root@127.0.0.1:3306/" }), /refusing/);
    assert.throws(() => assertMawidDatabase({ dbName: "mawid", databaseUrl: "mysql://root@h/mawid_test" }), /different/);
    assert.doesNotThrow(() => assertMawidDatabase({ dbName: "mawid", databaseUrl: "mysql://root@127.0.0.1:3306/mawid" }));
    assert.doesNotThrow(() => assertMawidDatabase({ dbName: "mawid_test" }));
});

test("error handler exposes AppError code, message and details on the API", () => {
    const res = {
        headersSent: false,
        locals: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
        },
    };
    const req = { originalUrl: "/api/v1/clinics", path: "/clinics", accepts: () => "json", log: { warn() {}, error() {} } };
    errorHandler(new AppError(400, "VALIDATION_FAILED", "Some fields are missing or invalid.", [{ path: "name" }]), req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.error, {
        status: 400,
        code: "VALIDATION_FAILED",
        message: "Some fields are missing or invalid.",
        details: [{ path: "name" }],
    });
});
