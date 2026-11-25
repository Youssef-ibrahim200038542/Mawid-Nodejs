const { prisma, resetTestData, createUser, startServer, stopServer, createClient, testPassword } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

let server;
let baseUrl;

test.before(async () => {
    await resetTestData();
    ({ server, baseUrl } = await startServer());
});

test.after(async () => {
    await resetTestData();
    await stopServer(server);
});

test("signup creates the user, hashes the password and starts a session", async () => {
    const client = createClient(baseUrl);
    const res = await client.post("/signup", { form: { name: "Sara", email: "Sara@Example.test", password: "a-strong-password" } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/dashboard");

    const user = await prisma.user.findUnique({ where: { email: "sara@example.test" } });
    assert.ok(user);
    assert.match(user.passwordHash, /^\$2b\$12\$/);
    assert.equal(user.platformRole, "USER");
    assert.equal(user.locale, "en");

    const me = await client.get("/api/v1/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, "sara@example.test");
    assert.equal(JSON.stringify(me.data).includes("passwordHash"), false);
});

test("duplicate signup is rejected with 409", async () => {
    await createUser({ email: "taken@example.test" });
    const res = await createClient(baseUrl).post("/signup", { form: { name: "Dup", email: "taken@example.test", password: "a-strong-password" } });
    assert.equal(res.status, 409);
});

test("login with wrong password or unknown email returns 401 and no session", async () => {
    const user = await createUser();
    for (const form of [
        { email: user.email, password: "wrong-password" },
        { email: "nobody@example.test", password: testPassword },
    ]) {
        const client = createClient(baseUrl);
        assert.equal((await client.post("/login", { form })).status, 401);
        assert.equal((await client.get("/api/v1/auth/me")).status, 401);
    }
});

test("login regenerates the session id (no session fixation)", async () => {
    const user = await createUser();
    const client = createClient(baseUrl);
    await client.refreshCsrf(); // creates an anonymous session first
    const anonymousSessions = await prisma.session.findMany({ select: { sid: true } });

    await client.login(user.email);
    const me = await client.get("/api/v1/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.id, user.id);

    const sessions = await prisma.session.findMany({ where: { data: { contains: `"id":${user.id},` } }, select: { sid: true } });
    assert.equal(sessions.length, 1);
    assert.equal(anonymousSessions.some((s) => s.sid === sessions[0].sid), false);
});

test("logout destroys the session", async () => {
    const user = await createUser();
    const client = createClient(baseUrl);
    await client.login(user.email);
    assert.equal((await client.get("/api/v1/auth/me")).status, 200);

    const res = await client.post("/logout", { form: {} });
    assert.equal(res.status, 302);
    assert.equal((await client.get("/api/v1/auth/me")).status, 401);
    assert.equal(await prisma.session.count({ where: { data: { contains: `"id":${user.id},` } } }), 0);
});

test("an expired session is no longer accepted", async () => {
    const user = await createUser();
    const client = createClient(baseUrl);
    await client.login(user.email);
    assert.equal((await client.get("/api/v1/auth/me")).status, 200);

    await prisma.session.updateMany({
        where: { data: { contains: `"id":${user.id},` } },
        data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    assert.equal((await client.get("/api/v1/auth/me")).status, 401);
});

test("protected pages redirect and protected APIs return 401 when logged out", async () => {
    const client = createClient(baseUrl);
    const page = await client.get("/dashboard", { headers: { accept: "text/html" } });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/login");

    const api = await client.get("/api/v1/clinics");
    assert.equal(api.status, 401);
    assert.equal(api.data.error.code, "UNAUTHENTICATED");
});

test("regression: the CSRF token survives login and works on the very next write", async () => {
    const user = await createUser();
    const client = createClient(baseUrl);
    await client.post("/login", { form: { email: user.email, password: testPassword } });

    const [session] = await prisma.session.findMany({ where: { data: { contains: `"id":${user.id},` } } });
    const stored = JSON.parse(session.data).csrfToken;
    assert.match(stored, /^[A-Za-z0-9_-]{43}$/);

    assert.equal(await client.refreshCsrf(), stored);
    const res = await client.post("/api/v1/clinics", { json: { name: "Right After Login", slug: "right-after-login" } });
    assert.equal(res.status, 201);
});
