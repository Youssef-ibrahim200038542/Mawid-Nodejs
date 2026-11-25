const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createLimiter } = require("../src/middleware/rate-limit");
const errorHandler = require("../src/middleware/error-handler");

async function withServer(app, run) {
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function buildApp(limiterOptions, statusFor) {
    const app = express();
    app.use((req, res, next) => {
        req.log = { error() {}, warn() {} };
        next();
    });
    app.post("/attempt", createLimiter(limiterOptions), (req, res) => {
        res.status(statusFor(req)).json({ ok: true });
    });
    app.use(errorHandler);
    return app;
}

test("blocks requests over the limit with a 429 JSON error", async () => {
    const app = buildApp({ windowMs: 60_000, limit: 2 }, () => 200);

    await withServer(app, async (base) => {
        const send = () => fetch(`${base}/attempt`, { method: "POST", headers: { accept: "application/json" } });
        assert.equal((await send()).status, 200);
        assert.equal((await send()).status, 200);

        const blocked = await send();
        assert.equal(blocked.status, 429);
        assert.equal((await blocked.json()).error.status, 429);
    });
});

test("skipSuccessfulRequests only counts failed attempts", async () => {
    let nextStatus = 200;
    const app = buildApp({ windowMs: 60_000, limit: 2, skipSuccessfulRequests: true }, () => nextStatus);

    await withServer(app, async (base) => {
        const send = () => fetch(`${base}/attempt`, { method: "POST", headers: { accept: "application/json" } });
        for (let i = 0; i < 5; i += 1) {
            assert.equal((await send()).status, 200);
        }

        nextStatus = 401;
        assert.equal((await send()).status, 401);
        assert.equal((await send()).status, 401);
        assert.equal((await send()).status, 429);
    });
});
