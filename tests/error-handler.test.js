const test = require("node:test");
const assert = require("node:assert/strict");
const errorHandler = require("../src/middleware/error-handler");

const silentLog = { error() {}, warn() {} };

function makeRequest({ path = "/dashboard", accepts = "html" } = {}) {
    return { path, log: silentLog, accepts: () => accepts };
}

function makeResponse() {
    return {
        headersSent: false,
        locals: {},
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        type() {
            return this;
        },
        send(body) {
            this.sent = body;
            return this;
        },
        render(view, locals, callback) {
            this.view = view;
            this.locals = locals;
            callback(null, "<html></html>");
        },
    };
}

test("unknown errors become a generic 500 without leaking the message", () => {
    const res = makeResponse();
    errorHandler(new Error("ER_ACCESS_DENIED for user root@localhost"), makeRequest({ path: "/api/v1/x" }), res, () => {});

    assert.equal(res.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /ER_ACCESS_DENIED|root/);
    assert.equal(res.body.error.status, 500);
});

test("client errors keep their status and render the HTML error page", () => {
    const error = Object.assign(new Error("entity too large"), { status: 413 });
    const res = makeResponse();
    errorHandler(error, makeRequest(), res, () => {});

    assert.equal(res.statusCode, 413);
    assert.equal(res.view, "error");
    assert.equal(res.locals.status, 413);
    assert.equal(res.locals.user, null);
});

test("invalid status codes fall back to 500", () => {
    const res = makeResponse();
    errorHandler(Object.assign(new Error("x"), { status: 200 }), makeRequest({ accepts: "json" }), res, () => {});

    assert.equal(res.statusCode, 500);
});

test("falls back to plain text when the error page cannot render", () => {
    const res = makeResponse();
    res.render = (view, locals, callback) => callback(new Error("template broken"));
    errorHandler(new Error("boom"), makeRequest(), res, () => {});

    assert.equal(res.statusCode, 500);
    assert.match(res.sent, /Something went wrong/);
});

test("delegates to Express when headers were already sent", () => {
    const res = makeResponse();
    res.headersSent = true;
    let delegated = null;
    const error = new Error("late");
    errorHandler(error, makeRequest(), res, (err) => {
        delegated = err;
    });

    assert.equal(delegated, error);
});
