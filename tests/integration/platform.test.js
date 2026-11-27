const { prisma, resetTestData, createUser, addMember, startServer, stopServer, createClient, assertConnectedToTestDatabase, waitForEmail } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const { sendDueReminders } = require("../../src/modules/notifications/notification.service");

const zone = "Africa/Cairo";
let server;
let baseUrl;
const users = {};
const members = {};
const clients = {};
const ids = {};
let clinic;
let otherClinic;

let day = DateTime.now().setZone(zone).plus({ days: 3 }).startOf("day");
while (day.weekday !== 2) day = day.plus({ days: 1 }); // a Tuesday
const TUE = day.toISODate();
const local = (hhmm) => `${TUE}T${hhmm}`;
const P = "/api/v1/clinics/plat-p";

test.before(async () => {
    await resetTestData();
    ({ server, baseUrl } = await startServer());
    for (const key of ["owner", "owner2", "receptionist", "doctor", "patient", "stranger", "admin", "ownerQ", "newStaff"]) users[key] = await createUser();
    await prisma.user.update({ where: { id: users.admin.id }, data: { platformRole: "SUPER_ADMIN" } });

    clinic = await prisma.clinic.create({ data: { slug: "plat-p", name: "Platform Clinic", timezone: zone } });
    otherClinic = await prisma.clinic.create({ data: { slug: "plat-q", name: "Other" } });
    members.owner = await addMember(clinic.id, users.owner.id, "OWNER");
    members.receptionist = await addMember(clinic.id, users.receptionist.id, "RECEPTIONIST");
    members.doctor = await addMember(clinic.id, users.doctor.id, "DOCTOR");
    members.ownerQ = await addMember(otherClinic.id, users.ownerQ.id, "OWNER");

    for (const [key, user] of Object.entries(users)) {
        clients[key] = createClient(baseUrl);
        await clients[key].login(user.email);
    }
    const owner = clients.owner;
    ids.service = (await owner.post(`${P}/services`, { json: { nameEn: "Consultation", durationMinutes: 30, price: "250" } })).data.service.id;
    ids.doctor = (await owner.post(`${P}/doctors`, { json: { memberId: members.doctor.id, displayNameEn: "Dr. Plat", serviceIds: [ids.service] } })).data.doctor.id;
    await owner.put(`${P}/doctors/${ids.doctor}/working-hours`, { json: { intervals: [{ weekday: 2, start: "09:00", end: "17:00" }] } });
});

test.after(async () => {
    try {
        await resetTestData();
    } finally {
        await stopServer(server);
    }
});

// ---------------------------------------------------------------- JSON auth for the SPA

test("SPA auth: signup, profile update, logout, login — all CSRF-protected", async () => {
    const client = createClient(baseUrl);
    assert.equal((await client.post("/api/v1/auth/signup", { json: { name: "Spa User", email: "spa@example.test", password: "spa-password-1" } })).status, 403, "no CSRF token");

    const anonymousToken = await client.refreshCsrf();
    const signup = await client.post("/api/v1/auth/signup", { json: { name: "Spa User", email: "SPA@example.test", password: "spa-password-1", locale: "ar" } });
    assert.equal(signup.status, 202);
    assert.deepEqual(Object.keys(signup.data).sort(), ["message", "status"], "no user, no token, no session");
    assert.equal((await client.get("/api/v1/auth/me")).status, 401, "signup never logs in");
    const created = await prisma.user.findUnique({ where: { email: "spa@example.test" } });
    assert.equal(created.locale, "ar");
    assert.equal(created.emailVerifiedAt, null);

    const first = await client.post("/api/v1/auth/login", { json: { email: "spa@example.test", password: "spa-password-1" } });
    assert.equal(first.status, 200, "unverified accounts may log in (patients can still book)");
    assert.equal(first.data.user.emailVerified, false);
    assert.notEqual(first.data.csrfToken, anonymousToken, "a new session gets a new token");
    assert.equal(JSON.stringify(first.data).includes("passwordHash"), false);
    assert.equal((await client.patch("/api/v1/auth/me", { json: { locale: "en" } })).status, 403, "old token is dead");
    client.setCsrf(first.data.csrfToken);
    assert.equal((await client.patch("/api/v1/auth/me", { json: { locale: "en", name: "Spa Renamed" } })).data.user.name, "Spa Renamed");
    assert.equal((await client.patch("/api/v1/auth/me", { json: { platformRole: "SUPER_ADMIN" } })).status, 400, "can't self-promote");

    assert.equal((await client.post("/api/v1/auth/logout", { json: {} })).status, 204);
    assert.equal((await client.get("/api/v1/auth/me")).status, 401);

    await client.refreshCsrf();
    const wrong = await client.post("/api/v1/auth/login", { json: { email: "spa@example.test", password: "nope-nope-nope" } });
    assert.equal(wrong.data.error.code, "INVALID_CREDENTIALS");
    const unknown = await client.post("/api/v1/auth/login", { json: { email: "ghost@example.test", password: "nope-nope-nope" } });
    assert.equal(unknown.data.error.code, "INVALID_CREDENTIALS", "same answer for unknown accounts");
    const ok = await client.post("/api/v1/auth/login", { json: { email: "spa@example.test", password: "spa-password-1" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.clinics, []);
    client.setCsrf(ok.data.csrfToken);
    assert.equal((await client.get("/api/v1/auth/me")).data.user.name, "Spa Renamed");

    await client.refreshCsrf();
    assert.equal((await createClient(baseUrl).post("/api/v1/auth/signup", { json: {} })).status, 403);
    const anon = createClient(baseUrl);
    await anon.refreshCsrf();
    const dup = await anon.post("/api/v1/auth/signup", { json: { name: "Dup", email: "spa@example.test", password: "spa-password-1" } });
    assert.equal(dup.status, 202, "same answer for a taken address");
    assert.deepEqual(dup.data, signup.data);
});

// ---------------------------------------------------------------- staff membership

test("owners invite staff, who join only by accepting; guards stop lock-outs and invalid roles", async () => {
    const owner = clients.owner;
    assert.equal((await owner.post(`${P}/members`, { json: { email: users.newStaff.email, role: "RECEPTIONIST" } })).status, 410, "direct add by email is gone");
    const since = Date.now();
    const invited = await owner.post(`${P}/invitations`, { json: { email: users.newStaff.email.toUpperCase(), role: "RECEPTIONIST" } });
    assert.equal(invited.status, 201);
    assert.equal(await prisma.clinicMember.count({ where: { clinicId: clinic.id, userId: users.newStaff.id } }), 0, "no membership before acceptance");
    const { token } = await waitForEmail(users.newStaff.email, { since });
    const accepted = await clients.newStaff.post("/api/v1/invitations/accept", { json: { token } });
    assert.equal(accepted.status, 200);
    const joined = await prisma.clinicMember.findFirst({ where: { clinicId: clinic.id, userId: users.newStaff.id } });
    assert.equal(joined.trustState, "TRUSTED");
    assert.equal(joined.trustSource, "INVITATION");
    members.newStaff = { id: joined.id };
    assert.equal((await owner.post(`${P}/invitations`, { json: { email: users.newStaff.email, role: "DOCTOR" } })).data.error.code, "MEMBER_EXISTS");
    const unknown = await owner.post(`${P}/invitations`, { json: { email: "nobody-here@example.test", role: "DOCTOR" } });
    assert.equal(unknown.status, 201, "same answer whether or not the address has an account");
    assert.equal((await clients.receptionist.post(`${P}/invitations`, { json: { email: users.stranger.email, role: "OWNER" } })).status, 403);
    assert.equal((await clients.ownerQ.post(`${P}/invitations`, { json: { email: users.stranger.email, role: "OWNER" } })).status, 404);

    assert.equal((await owner.patch(`${P}/members/${members.owner.id}`, { json: { role: "RECEPTIONIST" } })).data.error.code, "CANNOT_CHANGE_SELF");
    assert.equal((await owner.patch(`${P}/members/${members.doctor.id}`, { json: { role: "RECEPTIONIST" } })).data.error.code, "MEMBER_HAS_DOCTOR_PROFILE");
    assert.equal((await clients.ownerQ.patch(`/api/v1/clinics/plat-q/members/${members.doctor.id}`, { json: { status: "DISABLED" } })).status, 404, "member of another clinic");

    // The new receptionist gets access now and loses it once disabled.
    await clients.newStaff.refreshCsrf();
    assert.equal((await clients.newStaff.get(`${P}/appointments`)).status, 200);
    assert.equal((await owner.patch(`${P}/members/${members.newStaff.id}`, { json: { status: "DISABLED" } })).data.member.status, "DISABLED");
    assert.equal((await clients.newStaff.get(`${P}/appointments`)).status, 404);

    const actions = (await prisma.auditLog.findMany({ where: { clinicId: clinic.id, action: { startsWith: "member." } }, select: { action: true } })).map((a) => a.action);
    assert.deepEqual(actions.sort(), ["member.added", "member.updated"]);
});

// ---------------------------------------------------------------- notifications

test("an online booking notifies the clinic staff, not the patient who made it", async () => {
    const booked = await clients.patient.post("/api/v1/public/clinics/plat-p/appointments", { json: { doctorId: ids.doctor, serviceId: ids.service, startsAt: local("10:00") } });
    assert.equal(booked.status, 201);
    ids.appointment = booked.data.appointment.id;

    const rows = await prisma.notification.findMany({ where: { appointmentId: ids.appointment }, select: { userId: true, type: true, emailStatus: true, payload: true } });
    assert.deepEqual(rows.map((r) => r.userId).sort(), [users.owner.id, users.receptionist.id, users.doctor.id].sort());
    // Integration runs use the in-memory email provider, so staff emails are queued (PENDING) / SENT.
    assert.ok(rows.every((r) => r.type === "APPOINTMENT_BOOKED" && ["PENDING", "SENT"].includes(r.emailStatus)));
    assert.equal(rows[0].payload.clinic.slug, "plat-p");
    assert.equal(rows[0].payload.audience, "staff");
});

test("staff confirmation notifies the patient; users only ever see their own notifications", async () => {
    await clients.receptionist.post(`${P}/appointments/${ids.appointment}/confirm`, { json: {} });
    const mine = await clients.patient.get("/api/v1/me/notifications");
    assert.equal(mine.data.unread, 1);
    assert.equal(mine.data.items[0].type, "APPOINTMENT_CONFIRMED");
    assert.equal(mine.data.items[0].payload.doctor.nameEn, "Dr. Plat");
    const notificationId = mine.data.items[0].id;

    assert.equal((await clients.stranger.post(`/api/v1/me/notifications/${notificationId}/read`, { json: {} })).status, 404);
    assert.equal((await clients.patient.post(`/api/v1/me/notifications/${notificationId}/read`, { json: {} })).status, 204);
    assert.equal((await clients.patient.get("/api/v1/me/notifications?unreadOnly=true")).data.total, 0);

    const ownerList = await clients.owner.get("/api/v1/me/notifications");
    assert.ok(ownerList.data.items.every((n) => n.type !== "APPOINTMENT_CONFIRMED"), "the actor's team isn't told about its own confirm");
    assert.ok((await clients.owner.post("/api/v1/me/notifications/read-all", { json: {} })).data.updated >= 1);
    assert.equal((await clients.owner.get("/api/v1/me/notifications")).data.unread, 0);
});

test("walk-in patients without an account get no notifications", async () => {
    const before = await prisma.notification.count();
    const res = await clients.receptionist.post(`${P}/appointments`, { json: { doctorId: ids.doctor, serviceId: ids.service, startsAt: local("11:00"), patient: { fullName: "No Account" } } });
    assert.equal(res.status, 201);
    assert.equal(await prisma.notification.count(), before);
});

test("24-hour reminders are created once, however often the job runs", async () => {
    await assertConnectedToTestDatabase();
    const patientRecord = await prisma.patient.findFirst({ where: { clinicId: clinic.id, userId: users.patient.id } });
    const soon = await prisma.appointment.create({
        data: {
            clinicId: clinic.id,
            doctorId: ids.doctor,
            serviceId: ids.service,
            patientId: patientRecord.id,
            startsAt: new Date(Date.now() + 24 * 3_600_000),
            endsAt: new Date(Date.now() + 24 * 3_600_000 + 30 * 60_000),
            status: "CONFIRMED",
            source: "STAFF",
            durationMinutes: 30,
            priceMinor: 25000,
            currency: "EGP",
        },
    });
    const first = await sendDueReminders();
    assert.ok(first.created >= 1);
    const second = await sendDueReminders();
    assert.equal(second.created, 0);
    assert.equal(await prisma.notification.count({ where: { appointmentId: soon.id, type: "APPOINTMENT_REMINDER" } }), 1);
});

test("a patient cancellation notifies staff", async () => {
    await clients.patient.post(`/api/v1/me/appointments/${ids.appointment}/cancel`, { json: {} });
    const rows = await prisma.notification.findMany({ where: { appointmentId: ids.appointment, type: "APPOINTMENT_CANCELLED" }, select: { userId: true } });
    assert.deepEqual(rows.map((r) => r.userId).sort(), [users.owner.id, users.receptionist.id, users.doctor.id].sort());
});

// ---------------------------------------------------------------- analytics & audit

test("analytics: owner-only, scoped to the clinic, consistent with the data", async () => {
    const from = day.minus({ days: 7 }).toISODate();
    const to = day.plus({ days: 7 }).toISODate();
    const res = await clients.owner.get(`${P}/analytics/overview?from=${from}&to=${to}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.daily.length, 15);
    const dbTotal = await prisma.appointment.count({ where: { clinicId: clinic.id, startsAt: { gte: new Date(DateTime.fromISO(from, { zone }).toUTC().toISO()), lt: new Date(DateTime.fromISO(to, { zone }).plus({ days: 1 }).toUTC().toISO()) } } });
    assert.equal(res.data.totals.appointments, dbTotal);
    assert.equal(res.data.daily.reduce((sum, d) => sum + d.total, 0), dbTotal);
    assert.ok(res.data.totals.byStatus.CANCELLED >= 1);
    assert.equal(res.data.byDoctor[0].id, ids.doctor);

    assert.equal((await clients.receptionist.get(`${P}/analytics/overview`)).status, 403);
    assert.equal((await clients.doctor.get(`${P}/analytics/overview`)).status, 403);
    assert.equal((await clients.ownerQ.get(`${P}/analytics/overview`)).status, 404);
    const q = await clients.ownerQ.get(`/api/v1/clinics/plat-q/analytics/overview`);
    assert.equal(q.data.totals.appointments, 0);
});

test("audit log: owners read their own clinic's trail only", async () => {
    const res = await clients.owner.get(`${P}/audit-logs?pageSize=100`);
    assert.equal(res.status, 200);
    assert.ok(res.data.total > 5);
    assert.ok(res.data.items.every((entry) => entry.actor === null || typeof entry.actor.email === "string"));
    const appointmentOnly = await clients.owner.get(`${P}/audit-logs?action=appointment.created`);
    assert.ok(appointmentOnly.data.items.every((entry) => entry.action === "appointment.created"));
    assert.equal((await clients.receptionist.get(`${P}/audit-logs`)).status, 403);
    assert.equal((await clients.ownerQ.get(`/api/v1/clinics/plat-q/audit-logs`)).data.total, 0);
});

// ---------------------------------------------------------------- super admin

test("super admin API is invisible to everyone else", async () => {
    assert.equal((await createClient(baseUrl).get("/api/v1/admin/overview")).status, 401);
    for (const key of ["owner", "patient", "stranger"]) {
        assert.equal((await clients[key].get("/api/v1/admin/overview")).status, 404, key);
        assert.equal((await clients[key].patch(`/api/v1/admin/clinics/${clinic.id}`, { json: { status: "SUSPENDED" } })).status, 404, key);
    }
});

test("super admin manages clinics and users, audited, without tenant access", async () => {
    const admin = clients.admin;
    const overview = await admin.get("/api/v1/admin/overview");
    assert.equal(overview.status, 200);
    assert.ok(overview.data.users >= 9);

    const list = await admin.get("/api/v1/admin/clinics?q=plat");
    assert.deepEqual(list.data.items.map((c) => c.slug).sort(), ["plat-p", "plat-q"]);

    assert.equal((await admin.get(`${P}/appointments`)).status, 404, "platform role grants no clinic access");

    const suspended = await admin.patch(`/api/v1/admin/clinics/${clinic.id}`, { json: { status: "SUSPENDED", reason: "Test" } });
    assert.equal(suspended.data.clinic.status, "SUSPENDED");
    assert.equal((await createClient(baseUrl).get("/api/v1/public/clinics/plat-p")).status, 404);
    assert.equal((await clients.owner.get(`${P}/appointments`)).status, 404, "suspended clinic is closed to its staff");
    await admin.patch(`/api/v1/admin/clinics/${clinic.id}`, { json: { status: "ACTIVE" } });
    assert.equal((await clients.owner.get(`${P}/appointments`)).status, 200);

    assert.equal((await admin.patch(`/api/v1/admin/users/${users.admin.id}`, { json: { platformRole: "USER" } })).data.error.code, "CANNOT_CHANGE_SELF");
    assert.equal((await admin.patch(`/api/v1/admin/users/${users.stranger.id}`, { json: { platformRole: "SUPER_ADMIN" } })).data.user.platformRole, "SUPER_ADMIN");
    assert.equal((await clients.stranger.get("/api/v1/admin/overview")).status, 200, "role is read fresh from the DB");
    await admin.patch(`/api/v1/admin/users/${users.stranger.id}`, { json: { platformRole: "USER" } });
    assert.equal((await clients.stranger.get("/api/v1/admin/overview")).status, 404);

    const audit = await admin.get("/api/v1/admin/audit-logs?action=admin.clinic_status_changed");
    assert.equal(audit.data.total, 2);
    const users_ = await admin.get("/api/v1/admin/users?q=example.test&pageSize=100");
    assert.equal(JSON.stringify(users_.data).includes("passwordHash"), false);
});
