const { prisma, resetTestData, createUser, addMember, startServer, stopServer, createClient, assertConnectedToTestDatabase } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

let server;
let baseUrl;
const users = {};
const members = {};
const clients = {};
let clinicA;
let clinicB;
const ids = {};

const A = "/api/v1/clinics/ops-a";
const B = "/api/v1/clinics/ops-b";

test.before(async () => {
    await resetTestData();
    ({ server, baseUrl } = await startServer());

    for (const key of ["ownerA", "doctor1", "doctor2", "receptionist", "ownerB", "doctorB"]) users[key] = await createUser();
    clinicA = await prisma.clinic.create({ data: { slug: "ops-a", name: "Ops A" } });
    clinicB = await prisma.clinic.create({ data: { slug: "ops-b", name: "Ops B" } });
    members.ownerA = await addMember(clinicA.id, users.ownerA.id, "OWNER");
    members.doctor1 = await addMember(clinicA.id, users.doctor1.id, "DOCTOR");
    members.doctor2 = await addMember(clinicA.id, users.doctor2.id, "DOCTOR");
    members.receptionist = await addMember(clinicA.id, users.receptionist.id, "RECEPTIONIST");
    members.ownerB = await addMember(clinicB.id, users.ownerB.id, "OWNER");
    members.doctorB = await addMember(clinicB.id, users.doctorB.id, "DOCTOR");

    for (const [key, user] of Object.entries(users)) {
        clients[key] = createClient(baseUrl);
        await clients[key].login(user.email);
    }
});

test.after(async () => {
    try {
        await resetTestData();
    } finally {
        await stopServer(server);
    }
});

// ---------------------------------------------------------------- specialties

test("specialties: owner creates bilingual specialties; duplicates are blocked per clinic only", async () => {
    const created = await clients.ownerA.post(`${A}/specialties`, { json: { nameEn: "Dentistry", nameAr: "طب الأسنان" } });
    assert.equal(created.status, 201);
    assert.equal(created.data.specialty.nameAr, "طب الأسنان");
    ids.dentistryA = created.data.specialty.id;

    const caseDuplicate = await clients.ownerA.post(`${A}/specialties`, { json: { nameEn: "dentistry " } });
    assert.equal(caseDuplicate.status, 409);
    assert.equal(caseDuplicate.data.error.code, "SPECIALTY_NAME_TAKEN");
    assert.equal((await clients.ownerA.post(`${A}/specialties`, { json: { nameEn: "Dental care", nameAr: "طب الأسنان" } })).status, 409);

    const otherClinic = await clients.ownerB.post(`${B}/specialties`, { json: { nameEn: "Dentistry" } });
    assert.equal(otherClinic.status, 201, "the same name is fine in another clinic");
    ids.dentistryB = otherClinic.data.specialty.id;

    ids.pediatricsA = (await clients.ownerA.post(`${A}/specialties`, { json: { nameEn: "Pediatrics", nameAr: "طب الأطفال" } })).data.specialty.id;
});

test("specialties: validation, RBAC and cross-tenant updates", async () => {
    assert.equal((await clients.ownerA.post(`${A}/specialties`, { json: { nameEn: "X" } })).status, 400);
    assert.equal((await clients.ownerA.post(`${A}/specialties`, { json: { nameEn: "Ortho", clinicId: clinicB.id } })).status, 400);
    assert.equal((await clients.receptionist.post(`${A}/specialties`, { json: { nameEn: "Ortho" } })).status, 403);
    assert.equal((await clients.doctor1.post(`${A}/specialties`, { json: { nameEn: "Ortho" } })).status, 403);
    assert.equal((await clients.receptionist.get(`${A}/specialties`)).status, 200);

    // B's owner targets A's specialty id through B's own clinic: not found, A's row untouched.
    assert.equal((await clients.ownerB.patch(`${B}/specialties/${ids.dentistryA}`, { json: { nameEn: "Hijacked" } })).status, 404);
    assert.equal((await clients.ownerB.patch(`${A}/specialties/${ids.dentistryA}`, { json: { nameEn: "Hijacked" } })).status, 404);
    assert.equal((await prisma.specialty.findUnique({ where: { id: ids.dentistryA } })).nameEn, "Dentistry");
});

test("specialties: deactivation hides them from the default list", async () => {
    const res = await clients.ownerA.patch(`${A}/specialties/${ids.pediatricsA}`, { json: { isActive: false } });
    assert.equal(res.status, 200);
    const active = await clients.ownerA.get(`${A}/specialties`);
    assert.deepEqual(active.data.specialties.map((s) => s.nameEn), ["Dentistry"]);
    const all = await clients.ownerA.get(`${A}/specialties?includeInactive=true`);
    assert.deepEqual(all.data.specialties.map((s) => s.nameEn), ["Dentistry", "Pediatrics"]);
    await clients.ownerA.patch(`${A}/specialties/${ids.pediatricsA}`, { json: { isActive: true } });
});

// ---------------------------------------------------------------- services

test("services: create with exact price, bilingual text and validation", async () => {
    const res = await clients.ownerA.post(`${A}/services`, {
        json: { nameEn: "Consultation", nameAr: "كشف", descriptionEn: "First visit", durationMinutes: 30, price: "350.50" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.service.priceMinor, 35050);
    assert.equal(res.data.service.price, "350.50");
    assert.equal(res.data.service.currency, "EGP");
    ids.consultA = res.data.service.id;

    ids.cleaningA = (await clients.ownerA.post(`${A}/services`, { json: { nameEn: "Cleaning", durationMinutes: 45, price: 500 } })).data.service.id;
    ids.serviceB = (await clients.ownerB.post(`${B}/services`, { json: { nameEn: "Consultation", durationMinutes: 20, price: "200" } })).data.service.id;

    for (const json of [
        { nameEn: "Bad", durationMinutes: 3, price: "1" },
        { nameEn: "Bad", durationMinutes: 30, price: "abc" },
        { nameEn: "Bad", durationMinutes: 30, price: "1", currency: "XYZ" },
        { nameEn: "Bad", durationMinutes: 30, price: "1", clinicId: clinicB.id },
    ]) {
        assert.equal((await clients.ownerA.post(`${A}/services`, { json })).status, 400, JSON.stringify(json));
    }
    assert.equal((await clients.ownerA.post(`${A}/services`, { json: { nameEn: "consultation", durationMinutes: 30, price: "1" } })).data.error.code, "SERVICE_NAME_TAKEN");
    assert.equal((await clients.receptionist.post(`${A}/services`, { json: { nameEn: "New", durationMinutes: 30, price: "1" } })).status, 403);
    assert.equal((await clients.ownerB.get(`${B}/services/${ids.consultA}`)).status, 404);
    assert.equal((await clients.ownerB.patch(`${B}/services/${ids.consultA}`, { json: { price: "1" } })).status, 404);
});

test("services: database CHECK constraints back up the API validation", async () => {
    await assertConnectedToTestDatabase();
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO services (clinic_id, name_en, duration_minutes, price_minor, updated_at) VALUES (${clinicA.id}, 'Too long', 1000, 100, NOW(3))`,
        /constraint|CONSTRAINT|4025/
    );
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO services (clinic_id, name_en, duration_minutes, price_minor, updated_at) VALUES (${clinicA.id}, 'Negative', 30, -1, NOW(3))`,
        /constraint|CONSTRAINT|4025/
    );
});

// ---------------------------------------------------------------- doctors

test("doctors: owner creates a profile for a DOCTOR member with specialties and services", async () => {
    const res = await clients.ownerA.post(`${A}/doctors`, {
        json: {
            memberId: members.doctor1.id,
            displayNameEn: "Dr. Mona Adel",
            displayNameAr: "د. منى عادل",
            titleEn: "Consultant",
            yearsOfExperience: 12,
            specialtyIds: [ids.dentistryA],
            serviceIds: [ids.consultA, ids.cleaningA],
        },
    });
    assert.equal(res.status, 201);
    ids.doctor1 = res.data.doctor.id;
    assert.deepEqual(res.data.doctor.specialties.map((s) => s.id), [ids.dentistryA]);
    assert.deepEqual(res.data.doctor.services.map((s) => s.id).sort(), [ids.consultA, ids.cleaningA].sort());

    ids.doctor2 = (await clients.ownerA.post(`${A}/doctors`, { json: { memberId: members.doctor2.id, displayNameEn: "Dr. Karim" } })).data.doctor.id;
    ids.ownerAsDoctor = (await clients.ownerA.post(`${A}/doctors`, { json: { memberId: members.ownerA.id, displayNameEn: "Dr. Owner" } })).data.doctor.id;
    assert.ok(ids.ownerAsDoctor, "an OWNER can also practise as a doctor");
    ids.doctorB = (await clients.ownerB.post(`${B}/doctors`, { json: { memberId: members.doctorB.id, displayNameEn: "Dr. B" } })).data.doctor.id;
});

test("doctors: invalid members, duplicates and RBAC", async () => {
    const receptionist = await clients.ownerA.post(`${A}/doctors`, { json: { memberId: members.receptionist.id, displayNameEn: "Not a doctor" } });
    assert.equal(receptionist.data.error.code, "MEMBER_CANNOT_BE_DOCTOR");

    const foreignMember = await clients.ownerA.post(`${A}/doctors`, { json: { memberId: members.ownerB.id, displayNameEn: "Foreign" } });
    assert.equal(foreignMember.status, 400);
    assert.equal(foreignMember.data.error.code, "INVALID_MEMBER");

    const duplicate = await clients.ownerA.post(`${A}/doctors`, { json: { memberId: members.doctor1.id, displayNameEn: "Again" } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.error.code, "DOCTOR_PROFILE_EXISTS");

    assert.equal((await clients.doctor1.post(`${A}/doctors`, { json: { memberId: members.doctor2.id, displayNameEn: "X" } })).status, 403);
    assert.equal((await clients.doctor1.patch(`${A}/doctors/${ids.doctor1}`, { json: { titleEn: "Self-promoted" } })).status, 403);
    assert.equal((await clients.receptionist.get(`${A}/doctors/${ids.doctor1}`)).status, 200);
});

test("doctors: cross-clinic specialties/services are rejected and nothing is written", async () => {
    const before = await clients.ownerA.get(`${A}/doctors/${ids.doctor1}`);

    const badSpecialty = await clients.ownerA.put(`${A}/doctors/${ids.doctor1}/specialties`, { json: { specialtyIds: [ids.dentistryA, ids.dentistryB] } });
    assert.equal(badSpecialty.status, 400);
    assert.equal(badSpecialty.data.error.code, "INVALID_SPECIALTY");

    const badService = await clients.ownerA.put(`${A}/doctors/${ids.doctor1}/services`, { json: { serviceIds: [ids.serviceB] } });
    assert.equal(badService.data.error.code, "INVALID_SERVICE");

    const badCreate = await clients.ownerA.post(`${A}/doctors`, {
        json: { memberId: members.doctor2.id, displayNameEn: "Never", serviceIds: [ids.serviceB] },
    });
    assert.ok([400, 409].includes(badCreate.status));

    const after = await clients.ownerA.get(`${A}/doctors/${ids.doctor1}`);
    assert.deepEqual(after.data.doctor.specialties, before.data.doctor.specialties);
    assert.deepEqual(after.data.doctor.services, before.data.doctor.services);
    assert.equal(await prisma.doctorService.count({ where: { serviceId: ids.serviceB, doctorId: { not: ids.doctorB } } }), 0);
});

test("doctors: the database itself refuses cross-clinic links (composite foreign keys)", async () => {
    await assertConnectedToTestDatabase();
    // Claim clinic A: B's service is not in clinic A.
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO doctor_services (clinic_id, doctor_id, service_id) VALUES (${clinicA.id}, ${ids.doctor1}, ${ids.serviceB})`,
        /foreign key|FOREIGN KEY|1452/
    );
    // Claim clinic B: A's doctor is not in clinic B.
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO doctor_services (clinic_id, doctor_id, service_id) VALUES (${clinicB.id}, ${ids.doctor1}, ${ids.serviceB})`,
        /foreign key|FOREIGN KEY|1452/
    );
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO doctor_specialties (clinic_id, doctor_id, specialty_id) VALUES (${clinicA.id}, ${ids.doctor1}, ${ids.dentistryB})`,
        /foreign key|FOREIGN KEY|1452/
    );
    // A doctor profile cannot point at a membership of another clinic.
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO doctor_profiles (clinic_id, member_id, display_name_en, updated_at) VALUES (${clinicA.id}, ${members.ownerB.id}, 'Ghost', NOW(3))`,
        /foreign key|FOREIGN KEY|1452/
    );
});

test("doctors: replacing links, filters, service detail and deactivation", async () => {
    const replaced = await clients.ownerA.put(`${A}/doctors/${ids.doctor2}/services`, { json: { serviceIds: [ids.consultA] } });
    assert.equal(replaced.status, 200);
    assert.deepEqual(replaced.data.doctor.services.map((s) => s.id), [ids.consultA]);

    const byService = await clients.ownerA.get(`${A}/doctors?serviceId=${ids.cleaningA}`);
    assert.deepEqual(byService.data.items.map((d) => d.id), [ids.doctor1]);

    const detail = await clients.receptionist.get(`${A}/services/${ids.consultA}`);
    assert.deepEqual(detail.data.service.doctors.map((d) => d.id).sort(), [ids.doctor1, ids.doctor2].sort());

    assert.equal((await clients.ownerA.patch(`${A}/doctors/${ids.doctor2}`, { json: { isActive: false } })).status, 200);
    const active = await clients.ownerA.get(`${A}/doctors`);
    assert.equal(active.data.items.some((d) => d.id === ids.doctor2), false);
    const all = await clients.ownerA.get(`${A}/doctors?includeInactive=true`);
    assert.equal(all.data.items.some((d) => d.id === ids.doctor2), true);
    await clients.ownerA.patch(`${A}/doctors/${ids.doctor2}`, { json: { isActive: true } });

    assert.equal((await clients.ownerB.get(`${B}/doctors/${ids.doctor1}`)).status, 404);
    assert.equal((await clients.ownerB.put(`${B}/doctors/${ids.doctor1}/services`, { json: { serviceIds: [] } })).status, 404);
    assert.equal(JSON.stringify((await clients.ownerB.get(`${B}/doctors`)).data).includes("Mona"), false);
});

// ---------------------------------------------------------------- working hours

const weekdayHours = [1, 2, 3, 4].flatMap((weekday) => [
    { weekday, start: "09:00", end: "13:00" },
    { weekday, start: "14:00", end: "18:00" },
]);

test("working hours: clinic weekly schedule with a lunch break", async () => {
    const res = await clients.ownerA.put(`${A}/working-hours`, { json: { intervals: [...weekdayHours, { weekday: 6, start: "10:00", end: "14:00" }] } });
    assert.equal(res.status, 200);
    assert.equal(res.data.timezone, "Africa/Cairo");
    assert.equal(res.data.intervals.length, 9);
    assert.deepEqual(res.data.intervals.slice(0, 2), [
        { weekday: 1, start: "09:00", end: "13:00" },
        { weekday: 1, start: "14:00", end: "18:00" },
    ]);

    const stored = await prisma.workingHours.findFirst({ where: { clinicId: clinicA.id, doctorId: null, weekday: 1 }, orderBy: { startMinute: "asc" } });
    assert.equal(stored.startMinute, 540);
    assert.equal(stored.endMinute, 780);

    const overlap = await clients.ownerA.put(`${A}/working-hours`, {
        json: { intervals: [{ weekday: 1, start: "09:00", end: "13:00" }, { weekday: 1, start: "12:30", end: "15:00" }] },
    });
    assert.equal(overlap.status, 400);
    assert.equal((await clients.receptionist.get(`${A}/working-hours`)).data.intervals.length, 9, "failed update changed nothing");
});

test("working hours: doctors edit only their own schedule", async () => {
    const own = await clients.doctor1.put(`${A}/doctors/${ids.doctor1}/working-hours`, { json: { intervals: [{ weekday: 1, start: "10:00", end: "16:00" }] } });
    assert.equal(own.status, 200);
    assert.deepEqual(own.data.intervals, [{ weekday: 1, start: "10:00", end: "16:00" }]);

    assert.equal((await clients.doctor1.put(`${A}/doctors/${ids.doctor2}/working-hours`, { json: { intervals: [] } })).status, 403);
    assert.equal((await clients.doctor1.put(`${A}/working-hours`, { json: { intervals: [] } })).status, 403);
    assert.equal((await clients.receptionist.put(`${A}/doctors/${ids.doctor1}/working-hours`, { json: { intervals: [] } })).status, 403);
    assert.equal((await clients.receptionist.put(`${A}/working-hours`, { json: { intervals: [] } })).status, 403);

    const byOwner = await clients.ownerA.put(`${A}/doctors/${ids.doctor2}/working-hours`, { json: { intervals: weekdayHours } });
    assert.equal(byOwner.status, 200);
    assert.equal((await clients.receptionist.get(`${A}/doctors/${ids.doctor2}/working-hours`)).data.intervals.length, 8);

    // Clinic hours are untouched by doctor-level edits.
    assert.equal((await clients.ownerA.get(`${A}/working-hours`)).data.intervals.length, 9);
});

test("working hours: other clinics can neither read nor write them", async () => {
    assert.equal((await clients.ownerB.get(`${B}/doctors/${ids.doctor1}/working-hours`)).status, 404);
    assert.equal((await clients.ownerB.put(`${B}/doctors/${ids.doctor1}/working-hours`, { json: { intervals: [] } })).status, 404);
    assert.equal((await clients.ownerB.get(`${A}/working-hours`)).status, 404);
    assert.equal((await clients.ownerB.put(`${A}/working-hours`, { json: { intervals: [] } })).status, 404);
    assert.equal(await prisma.workingHours.count({ where: { clinicId: clinicA.id, doctorId: ids.doctor1 } }), 1);
    assert.equal(await prisma.workingHours.count({ where: { clinicId: clinicB.id } }), 0);
});

// ---------------------------------------------------------------- schedule exceptions

test("exceptions: clinic holidays and doctor leave are stored in UTC from Cairo time", async () => {
    const holiday = await clients.ownerA.post(`${A}/schedule-exceptions`, {
        json: { kind: "HOLIDAY", reason: "Coptic Christmas", allDay: true, startDate: "2026-01-07", endDate: "2026-01-07" },
    });
    assert.equal(holiday.status, 201);
    assert.equal(holiday.data.exception.doctorId, null);
    assert.equal(holiday.data.exception.startsAt, "2026-01-06T22:00:00.000Z");
    assert.equal(holiday.data.exception.endsAt, "2026-01-07T22:00:00.000Z");
    assert.equal(holiday.data.exception.startsAtLocal, "2026-01-07T00:00:00+02:00");
    ids.holiday = holiday.data.exception.id;

    // Summer: Cairo is UTC+3 since Egypt's daylight saving time.
    const leave = await clients.ownerA.post(`${A}/schedule-exceptions`, {
        json: { kind: "LEAVE", doctorId: ids.doctor2, startsAt: "2026-07-15T09:00", endsAt: "2026-07-15T17:00" },
    });
    assert.equal(leave.status, 201);
    assert.equal(leave.data.exception.startsAt, "2026-07-15T06:00:00.000Z");
    ids.leaveDoctor2 = leave.data.exception.id;

    const offset = await clients.ownerA.post(`${A}/schedule-exceptions`, {
        json: { kind: "UNAVAILABLE", doctorId: ids.doctor1, startsAt: "2026-03-01T08:00:00Z", endsAt: "2026-03-01T10:00:00Z" },
    });
    assert.equal(offset.data.exception.startsAtLocal, "2026-03-01T10:00:00+02:00");

    const stored = await prisma.scheduleException.findUnique({ where: { id: ids.holiday } });
    assert.equal(stored.startsAt.toISOString(), "2026-01-06T22:00:00.000Z");
});

test("exceptions: invalid periods and DST-skipped times are rejected", async () => {
    const gap = await clients.ownerA.post(`${A}/schedule-exceptions`, { json: { kind: "LEAVE", startsAt: "2026-04-24T00:30", endsAt: "2026-04-24T03:00" } });
    assert.equal(gap.status, 400);
    assert.equal(gap.data.error.code, "LOCAL_TIME_INVALID");

    const backwards = await clients.ownerA.post(`${A}/schedule-exceptions`, { json: { kind: "LEAVE", startsAt: "2026-07-15T17:00", endsAt: "2026-07-15T09:00" } });
    assert.equal(backwards.data.error.code, "INVALID_PERIOD");

    assert.equal((await clients.ownerA.post(`${A}/schedule-exceptions`, { json: { kind: "LEAVE", doctorId: ids.doctorB, startsAt: "2026-07-15T09:00", endsAt: "2026-07-15T10:00" } })).status, 404);

    await assertConnectedToTestDatabase();
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO schedule_exceptions (clinic_id, kind, starts_at, ends_at) VALUES (${clinicA.id}, 'LEAVE', '2026-07-15 10:00:00', '2026-07-15 09:00:00')`,
        /constraint|CONSTRAINT|4025/
    );
});

test("exceptions: doctors add and remove only their own; receptionists are read-only", async () => {
    const own = await clients.doctor1.post(`${A}/schedule-exceptions`, {
        json: { kind: "LEAVE", doctorId: ids.doctor1, allDay: true, startDate: "2026-08-10", endDate: "2026-08-14" },
    });
    assert.equal(own.status, 201);
    ids.leaveDoctor1 = own.data.exception.id;

    assert.equal((await clients.doctor1.post(`${A}/schedule-exceptions`, { json: { kind: "LEAVE", doctorId: ids.doctor2, allDay: true, startDate: "2026-08-10", endDate: "2026-08-10" } })).status, 403);
    assert.equal((await clients.doctor1.post(`${A}/schedule-exceptions`, { json: { kind: "HOLIDAY", allDay: true, startDate: "2026-08-10", endDate: "2026-08-10" } })).status, 403);
    assert.equal((await clients.receptionist.post(`${A}/schedule-exceptions`, { json: { kind: "HOLIDAY", allDay: true, startDate: "2026-08-10", endDate: "2026-08-10" } })).status, 403);

    assert.equal((await clients.doctor1.request("DELETE", `${A}/schedule-exceptions/${ids.leaveDoctor2}`)).status, 403);
    assert.equal((await clients.doctor1.request("DELETE", `${A}/schedule-exceptions/${ids.holiday}`)).status, 403);
    assert.equal((await clients.receptionist.request("DELETE", `${A}/schedule-exceptions/${ids.leaveDoctor1}`)).status, 403);
    assert.equal((await clients.doctor1.request("DELETE", `${A}/schedule-exceptions/${ids.leaveDoctor1}`)).status, 204);
    assert.equal(await prisma.scheduleException.count({ where: { id: ids.leaveDoctor1 } }), 0);
});

test("exceptions: listing by range and doctor includes clinic-wide closures", async () => {
    const forDoctor2 = await clients.receptionist.get(`${A}/schedule-exceptions?from=2026-01-01&to=2026-12-31&doctorId=${ids.doctor2}`);
    assert.equal(forDoctor2.status, 200);
    assert.deepEqual(forDoctor2.data.items.map((e) => e.id).sort(), [ids.holiday, ids.leaveDoctor2].sort());

    const julyOnly = await clients.receptionist.get(`${A}/schedule-exceptions?from=2026-07-01&to=2026-07-31`);
    assert.deepEqual(julyOnly.data.items.map((e) => e.id), [ids.leaveDoctor2]);

    assert.equal((await clients.receptionist.get(`${A}/schedule-exceptions?from=2026-01-01&to=2027-06-01`)).status, 400);
});

test("exceptions: another clinic cannot list or delete them", async () => {
    const list = await clients.ownerB.get(`${B}/schedule-exceptions?from=2026-01-01&to=2026-12-31`);
    assert.deepEqual(list.data.items, []);
    assert.equal((await clients.ownerB.request("DELETE", `${B}/schedule-exceptions/${ids.holiday}`)).status, 404);
    assert.equal((await clients.ownerB.request("DELETE", `${A}/schedule-exceptions/${ids.holiday}`)).status, 404);
    assert.equal(await prisma.scheduleException.count({ where: { id: ids.holiday } }), 1);
    assert.equal((await clients.ownerA.request("DELETE", `${A}/schedule-exceptions/${ids.holiday}`)).status, 204);
});

// ---------------------------------------------------------------- audit

test("audit: every administrative change in clinic A was recorded against clinic A", async () => {
    const actions = (await prisma.auditLog.findMany({ where: { clinicId: clinicA.id }, select: { action: true } })).map((a) => a.action);
    for (const action of [
        "specialty.created",
        "specialty.updated",
        "service.created",
        "doctor.created",
        "doctor.updated",
        "doctor.services_updated",
        "clinic.working_hours_updated",
        "doctor.working_hours_updated",
        "schedule_exception.created",
        "schedule_exception.deleted",
    ]) {
        assert.ok(actions.includes(action), `missing ${action}`);
    }
    const leaks = await prisma.auditLog.count({ where: { clinicId: clinicB.id, actorUserId: { in: [users.ownerA.id, users.doctor1.id] } } });
    assert.equal(leaks, 0);
});
