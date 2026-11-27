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

test("privilege checker: valid and invalid grant combinations (app and migrator)", () => {
    const { MIGRATOR_PRIVILEGES } = require("../src/config/db-privileges");
    const usage = "GRANT USAGE ON *.* TO `mawid_app`@`localhost` IDENTIFIED BY PASSWORD '*X'";
    const app = "GRANT SELECT, INSERT, UPDATE, DELETE ON `mawid`.* TO `mawid_app`@`localhost`";
    const migrator = "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON `mawid`.* TO `mawid_migrator`@`localhost`";
    const check = (lines, allowed) => grantProblems(lines, "mawid", allowed);

    // Valid: exactly the expected set, at database level.
    assert.deepEqual(check([usage, app]), []);
    assert.deepEqual(check([usage, migrator], MIGRATOR_PRIVILEGES), []);

    // Root / global privileges / GRANT OPTION / PROXY.
    assert.ok(check(["GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION"]).includes("global privileges: ALL PRIVILEGES"));
    assert.ok(check([usage, app, "GRANT SELECT ON *.* TO `mawid_app`@`localhost`"]).includes("global privileges: SELECT"));
    assert.ok(check([usage, app.replace(" TO", " WITH GRANT OPTION TO").replace(/ WITH GRANT OPTION TO (.*)$/, " TO $1 WITH GRANT OPTION")]).includes("GRANT OPTION on mawid"));
    assert.ok(check([usage, app, "GRANT PROXY ON ''@'%' TO 'mawid_app'@'localhost'"]).includes("PROXY grant"));

    // Unrelated databases, wildcard patterns, wrong scope.
    assert.ok(check([usage, app, "GRANT SELECT ON `car_rental`.* TO `mawid_app`@`localhost`"]).includes("privileges on another database: car_rental"));
    assert.ok(check([usage, "GRANT SELECT, INSERT, UPDATE, DELETE ON `mawid\_%`.* TO `mawid_app`@`localhost`"]).some((p) => p.startsWith("privileges on another database")));
    assert.ok(check([usage, "GRANT SELECT, INSERT, UPDATE, DELETE ON `mawid_test`.* TO `mawid_app`@`localhost`"]).some((p) => p.startsWith("missing required privileges")), "grants on the wrong database leave the right one uncovered");

    // Excessive privileges: DDL for the app, DROP / CREATE DATABASE-level rights for the migrator.
    assert.ok(check([usage, "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP ON `mawid`.* TO `mawid_app`@`localhost`"]).includes("more than the allowed privileges on mawid: CREATE, DROP"));
    assert.ok(check([usage, migrator.replace("REFERENCES", "REFERENCES, DROP")], MIGRATOR_PRIVILEGES).includes("more than the allowed privileges on mawid: DROP"));
    assert.ok(check([usage, "GRANT ALL PRIVILEGES ON `mawid`.* TO `mawid_app`@`localhost`"]).includes("more than the allowed privileges on mawid: ALL PRIVILEGES"));
    assert.ok(check(["GRANT CREATE ON *.* TO `mawid_migrator`@`localhost`", migrator], MIGRATOR_PRIVILEGES).includes("global privileges: CREATE"), "no CREATE DATABASE right");

    // Missing required privileges, table-level only grants, roles and unknown forms fail closed.
    assert.deepEqual(check([usage, "GRANT SELECT, INSERT ON `mawid`.* TO `mawid_app`@`localhost`"]), ["missing required privileges on mawid: UPDATE, DELETE"]);
    assert.deepEqual(check([usage, app], MIGRATOR_PRIVILEGES), ["missing required privileges on mawid: CREATE, ALTER, INDEX, REFERENCES"]);
    assert.ok(check([usage, "GRANT SELECT ON `mawid`.`users` TO `mawid_app`@`localhost`"]).some((p) => p.startsWith("missing required privileges")));
    assert.ok(check([usage, app, "GRANT `dba_role` TO `mawid_app`@`localhost`"]).some((p) => p.startsWith("unrecognised grant")));
    assert.deepEqual(check([]), ["missing required privileges on mawid: SELECT, INSERT, UPDATE, DELETE"]);

    // Problem texts never carry the password hash.
    assert.ok(check(["GRANT `r` TO `u`@`h` IDENTIFIED BY PASSWORD '*SECRETHASH'"]).every((p) => !p.includes("SECRETHASH")));
});

test("deploy/database/create-accounts.sql grants exactly what the checker allows, on the Mawid database only", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const { RUNTIME_PRIVILEGES, MIGRATOR_PRIVILEGES } = require("../src/config/db-privileges");
    const sql = fs.readFileSync(path.join(__dirname, "..", "deploy", "database", "create-accounts.sql"), "utf8");
    const grants = [...sql.matchAll(/^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s+'([^']+)'/gim)].map((m) => ({ privileges: m[1].split(",").map((p) => p.trim()), target: m[2], user: m[3] }));
    const byUser = Object.fromEntries(grants.map((g) => [g.user, g]));
    assert.deepEqual(new Set(byUser.mawid_app.privileges), RUNTIME_PRIVILEGES);
    assert.deepEqual(new Set(byUser.mawid_migrator.privileges), MIGRATOR_PRIVILEGES);
    assert.ok(!byUser.mawid_migrator.privileges.includes("DROP"), "no DROP for the migrator");
    for (const g of grants) assert.equal(g.target, "`{{DB}}`.*", "database-level grant on the Mawid database only");
    assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\*\.\*|WITH GRANT OPTION|ALL PRIVILEGES|car_rental/i);
    // The checker accepts these exact grants.
    assert.deepEqual(grantProblems(["GRANT USAGE ON *.* TO `mawid_migrator`@`localhost`", "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON `mawid`.* TO `mawid_migrator`@`localhost`"], "mawid", MIGRATOR_PRIVILEGES), []);
    assert.ok(grantProblems(["GRANT SELECT, DROP ON `mawid`.* TO `mawid_migrator`@`localhost`"], "mawid", MIGRATOR_PRIVILEGES).includes("more than the allowed privileges on mawid: DROP"));
});

test("every committed migration only uses statements the migrator account is allowed to run", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = path.join(__dirname, "..", "prisma", "migrations");
    for (const name of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory())) {
        const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8").replace(/--.*$/gm, "");
        const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
        for (const statement of statements) {
            assert.match(statement, /^(CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE `[a-z_]+` (ADD (COLUMN|CONSTRAINT)|ADD COLUMN[\s\S]*))/i, `${name}: unexpected statement: ${statement.slice(0, 60)}`);
            assert.doesNotMatch(statement, /\bDROP\b|\bRENAME\b|\bMODIFY\b|\bTRUNCATE\b/i, `${name}: destructive statement`);
        }
    }
});

test(".env.production.example is a placeholder-only template that satisfies the production checks once filled", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const dotenv = require("dotenv");
    const text = fs.readFileSync(path.join(__dirname, "..", ".env.production.example"), "utf8");
    const env = dotenv.parse(text);
    assert.equal(env.DATABASE_URL, undefined, "no migration credentials in the app template");
    for (const key of ["SESSION_SECRET", "DB_PASSWORD", "SMTP_PASSWORD", "SMTP_USER", "DB_HOST"]) assert.match(env[key], /^<[^>]+>$/, `${key} is a placeholder`);
    assert.equal(env.DB_USER, "mawid_app");
    const filled = { ...env, DB_PASSWORD: "x".repeat(24), WEB_APP_URL: "https://mawid.example", EMAIL_FROM: "Mawid <no-reply@mawid.example>", SMTP_HOST: "smtp.example", SMTP_PASSWORD: "p" };
    assert.doesNotThrow(() => assertRuntimeCredentials(filled));
    assert.doesNotThrow(() => assertProductionConfig(filled, { knownProviders: emailProvider.productionProviders }));
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
    const base = { NODE_ENV: "production", EMAIL_PROVIDER: "smtp", WEB_APP_URL: "https://mawid.example", APP_URL: "https://mawid.example", EMAIL_FROM: "Mawid <no-reply@mawid.example>", SMTP_HOST: "smtp.example" };
    assert.doesNotThrow(() => assertProductionConfig(base, { knownProviders: emailProvider.productionProviders }));
    assert.throws(() => assertProductionConfig({ ...base, SMTP_HOST: "" }, { knownProviders: ["smtp"] }), /SMTP_HOST/);
    assert.throws(() => assertProductionConfig({ ...base, WEB_APP_URL: "http://mawid.example" }, { knownProviders: ["smtp"] }), /https/);
    assert.throws(() => assertProductionConfig({ ...base, EMAIL_FROM: "" }, { knownProviders: ["smtp"] }), /EMAIL_FROM/);
    assert.throws(() => assertProductionConfig({ ...base, APP_URL: "" }, { knownProviders: ["smtp"] }), /APP_URL/);
    assert.throws(() => assertProductionConfig({ ...base, APP_URL: "http://mawid.example" }, { knownProviders: ["smtp"] }), /APP_URL/);
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
