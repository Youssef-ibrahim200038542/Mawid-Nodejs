// Must be the first require in every integration test file.
const { TEST_DATABASE } = require("./env");
const bcrypt = require("bcrypt");
const prisma = require("../../src/config/database");

// Checks the database the live connection is actually using — not just the config.
async function assertConnectedToTestDatabase() {
    const [{ db }] = await prisma.$queryRaw`SELECT DATABASE() AS db`;
    if (db !== TEST_DATABASE) {
        throw new Error(`Connected to "${db}", expected "${TEST_DATABASE}". Aborting before touching any data.`);
    }
    return db;
}

// Empties Mawid's tables inside mawid_test only, children before parents. No TRUNCATE/DROP.
async function resetTestData() {
    await assertConnectedToTestDatabase();
    await prisma.$transaction([
        prisma.auditLog.deleteMany(),
        prisma.registration.deleteMany(),
        prisma.event.deleteMany(),
        prisma.clinicMember.deleteMany(),
        prisma.clinic.deleteMany(),
        prisma.session.deleteMany(),
        prisma.user.deleteMany(),
    ]);
}

let userCounter = 0;
const testPassword = "integration-password-1";
let testPasswordHash;

async function createUser(overrides = {}) {
    await assertConnectedToTestDatabase();
    testPasswordHash ??= await bcrypt.hash(testPassword, 4);
    userCounter += 1;
    return prisma.user.create({
        data: {
            name: `Test User ${userCounter}`,
            email: `user-${process.pid}-${userCounter}@example.test`,
            passwordHash: testPasswordHash,
            ...overrides,
        },
    });
}

async function createClinicWithMember({ slug, userId, role = "OWNER", memberStatus = "ACTIVE", clinicStatus = "ACTIVE" }) {
    await assertConnectedToTestDatabase();
    const clinic = await prisma.clinic.create({ data: { slug, name: `Clinic ${slug}`, status: clinicStatus } });
    await prisma.clinicMember.create({ data: { clinicId: clinic.id, userId, role, status: memberStatus } });
    return clinic;
}

async function addMember(clinicId, userId, role, status = "ACTIVE") {
    await assertConnectedToTestDatabase();
    return prisma.clinicMember.create({ data: { clinicId, userId, role, status } });
}

// Starts the real Express app on an ephemeral port.
async function startServer() {
    await assertConnectedToTestDatabase();
    const app = require("../../src/app");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server) {
    if (server) await new Promise((resolve) => server.close(resolve));
    require("../../src/session").store.shutdown();
    await prisma.$disconnect();
}

// Minimal cookie-keeping HTTP client.
function createClient(baseUrl) {
    let cookie = "";
    let csrfToken = null;

    async function request(method, url, { form, json, csrf = true, headers = {} } = {}) {
        const finalHeaders = { accept: "application/json", ...headers };
        if (cookie) finalHeaders.cookie = cookie;
        if (csrf && csrfToken && !["GET", "HEAD"].includes(method)) finalHeaders["x-csrf-token"] = csrfToken;
        let body;
        if (form) {
            finalHeaders["content-type"] = "application/x-www-form-urlencoded";
            body = new URLSearchParams(form);
        } else if (json !== undefined) {
            finalHeaders["content-type"] = "application/json";
            body = typeof json === "string" ? json : JSON.stringify(json);
        }
        const res = await fetch(baseUrl + url, { method, headers: finalHeaders, body, redirect: "manual" });
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) cookie = setCookie.split(";")[0];
        const text = await res.text();
        let data = text;
        try {
            data = JSON.parse(text);
        } catch {
            // HTML response
        }
        return { status: res.status, data, headers: res.headers };
    }

    return {
        request,
        get: (url, options) => request("GET", url, options),
        post: (url, options) => request("POST", url, options),
        patch: (url, options) => request("PATCH", url, options),
        async refreshCsrf() {
            csrfToken = (await request("GET", "/api/v1/auth/csrf")).data.csrfToken;
            return csrfToken;
        },
        async login(email, password = testPassword) {
            const res = await request("POST", "/login", { form: { email, password } });
            await this.refreshCsrf();
            return res;
        },
        setCsrf(token) {
            csrfToken = token;
        },
        get csrfToken() {
            return csrfToken;
        },
    };
}

module.exports = {
    TEST_DATABASE,
    prisma,
    testPassword,
    assertConnectedToTestDatabase,
    resetTestData,
    createUser,
    createClinicWithMember,
    addMember,
    startServer,
    stopServer,
    createClient,
};
