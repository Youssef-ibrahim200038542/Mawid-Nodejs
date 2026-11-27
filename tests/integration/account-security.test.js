// Account security (H1) against a real database. NOT run by default: the integration harness empties
// the pinned test database. Run only with the owner's approval, preferably on the dedicated
// mawid_test_it database:  MAWID_IT=1 npm run test:integration
const { prisma, resetTestData, createUser, addMember, startServer, stopServer, createClient, waitForEmail, testPassword } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const delivery = require("../../src/modules/auth/auth-delivery");
const { takeEmailQuota } = require("../../src/modules/auth/rate-buckets");

let server;
let baseUrl;

test.before(async () => {
    await resetTestData();
    ({ server, baseUrl } = await startServer());
});

test.after(async () => {
    try {
        await resetTestData();
    } finally {
        await stopServer(server);
    }
});

async function anonymous() {
    const client = createClient(baseUrl);
    await client.refreshCsrf();
    return client;
}

async function apiLogin(email, password = testPassword) {
    const client = await anonymous();
    const res = await client.post("/api/v1/auth/login", { json: { email, password } });
    assert.equal(res.status, 200, `login ${email}`);
    client.setCsrf(res.data.csrfToken);
    return client;
}

// ---------------------------------------------------------------- email verification

test("email verification: valid once, then reused / invalid / expired / superseded / other-email tokens fail", async () => {
    const since = Date.now();
    const client = await anonymous();
    await client.post("/api/v1/auth/signup", { json: { name: "Vera", email: "vera@example.test", password: "a-strong-password" } });
    const first = await waitForEmail("vera@example.test", { since, purpose: "EMAIL_VERIFY" });
    assert.ok(first.token);

    // Resend supersedes the first token.
    const logged = await apiLogin("vera@example.test", "a-strong-password");
    const resent = await logged.post("/api/v1/auth/verify-email/resend", { json: {} });
    assert.equal(resent.status, 429, "cooldown right after signup");
    await prisma.authToken.updateMany({ where: { email: "vera@example.test" }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const since2 = Date.now();
    assert.equal((await logged.post("/api/v1/auth/verify-email/resend", { json: {} })).data.delivery, "sent");
    const second = await waitForEmail("vera@example.test", { since: since2, purpose: "EMAIL_VERIFY" });
    assert.notEqual(second.token, first.token);
    assert.equal((await client.post("/api/v1/auth/verify-email", { json: { token: first.token } })).data.error.code, "TOKEN_INVALID", "superseded");
    assert.equal((await client.post("/api/v1/auth/verify-email", { json: { token: "not-a-token" } })).data.error.code, "TOKEN_INVALID");

    assert.equal((await client.post("/api/v1/auth/verify-email", { json: { token: second.token } })).status, 200);
    assert.equal((await client.post("/api/v1/auth/verify-email", { json: { token: second.token } })).data.error.code, "TOKEN_INVALID", "single use");
    assert.ok((await prisma.user.findUnique({ where: { email: "vera@example.test" } })).emailVerifiedAt);

    // Expired, and issued for an address the account no longer has.
    const expiredUser = await createUser({ email: "late@example.test", emailVerifiedAt: null });
    const late = await apiLogin("late@example.test");
    await prisma.authToken.updateMany({ where: { userId: expiredUser.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const since3 = Date.now();
    await late.post("/api/v1/auth/verify-email/resend", { json: {} });
    const lateMail = await waitForEmail("late@example.test", { since: since3 });
    await prisma.authToken.updateMany({ where: { userId: expiredUser.id, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await client.post("/api/v1/auth/verify-email", { json: { token: lateMail.token } })).data.error.code, "TOKEN_INVALID", "expired");

    const moved = await createUser({ email: "moved@example.test", emailVerifiedAt: null });
    const movedClient = await apiLogin("moved@example.test");
    const since4 = Date.now();
    await movedClient.post("/api/v1/auth/verify-email/resend", { json: {} });
    const movedMail = await waitForEmail("moved@example.test", { since: since4 });
    await prisma.user.update({ where: { id: moved.id }, data: { email: "moved-new@example.test" } });
    assert.equal((await client.post("/api/v1/auth/verify-email", { json: { token: movedMail.token } })).data.error.code, "TOKEN_INVALID", "bound to the old email");
    assert.equal((await prisma.user.findUnique({ where: { id: moved.id } })).emailVerifiedAt, null);
});

test("an unverified account cannot open a clinic or reach the platform console", async () => {
    await createUser({ email: "unverified-owner@example.test", emailVerifiedAt: null });
    const client = await apiLogin("unverified-owner@example.test");
    const res = await client.post("/api/v1/clinics", { json: { name: "Nope Clinic", slug: "nope-clinic" } });
    assert.equal(res.status, 403);
    assert.equal(res.data.error.code, "EMAIL_NOT_VERIFIED");
    assert.equal(await prisma.clinic.count({ where: { slug: "nope-clinic" } }), 0);

    await createUser({ email: "unverified-admin@example.test", emailVerifiedAt: null, platformRole: "SUPER_ADMIN" });
    const admin = await apiLogin("unverified-admin@example.test");
    assert.equal((await admin.get("/api/v1/admin/overview")).data.error.code, "EMAIL_NOT_VERIFIED");
});

// ---------------------------------------------------------------- password reset & sessions

test("forgot password answers identically for known and unknown addresses", async () => {
    await createUser({ email: "known@example.test" });
    const a = await (await anonymous()).post("/api/v1/auth/password/forgot", { json: { email: "known@example.test" } });
    const b = await (await anonymous()).post("/api/v1/auth/password/forgot", { json: { email: "unknown-person@example.test" } });
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    assert.deepEqual(a.data, b.data);
    await waitForEmail("known@example.test", { purpose: "PASSWORD_RESET" });
});

test("password reset: works once, invalidates every session (legacy and SPA), old password dead", async () => {
    const user = await createUser({ email: "reset-me@example.test" });
    const spa = await apiLogin(user.email);
    const legacy = createClient(baseUrl);
    assert.equal((await legacy.login(user.email)).status, 302);
    assert.equal((await legacy.get("/dashboard")).status, 200);

    const since = Date.now();
    await (await anonymous()).post("/api/v1/auth/password/forgot", { json: { email: user.email } });
    const { token } = await waitForEmail(user.email, { since, purpose: "PASSWORD_RESET" });
    const resetter = await anonymous();
    assert.equal((await resetter.post("/api/v1/auth/password/reset", { json: { token, password: "brand-new-password" } })).status, 204);
    assert.equal((await resetter.post("/api/v1/auth/password/reset", { json: { token, password: "another-password" } })).data.error.code, "TOKEN_INVALID", "single use");

    assert.equal((await spa.get("/api/v1/auth/me")).status, 401, "SPA session revoked");
    assert.equal((await spa.get("/api/v1/clinics")).data.error.code, "SESSION_REVOKED");
    const page = await legacy.get("/dashboard");
    assert.equal(page.status, 302, "legacy session revoked");
    assert.equal(page.headers.get("location"), "/login");

    const old = await anonymous();
    assert.equal((await old.post("/api/v1/auth/login", { json: { email: user.email, password: testPassword } })).data.error.code, "INVALID_CREDENTIALS");
    await apiLogin(user.email, "brand-new-password");
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(after.sessionVersion, 1);

    // Expired reset token.
    const since2 = Date.now();
    await (await anonymous()).post("/api/v1/auth/password/forgot", { json: { email: user.email } });
    const second = await waitForEmail(user.email, { since: since2, purpose: "PASSWORD_RESET" });
    await prisma.authToken.updateMany({ where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal((await resetter.post("/api/v1/auth/password/reset", { json: { token: second.token, password: "x-password-9" } })).data.error.code, "TOKEN_INVALID");
});

test("sessions created before session versions existed (no sv) keep working", async () => {
    const user = await createUser({ email: "old-session@example.test" });
    const client = await apiLogin(user.email);
    // Strip `sv` from the stored session, as a pre-H1 session would look.
    const rows = await prisma.session.findMany();
    for (const row of rows) {
        const data = JSON.parse(row.data);
        if (data.user && data.user.id === user.id) {
            delete data.user.sv;
            await prisma.session.update({ where: { id: row.id }, data: { data: JSON.stringify(data) } });
        }
    }
    assert.equal((await client.get("/api/v1/auth/me")).status, 200);
});

// ---------------------------------------------------------------- invitations

async function clinicWithOwner(slug) {
    const owner = await createUser();
    const ownerClient = await apiLogin(owner.email);
    assert.equal((await ownerClient.post("/api/v1/clinics", { json: { name: `Clinic ${slug}`, slug } })).status, 201);
    const clinic = await prisma.clinic.findUnique({ where: { slug } });
    return { owner, ownerClient, clinic, P: `/api/v1/clinics/${slug}` };
}

test("invitation to an unregistered email: sign up, verify, then accept explicitly", async () => {
    const { ownerClient, clinic, P } = await clinicWithOwner("inv-new");
    const since = Date.now();
    assert.equal((await ownerClient.post(`${P}/invitations`, { json: { email: "Future.Doc@example.test", role: "DOCTOR" } })).status, 201);
    const mail = await waitForEmail("future.doc@example.test", { since });
    assert.equal(mail.purpose, "INVITATION_NEW_MEMBER");

    // An attacker who reserved nothing and holds another verified account cannot use the link.
    const attacker = await createUser({ email: "attacker@example.test" });
    const attackerClient = await apiLogin(attacker.email);
    assert.equal((await attackerClient.post("/api/v1/invitations/accept", { json: { token: mail.token } })).data.error.code, "INVITATION_EMAIL_MISMATCH");

    // Squatting: the address was registered by someone else who cannot verify it.
    const squatClient = await anonymous();
    await squatClient.post("/api/v1/auth/signup", { json: { name: "Squat", email: "future.doc@example.test", password: "squatter-pass" } });
    const squat = await apiLogin("future.doc@example.test", "squatter-pass");
    assert.equal((await squat.post("/api/v1/invitations/accept", { json: { token: mail.token } })).data.error.code, "EMAIL_NOT_VERIFIED");
    assert.equal(await prisma.clinicMember.count({ where: { clinicId: clinic.id } }), 1);

    // The real owner of the inbox takes the account back through password reset (which verifies it).
    const since2 = Date.now();
    await (await anonymous()).post("/api/v1/auth/password/forgot", { json: { email: "future.doc@example.test" } });
    const reset = await waitForEmail("future.doc@example.test", { since: since2, purpose: "PASSWORD_RESET" });
    await (await anonymous()).post("/api/v1/auth/password/reset", { json: { token: reset.token, password: "real-doctor-pass" } });
    assert.equal((await squat.get("/api/v1/auth/me")).status, 401, "squatter signed out");
    const doctor = await apiLogin("future.doc@example.test", "real-doctor-pass");

    const preview = await doctor.post("/api/v1/invitations/preview", { json: { token: mail.token } });
    assert.equal(preview.data.viewer.matchesInvitation, true);
    assert.equal((await doctor.post("/api/v1/invitations/accept", { json: { token: mail.token, role: "OWNER" } })).status, 400, "role can't be chosen by the invitee");
    const accepted = await doctor.post("/api/v1/invitations/accept", { json: { token: mail.token } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.role, "DOCTOR");
    assert.equal((await doctor.post("/api/v1/invitations/accept", { json: { token: mail.token } })).data.error.code, "INVITATION_NO_LONGER_VALID");
    assert.equal((await doctor.get(`${P}/doctors`)).status, 200, "trusted membership opens the workspace");
});

test("invitations: resend rotates the token, cooldown, revoke, expiry, decline, cross-clinic and role checks", async () => {
    const { ownerClient, P } = await clinicWithOwner("inv-life");
    const other = await clinicWithOwner("inv-other");
    const invitee = await createUser({ email: "life@example.test" });
    const inviteeClient = await apiLogin(invitee.email);

    const since = Date.now();
    const created = await ownerClient.post(`${P}/invitations`, { json: { email: invitee.email, role: "RECEPTIONIST" } });
    const id = created.data.invitation.id;
    const first = await waitForEmail(invitee.email, { since });
    assert.equal((await ownerClient.post(`${P}/invitations/${id}/resend`, { json: {} })).data.error.code, "INVITATION_COOLDOWN");
    assert.equal((await ownerClient.post(`${P}/invitations`, { json: { email: invitee.email, role: "RECEPTIONIST" } })).data.error.code, "INVITATION_COOLDOWN", "create → resend shares the cooldown");
    await prisma.clinicInvitation.update({ where: { id }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    const since2 = Date.now();
    assert.equal((await ownerClient.post(`${P}/invitations/${id}/resend`, { json: {} })).status, 200);
    const second = await waitForEmail(invitee.email, { since: since2 });
    assert.notEqual(second.token, first.token);
    assert.equal((await inviteeClient.post("/api/v1/invitations/accept", { json: { token: first.token } })).data.error.code, "INVITATION_INVALID", "old link dead");

    assert.equal((await other.ownerClient.post(`${other.P}/invitations/${id}/revoke`, { json: {} })).status, 404, "other clinic");
    assert.equal((await ownerClient.post(`${P}/invitations/${id}/revoke`, { json: {} })).status, 200);
    assert.equal((await inviteeClient.post("/api/v1/invitations/accept", { json: { token: second.token } })).data.error.code, "INVITATION_NO_LONGER_VALID", "revoked");

    const since3 = Date.now();
    await ownerClient.post(`${P}/invitations`, { json: { email: invitee.email, role: "RECEPTIONIST" } });
    const third = await waitForEmail(invitee.email, { since: since3 });
    await prisma.clinicInvitation.updateMany({ where: { email: invitee.email, status: "PENDING" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await inviteeClient.post("/api/v1/invitations/accept", { json: { token: third.token } })).status, 410, "expired");

    await prisma.clinicInvitation.updateMany({ where: { email: invitee.email, status: "PENDING" }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    const since4 = Date.now();
    await ownerClient.post(`${P}/invitations`, { json: { email: invitee.email, role: "RECEPTIONIST" } });
    const fourth = await waitForEmail(invitee.email, { since: since4 });
    assert.equal((await inviteeClient.post("/api/v1/invitations/decline", { json: { token: fourth.token } })).status, 204);
    assert.equal((await inviteeClient.post("/api/v1/invitations/accept", { json: { token: fourth.token } })).data.error.code, "INVITATION_NO_LONGER_VALID");
    const declined = await prisma.clinicInvitation.findFirst({ where: { email: invitee.email, status: "DECLINED" } });
    assert.ok(declined.declinedAt);
    assert.equal(declined.declinedByUserId, invitee.id);
});

test("concurrent creates leave one open invitation; concurrent accepts create one membership", async () => {
    const { ownerClient, clinic, P } = await clinicWithOwner("inv-race");
    const invitee = await createUser({ email: "race@example.test" });
    const results = await Promise.all(Array.from({ length: 5 }, () => ownerClient.post(`${P}/invitations`, { json: { email: invitee.email, role: "DOCTOR" } })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => ["INVITATION_COOLDOWN", "RATE_LIMITED"].includes(r.data.error.code)));
    assert.equal(await prisma.clinicInvitation.count({ where: { clinicId: clinic.id, status: "PENDING" } }), 1);

    const { token } = await waitForEmail(invitee.email);
    const inviteeClient = await apiLogin(invitee.email);
    const accepts = await Promise.all(Array.from({ length: 5 }, () => inviteeClient.post("/api/v1/invitations/accept", { json: { token } })));
    assert.equal(accepts.filter((r) => r.status === 200).length, 1);
    assert.equal(await prisma.clinicMember.count({ where: { clinicId: clinic.id, userId: invitee.id } }), 1);
});

test("only members:manage may invite; tenants cannot see each other's invitations", async () => {
    const { ownerClient, clinic, P } = await clinicWithOwner("inv-perm");
    const receptionist = await createUser();
    await addMember(clinic.id, receptionist.id, "RECEPTIONIST");
    const recClient = await apiLogin(receptionist.email);
    assert.equal((await recClient.post(`${P}/invitations`, { json: { email: "x@example.test", role: "OWNER" } })).status, 403);
    assert.equal((await recClient.get(`${P}/invitations`)).status, 403);
    const outsider = await clinicWithOwner("inv-perm-2");
    assert.equal((await outsider.ownerClient.get(`${P}/invitations`)).status, 404);
    assert.equal((await ownerClient.get(`${P}/invitations`)).status, 200);
});

// ---------------------------------------------------------------- legacy memberships

test("legacy memberships stay closed for every role until re-confirmed; Super Admin only starts the bootstrap", async () => {
    const clinic = await prisma.clinic.create({ data: { slug: "legacy-clinic", name: "Legacy Clinic" } });
    const owner = await createUser({ email: "legacy-owner@example.test" });
    const doctorUser = await createUser({ email: "legacy-doc@example.test" });
    const ownerMember = await addMember(clinic.id, owner.id, "OWNER", "ACTIVE", { trusted: false });
    const doctorMember = await addMember(clinic.id, doctorUser.id, "DOCTOR", "ACTIVE", { trusted: false });
    const P = "/api/v1/clinics/legacy-clinic";

    const ownerClient = await apiLogin(owner.email);
    const doctorClient = await apiLogin(doctorUser.email);
    for (const client of [ownerClient, doctorClient]) {
        assert.equal((await client.get(`${P}/appointments`)).data.error.code, "MEMBERSHIP_RECONFIRMATION_REQUIRED", "verified email alone is not enough");
    }
    const me = await ownerClient.get("/api/v1/auth/me");
    assert.equal(me.data.clinics[0].trustState, "LEGACY_UNREVIEWED");

    const admin = await createUser({ platformRole: "SUPER_ADMIN" });
    const adminClient = await apiLogin(admin.email);
    assert.equal((await adminClient.post(`/api/v1/admin/clinics/${clinic.id}/owner-reconfirmations`, { json: { memberId: doctorMember.id } })).data.error.code, "RECONFIRM_NOT_ALLOWED", "owners only");
    const since = Date.now();
    assert.equal((await adminClient.post(`/api/v1/admin/clinics/${clinic.id}/owner-reconfirmations`, { json: { memberId: ownerMember.id } })).status, 201);
    assert.equal((await prisma.clinicMember.findUnique({ where: { id: ownerMember.id } })).trustState, "LEGACY_UNREVIEWED", "admin cannot grant trust");
    const mail = await waitForEmail(owner.email, { since });
    assert.equal(mail.purpose, "INVITATION_RECONFIRM");
    assert.equal((await ownerClient.post("/api/v1/invitations/accept", { json: { token: mail.token } })).data.kind, "RECONFIRM");
    const trustedOwner = await prisma.clinicMember.findUnique({ where: { id: ownerMember.id } });
    assert.equal(trustedOwner.trustState, "TRUSTED");
    assert.equal(trustedOwner.trustSource, "RECONFIRMATION");
    assert.equal(await prisma.clinicMember.count({ where: { clinicId: clinic.id } }), 2, "same rows, no duplicates");
    assert.equal((await ownerClient.get(`${P}/appointments`)).status, 200);
    assert.equal((await adminClient.post(`/api/v1/admin/clinics/${clinic.id}/owner-reconfirmations`, { json: { memberId: ownerMember.id } })).data.error.code, "RECONFIRM_NOT_ALLOWED");

    // The trusted owner re-confirms the doctor; a role change in between makes the link stale.
    const since2 = Date.now();
    assert.equal((await ownerClient.post(`${P}/members/${doctorMember.id}/reconfirmations`, { json: {} })).status, 201);
    const docMail = await waitForEmail(doctorUser.email, { since: since2 });
    await ownerClient.patch(`${P}/members/${doctorMember.id}`, { json: { role: "RECEPTIONIST" } });
    assert.equal((await doctorClient.post("/api/v1/invitations/accept", { json: { token: docMail.token } })).data.error.code, "INVITATION_STALE");
    assert.equal((await prisma.clinicMember.findUnique({ where: { id: doctorMember.id } })).trustState, "LEGACY_UNREVIEWED");
});

test("a doctor whose membership is not re-confirmed is hidden from booking and refused server-side", async () => {
    const clinic = await prisma.clinic.create({ data: { slug: "book-legacy", name: "Book Legacy" } });
    const doctorUser = await createUser();
    const member = await addMember(clinic.id, doctorUser.id, "DOCTOR", "ACTIVE", { trusted: false });
    const doctor = await prisma.doctorProfile.create({ data: { clinicId: clinic.id, memberId: member.id, displayNameEn: "Dr Legacy" } });
    const service = await prisma.service.create({ data: { clinicId: clinic.id, nameEn: "Checkup", durationMinutes: 30, priceMinor: 10000 } });
    await prisma.doctorService.create({ data: { clinicId: clinic.id, doctorId: doctor.id, serviceId: service.id } });

    const visitor = createClient(baseUrl);
    const page = await visitor.get("/api/v1/public/clinics/book-legacy");
    assert.equal(page.data.doctors.length, 0);
    const availability = await visitor.get(`/api/v1/public/clinics/book-legacy/availability?serviceId=${service.id}`);
    assert.equal(availability.data.doctors.length, 0);

    const patient = await apiLogin((await createUser()).email);
    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 11) + "10:00";
    const booking = await patient.post("/api/v1/public/clinics/book-legacy/appointments", { json: { doctorId: doctor.id, serviceId: service.id, startsAt } });
    assert.equal(booking.data.error.code, "DOCTOR_NOT_BOOKABLE");
});

// ---------------------------------------------------------------- rate buckets & delivery recovery (real database)

test("per-email rate bucket: 10 concurrent transactions allow exactly the limit", async () => {
    const now = new Date();
    const outcomes = await Promise.all(
        Array.from({ length: 10 }, () => prisma.$transaction((tx) => takeEmailQuota(tx, { kind: "PASSWORD_RESET", email: "bucket@example.test", limit: 3, now }), { isolationLevel: "ReadCommitted" }))
    );
    assert.equal(outcomes.filter(Boolean).length, 3);
    const [bucket] = await prisma.authRateBucket.findMany({ where: { kind: "PASSWORD_RESET" } });
    assert.equal(bucket.requestCount, 10);
    assert.doesNotMatch(bucket.keyHash, /bucket/);
});

test("delivery recovery resends a generation interrupted before sending, with a new token", async () => {
    const user = await createUser({ email: "recover@example.test", emailVerifiedAt: null });
    const generation = await prisma.$transaction((tx) => delivery.createGeneration(tx, { userId: user.id, purpose: "EMAIL_VERIFY", email: user.email, now: new Date() }));
    // Simulate a crash: never sent. Recovery runs after the grace period.
    const since = Date.now();
    const result = await delivery.runRecoveryPass({ clock: () => new Date(Date.now() + delivery.QUEUED_GRACE_MS + 1000) });
    assert.ok(result.regenerated >= 1);
    const mail = await waitForEmail(user.email, { since });
    assert.ok(mail.token);
    assert.notEqual(require("../../src/lib/tokens").hashToken(mail.token), generation.tokenHash);
    const old = await prisma.authToken.findUnique({ where: { id: generation.id } });
    assert.equal(old.deliveryStatus, "REPLACED");
    assert.ok(old.consumedAt);
    assert.equal((await (await anonymous()).post("/api/v1/auth/verify-email", { json: { token: mail.token } })).status, 200);
});
