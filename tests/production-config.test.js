// H2 / H3 checks. This file switches the process to NODE_ENV=production BEFORE loading the app
// (node --test runs every file in its own process). No database is reachable (tests/unit-env.js
// points it at a closed port), which also exercises the /readyz failure path.
process.env.NODE_ENV = "production";
process.env.WEB_APP_URL = "https://mawid.example";
process.env.TRUST_PROXY = "1";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { grantProblems, assertRuntimeCredentials } = require("../src/config/db-privileges");
const { assertProductionConfig } = require("../src/config/startup-checks");
const emailProvider = require("../src/modules/notifications/email-provider");

// ------------------------------------------------------------------ H2: least privilege

test("grant parser accepts exactly data privileges on the app's own database", () => {
    const ok = ["GRANT USAGE ON *.* TO `mawid_app`@`localhost` IDENTIFIED BY PASSWORD '*X'", "GRANT SELECT, INSERT, UPDATE, DELETE ON `mawid`.* TO `mawid_app`@`localhost`"];
    assert.deepEqual(grantProblems(ok, "mawid"), []);
    assert.deepEqual(grantProblems(["GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION"], "mawid"), ["global privileges: ALL PRIVILEGES"]);
    assert.deepEqual(grantProblems(["GRANT SELECT ON `car_rental`.* TO `mawid_app`@`localhost`"], "mawid"), ["privileges on another database: car_rental"]);
    assert.deepEqual(grantProblems(["GRANT SELECT, DROP, CREATE ON `mawid`.* TO `mawid_app`@`localhost`"], "mawid"), ["more than data privileges on mawid: DROP, CREATE"]);
    assert.deepEqual(grantProblems(["GRANT SELECT ON `mawid`.* TO `mawid_app`@`localhost` WITH GRANT OPTION"], "mawid"), ["GRANT OPTION on mawid"]);
    assert.deepEqual(grantProblems(["GRANT PROXY ON ''@'%' TO 'root'@'localhost' WITH GRANT OPTION"], "mawid"), ["PROXY grant"]);
    assert.deepEqual(grantProblems(["GRANT SELECT ON `mawid`.`users` TO `mawid_app`@`localhost`"], "mawid"), []);
});

test("production refuses root, weak passwords and migration credentials in the app process", () => {
    const good = { NODE_ENV: "production", DB_USER: "mawid_app", DB_PASSWORD: "x".repeat(24) };
    assert.doesNotThrow(() => assertRuntimeCredentials(good));
    assert.throws(() => assertRuntimeCredentials({ ...good, DB_USER: "root" }), /cannot be used in production/);
    assert.throws(() => assertRuntimeCredentials({ ...good, DB_USER: "" }), /cannot be used in production/);
    assert.throws(() => assertRuntimeCredentials({ ...good, DB_PASSWORD: "" }), /DB_PASSWORD/);
    assert.throws(() => assertRuntimeCredentials({ ...good, DATABASE_URL: "mysql://mawid_migrator:x@h/mawid" }), /must not be set/);
    assert.doesNotThrow(() => assertRuntimeCredentials({ NODE_ENV: "development", DB_USER: "root" }));
});

// ------------------------------------------------------------------ H3: email

test("production email config: smtp needs host and sender; development providers are refused", () => {
    const base = { NODE_ENV: "production", EMAIL_PROVIDER: "smtp", WEB_APP_URL: "https://mawid.example", EMAIL_FROM: "Mawid <no-reply@mawid.example>", SMTP_HOST: "smtp.example" };
    assert.doesNotThrow(() => assertProductionConfig(base, { knownProviders: emailProvider.productionProviders }));
    assert.throws(() => assertProductionConfig({ ...base, SMTP_HOST: "" }, { knownProviders: ["smtp"] }), /SMTP_HOST/);
    assert.throws(() => assertProductionConfig({ ...base, WEB_APP_URL: "http://mawid.example" }, { knownProviders: ["smtp"] }), /https/);
    assert.throws(() => assertProductionConfig({ ...base, EMAIL_FROM: "" }, { knownProviders: ["smtp"] }), /EMAIL_FROM/);
    assert.throws(() => assertProductionConfig({ ...base, SMTP_USER: "u" }, { knownProviders: ["smtp"] }), /SMTP_PASSWORD/);
    for (const dev of ["none", "log", "outbox", "memory"]) {
        assert.throws(() => assertProductionConfig({ ...base, EMAIL_PROVIDER: dev }, { knownProviders: ["smtp"] }), /cannot be used in production/);
    }
});

test("SMTP results are classified: 5xx permanent, 4xx / network retryable, rejected recipient permanent", async () => {
    const send = (behaviour) => emailProvider.providers.smtp.send({ to: "a@x.test", subject: "s", text: "secret link" }, { transporter: { sendMail: behaviour } });
    assert.deepEqual(await send(async () => ({ rejected: [] })), { status: "SENT" });
    await assert.rejects(send(async () => ({ rejected: ["a@x.test"] })), { code: "RECIPIENT_REJECTED", permanent: true });
    await assert.rejects(send(async () => { throw Object.assign(new Error("550 no such user"), { responseCode: 550 }); }), { code: "SMTP_550", permanent: true });
    await assert.rejects(send(async () => { throw Object.assign(new Error("421 try later"), { responseCode: 421 }); }), { code: "SMTP_421", permanent: false });
    await assert.rejects(send(async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNECTION" }); }), { code: "ECONNECTION", permanent: false });
    await assert.rejects(send(async () => { throw Object.assign(new Error("bad auth"), { code: "EAUTH" }); }), { code: "EAUTH", permanent: false });
});

// ------------------------------------------------------------------ H3: HTTP hardening (production mode)

let server;
let base;
test.before(async () => {
    const app = require("../src/app");
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = { host: "127.0.0.1", port: server.address().port };
});
test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    require("../src/session").store.shutdown();
    await require("../src/config/database").$disconnect().catch(() => {});
});

function request(path, { method = "GET", headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ ...base, path, method, headers, agent: false }, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on("error", reject);
        req.end();
    });
}

test("health endpoints answer over plain HTTP without a session; readiness reports the database", async () => {
    const live = await request("/healthz");
    assert.equal(live.status, 200);
    assert.deepEqual(JSON.parse(live.body), { status: "ok" });
    assert.equal(live.headers["set-cookie"], undefined);
    const ready = await request("/readyz");
    assert.equal(ready.status, 503, "database unreachable → not ready");
    assert.deepEqual(JSON.parse(ready.body), { status: "unavailable" });
});

test("plain HTTP is redirected to the configured https origin (never the Host header) or refused", async () => {
    const res = await request("/clinics?x=1", { headers: { host: "evil.example" } });
    assert.equal(res.status, 308);
    assert.equal(res.headers.location, "https://mawid.example/clinics?x=1");
    const post = await request("/api/v1/auth/login", { method: "POST" });
    assert.equal(post.status, 403);
    assert.equal(JSON.parse(post.body).error.code, "HTTPS_REQUIRED");
});

test("over HTTPS (via the trusted proxy): strict headers, CSP and a __Host- session cookie", async () => {
    const res = await request("/api/v1/auth/csrf", { headers: { "x-forwarded-proto": "https" } });
    assert.equal(res.status, 200);
    const csp = res.headers["content-security-policy"];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /upgrade-insecure-requests/);
    assert.doesNotMatch(csp, /https:/, "no wildcard external sources");
    assert.match(res.headers["strict-transport-security"], /max-age=31536000/);
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["x-powered-by"], undefined);
    assert.equal(res.headers["access-control-allow-origin"], undefined, "no CORS: same-origin only");
    const cookie = res.headers["set-cookie"].join(";");
    assert.match(cookie, /^__Host-mawid\.sid=/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/i);
});

test("errors never expose stack traces or internals", async () => {
    const res = await request("/api/v1/clinics/x/doctors", { headers: { "x-forwarded-proto": "https" } });
    assert.equal(res.status, 401);
    assert.doesNotMatch(res.body, /at .+\.js:\d+|Error:|prisma/i);
});
