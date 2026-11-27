// Must be the first require in every integration test file.
const { TEST_DATABASE } = require("./env");
// Account emails are kept in memory so tests can follow the emailed links (test-only provider).
process.env.EMAIL_PROVIDER = "memory";
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

// Empties Mawid's tables inside the pinned test database only, children before parents.
// No TRUNCATE/DROP. clinic_members ↔ clinic_invitations reference each other (RESTRICT), so the
// trust link is cleared first (back to LEGACY_UNREVIEWED, which the CHECK constraint allows).
// Destructive: only the dedicated, disposable integration database may be emptied. `mawid_test`
// holds the owner's manual browser-test data and is refused unless MAWID_ALLOW_RESET_MAWID_TEST=1
// is set explicitly for that run.
const RESETTABLE_DATABASE = "mawid_test_it";
async function resetTestData() {
    const db = await assertConnectedToTestDatabase();
    if (db !== RESETTABLE_DATABASE && !(db === "mawid_test" && process.env.MAWID_ALLOW_RESET_MAWID_TEST === "1")) {
        throw new Error(`Refusing to empty "${db}": integration tests only reset "${RESETTABLE_DATABASE}". Run them with npm run test:integration.`);
    }
    await prisma.$transaction([
        prisma.clinicMember.updateMany({ data: { trustState: "LEGACY_UNREVIEWED", trustSource: null, trustedAt: null, trustedViaInvitationId: null } }),
        prisma.authToken.deleteMany(),
        prisma.authRateBucket.deleteMany(),
        prisma.auditLog.deleteMany(),
        prisma.registration.deleteMany(),
        prisma.event.deleteMany(),
        prisma.appointment.deleteMany(),
        prisma.patient.deleteMany(),
        prisma.scheduleException.deleteMany(),
        prisma.workingHours.deleteMany(),
        prisma.doctorService.deleteMany(),
        prisma.doctorSpecialty.deleteMany(),
        prisma.doctorProfile.deleteMany(),
        prisma.service.deleteMany(),
        prisma.specialty.deleteMany(),
        prisma.clinicInvitation.deleteMany(),
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
            // Fixtures are verified accounts unless a test says otherwise.
            emailVerifiedAt: new Date(),
            ...overrides,
        },
    });
}

// Test fixture shortcut: memberships are created TRUSTED (as if their owner had created the
// clinic) unless { trusted: false } asks for a pre-H1 LEGACY_UNREVIEWED membership.
const trustedFixture = () => ({ trustState: "TRUSTED", trustSource: "CLINIC_CREATOR", trustedAt: new Date() });

async function createClinicWithMember({ slug, userId, role = "OWNER", memberStatus = "ACTIVE", clinicStatus = "ACTIVE", trusted = true }) {
    await assertConnectedToTestDatabase();
    const clinic = await prisma.clinic.create({ data: { slug, name: `Clinic ${slug}`, status: clinicStatus } });
    await prisma.clinicMember.create({ data: { clinicId: clinic.id, userId, role, status: memberStatus, ...(trusted ? trustedFixture() : {}) } });
    return clinic;
}

async function addMember(clinicId, userId, role, status = "ACTIVE", { trusted = true } = {}) {
    await assertConnectedToTestDatabase();
    return prisma.clinicMember.create({ data: { clinicId, userId, role, status, ...(trusted ? trustedFixture() : {}) } });
}

// The most recent email sent to an address, and the token from its link (#token=…).
const sentEmails = () => require("../../src/modules/notifications/email-provider").providers.memory.sent;
async function waitForEmail(to, { since = 0, purpose = null, timeoutMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const found = sentEmails().filter((m) => m.to === to && m.at.getTime() >= since && (!purpose || m.purpose === purpose)).at(-1);
        if (found) {
            const match = /#token=([A-Za-z0-9_-]+)/.exec(found.text);
            return { ...found, token: match ? match[1] : null };
        }
        if (Date.now() > deadline) throw new Error(`No email to ${to}${purpose ? ` (${purpose})` : ""}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
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
        put: (url, options) => request("PUT", url, options),
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
    waitForEmail,
    sentEmails,
    startServer,
    stopServer,
    createClient,
};
