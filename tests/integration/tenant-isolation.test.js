const {
    prisma,
    resetTestData,
    createUser,
    createClinicWithMember,
    addMember,
    startServer,
    stopServer,
    createClient,
} = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

let server;
let baseUrl;
const users = {};
const clients = {};
let clinicA;
let clinicB;
let suspended;

test.before(async () => {
    await resetTestData();
    ({ server, baseUrl } = await startServer());

    for (const key of ["ownerA", "ownerB", "receptionistA", "doctorA", "disabledA", "outsider"]) {
        users[key] = await createUser();
    }
    clinicA = await createClinicWithMember({ slug: "clinic-a", userId: users.ownerA.id });
    clinicB = await createClinicWithMember({ slug: "clinic-b", userId: users.ownerB.id });
    suspended = await createClinicWithMember({ slug: "clinic-suspended", userId: users.ownerA.id, clinicStatus: "SUSPENDED" });
    await addMember(clinicA.id, users.receptionistA.id, "RECEPTIONIST");
    await addMember(clinicA.id, users.doctorA.id, "DOCTOR");
    await addMember(clinicA.id, users.disabledA.id, "RECEPTIONIST", "DISABLED");

    for (const [key, user] of Object.entries(users)) {
        clients[key] = createClient(baseUrl);
        await clients[key].login(user.email);
    }
});

test.after(async () => {
    await resetTestData();
    await stopServer(server);
});

test("owner of clinic B cannot read, update or list members of clinic A", async () => {
    const b = clients.ownerB;
    for (const res of [
        await b.get("/api/v1/clinics/clinic-a"),
        await b.patch("/api/v1/clinics/clinic-a", { json: { name: "Taken over" } }),
        await b.get("/api/v1/clinics/clinic-a/members"),
    ]) {
        assert.equal(res.status, 404);
        assert.equal(res.data.error.code, "NOT_FOUND");
    }
    const fresh = await prisma.clinic.findUnique({ where: { id: clinicA.id } });
    assert.equal(fresh.name, "Clinic clinic-a");
});

test("a user with no membership gets 404 for every clinic, same as a missing clinic", async () => {
    const outsider = clients.outsider;
    assert.equal((await outsider.get("/api/v1/clinics/clinic-a")).status, 404);
    assert.equal((await outsider.get("/api/v1/clinics/clinic-b")).status, 404);
    assert.equal((await outsider.get("/api/v1/clinics/does-not-exist")).status, 404);
    assert.deepEqual((await outsider.get("/api/v1/clinics")).data.clinics, []);
});

test("smuggling clinicId in the body is rejected and clinic B is untouched", async () => {
    const a = clients.ownerA;
    const res = await a.patch("/api/v1/clinics/clinic-a", { json: { name: "Edited", clinicId: clinicB.id } });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, "VALIDATION_FAILED");

    const slugChange = await a.patch("/api/v1/clinics/clinic-a", { json: { slug: "clinic-b" } });
    assert.equal(slugChange.status, 400);

    const fresh = await prisma.clinic.findUnique({ where: { id: clinicB.id } });
    assert.equal(fresh.name, "Clinic clinic-b");
});

test("owner can update their own clinic and the change is audited", async () => {
    const res = await clients.ownerA.patch("/api/v1/clinics/clinic-a", { json: { name: "Nile Clinic", city: "Cairo" } });
    assert.equal(res.status, 200);
    assert.equal(res.data.clinic.name, "Nile Clinic");

    const audit = await prisma.auditLog.findFirst({ where: { action: "clinic.updated", clinicId: clinicA.id } });
    assert.ok(audit);
    assert.equal(audit.actorUserId, users.ownerA.id);
    assert.deepEqual(audit.metadata, { fields: ["name", "city"] });
    assert.equal(await prisma.auditLog.count({ where: { clinicId: clinicB.id } }), 0);
});

test("receptionist and doctor can read their clinic but cannot update it or list members", async () => {
    for (const key of ["receptionistA", "doctorA"]) {
        const client = clients[key];
        const read = await client.get("/api/v1/clinics/clinic-a");
        assert.equal(read.status, 200, key);
        assert.equal(read.data.clinic.role, key === "doctorA" ? "DOCTOR" : "RECEPTIONIST");

        const update = await client.patch("/api/v1/clinics/clinic-a", { json: { name: "Nope" } });
        assert.equal(update.status, 403, key);
        assert.equal(update.data.error.code, "FORBIDDEN");

        assert.equal((await client.get("/api/v1/clinics/clinic-a/members")).status, 403, key);
        assert.equal((await client.get("/api/v1/clinics/clinic-b")).status, 404, key);
    }
});

test("a disabled member loses access immediately", async () => {
    assert.equal((await clients.disabledA.get("/api/v1/clinics/clinic-a")).status, 404);
    assert.deepEqual((await clients.disabledA.get("/api/v1/clinics")).data.clinics, []);

    // Disabling an active member takes effect on the next request (membership is read from the DB every time).
    await prisma.clinicMember.updateMany({ where: { clinicId: clinicA.id, userId: users.doctorA.id }, data: { status: "DISABLED" } });
    assert.equal((await clients.doctorA.get("/api/v1/clinics/clinic-a")).status, 404);
    await prisma.clinicMember.updateMany({ where: { clinicId: clinicA.id, userId: users.doctorA.id }, data: { status: "ACTIVE" } });
});

test("a suspended clinic is hidden even from its owner", async () => {
    assert.equal((await clients.ownerA.get("/api/v1/clinics/clinic-suspended")).status, 404);
    const mine = await clients.ownerA.get("/api/v1/clinics");
    assert.deepEqual(mine.data.clinics.map((c) => c.slug), ["clinic-a"]);
    assert.ok(suspended.id);
});

test("member list is scoped to the clinic and exposes no password data", async () => {
    const res = await clients.ownerA.get("/api/v1/clinics/clinic-a/members?pageSize=2&page=1");
    assert.equal(res.status, 200);
    assert.equal(res.data.total, 4);
    assert.equal(res.data.items.length, 2);

    const all = await clients.ownerA.get("/api/v1/clinics/clinic-a/members?pageSize=100");
    const memberUserIds = all.data.items.map((m) => m.user.id).sort();
    assert.deepEqual(memberUserIds, [users.ownerA.id, users.receptionistA.id, users.doctorA.id, users.disabledA.id].sort());
    assert.equal(JSON.stringify(all.data).includes("passwordHash"), false);
    assert.equal(JSON.stringify(all.data).includes("$2b$"), false);
});

test("CSRF: missing or another user's token is rejected", async () => {
    const a = clients.ownerA;
    const missing = await a.patch("/api/v1/clinics/clinic-a", { json: { name: "x" }, csrf: false });
    assert.equal(missing.status, 403);
    assert.equal(missing.data.error.code, "CSRF_INVALID");

    const ownToken = a.csrfToken;
    a.setCsrf(clients.ownerB.csrfToken);
    const foreign = await a.patch("/api/v1/clinics/clinic-a", { json: { name: "x" } });
    a.setCsrf(ownToken);
    assert.equal(foreign.status, 403);
});

test("creating a clinic makes the creator its OWNER, in one audited transaction", async () => {
    const res = await clients.outsider.post("/api/v1/clinics", { json: { name: "Delta Dental", slug: "delta-dental" } });
    assert.equal(res.status, 201);
    assert.equal(res.data.clinic.timezone, "Africa/Cairo");
    assert.equal(res.data.clinic.defaultLocale, "en");

    const membership = await prisma.clinicMember.findFirst({ where: { clinic: { slug: "delta-dental" } } });
    assert.equal(membership.userId, users.outsider.id);
    assert.equal(membership.role, "OWNER");
    assert.equal(await prisma.auditLog.count({ where: { action: "clinic.created", clinicId: membership.clinicId } }), 1);

    const dup = await clients.ownerB.post("/api/v1/clinics", { json: { name: "Copy", slug: "delta-dental" } });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error.code, "CLINIC_SLUG_TAKEN");
    assert.equal(await prisma.clinic.count({ where: { slug: "delta-dental" } }), 1);
});

test("/auth/me lists only the caller's active clinics", async () => {
    const me = await clients.receptionistA.get("/api/v1/auth/me");
    assert.deepEqual(me.data.clinics.map((c) => [c.slug, c.role]), [["clinic-a", "RECEPTIONIST"]]);
});
