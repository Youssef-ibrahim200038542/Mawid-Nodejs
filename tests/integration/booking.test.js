const { prisma, resetTestData, createUser, addMember, startServer, stopServer, createClient, assertConnectedToTestDatabase } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");

const zone = "Africa/Cairo";
let server;
let baseUrl;
const users = {};
const members = {};
const clients = {};
const ids = {};
let clinic;
let otherClinic;

// A Monday at least 3 days ahead in Cairo (well inside the 90-day window, never a DST day).
let day = DateTime.now().setZone(zone).plus({ days: 3 }).startOf("day");
while (day.weekday !== 1) day = day.plus({ days: 1 });
const MON = day.toISODate();
const local = (hhmm) => `${MON}T${hhmm}`;
const utc = (hhmm) => DateTime.fromISO(local(hhmm), { zone }).toUTC().toISO();

const C = "/api/v1/clinics/book-c";
const D = "/api/v1/clinics/book-d";
const PUB = "/api/v1/public/clinics/book-c";

async function book(client, json) {
    return client.post(`${PUB}/appointments`, { json: { doctorId: ids.doctor1, serviceId: ids.consult, ...json } });
}

async function insertAppointment({ startsAt, status = "CONFIRMED", patientId, doctorId = ids.doctor1 }) {
    await assertConnectedToTestDatabase();
    return prisma.appointment.create({
        data: {
            clinicId: clinic.id,
            doctorId,
            serviceId: ids.consult,
            patientId,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * 60_000),
            status,
            source: "STAFF",
            durationMinutes: 30,
            priceMinor: 30000,
            currency: "EGP",
        },
    });
}

test.before(async () => {
    await resetTestData();
    ({ server, baseUrl } = await startServer());

    const staff = ["owner", "receptionist", "doctor1", "doctor2", "doctor3", "ownerD", "doctorD"];
    const patients = ["p1", "p2", "p3", ...Array.from({ length: 10 }, (_, i) => `racer${i}`), "hoarder"];
    for (const key of [...staff, ...patients]) users[key] = await createUser();

    clinic = await prisma.clinic.create({ data: { slug: "book-c", name: "Booking Clinic", city: "Cairo", timezone: zone } });
    otherClinic = await prisma.clinic.create({ data: { slug: "book-d", name: "Other Clinic", timezone: zone } });
    await prisma.clinic.create({ data: { slug: "book-suspended", name: "Suspended", status: "SUSPENDED" } });

    for (const [key, role] of [["owner", "OWNER"], ["receptionist", "RECEPTIONIST"], ["doctor1", "DOCTOR"], ["doctor2", "DOCTOR"], ["doctor3", "DOCTOR"]]) {
        members[key] = await addMember(clinic.id, users[key].id, role);
    }
    members.ownerD = await addMember(otherClinic.id, users.ownerD.id, "OWNER");
    members.doctorD = await addMember(otherClinic.id, users.doctorD.id, "DOCTOR");

    for (const [key, user] of Object.entries(users)) {
        clients[key] = createClient(baseUrl);
        await clients[key].login(user.email);
    }

    const owner = clients.owner;
    ids.consult = (await owner.post(`${C}/services`, { json: { nameEn: "Consultation", nameAr: "كشف", durationMinutes: 30, price: "300" } })).data.service.id;
    ids.xray = (await owner.post(`${C}/services`, { json: { nameEn: "X-Ray", durationMinutes: 15, price: "150" } })).data.service.id;
    ids.hidden = (await owner.post(`${C}/services`, { json: { nameEn: "Retired service", durationMinutes: 15, price: "10" } })).data.service.id;
    await owner.patch(`${C}/services/${ids.hidden}`, { json: { isActive: false } });

    ids.doctor1 = (await owner.post(`${C}/doctors`, { json: { memberId: members.doctor1.id, displayNameEn: "Dr. One", licenseNumber: "SECRET-LIC-1", serviceIds: [ids.consult, ids.xray] } })).data.doctor.id;
    ids.doctor2 = (await owner.post(`${C}/doctors`, { json: { memberId: members.doctor2.id, displayNameEn: "Dr. Two", serviceIds: [ids.consult] } })).data.doctor.id;
    ids.doctor3 = (await owner.post(`${C}/doctors`, { json: { memberId: members.doctor3.id, displayNameEn: "Dr. Three", serviceIds: [ids.consult] } })).data.doctor.id;
    await owner.patch(`${C}/doctors/${ids.doctor3}`, { json: { isActive: false } });

    const sunToThu = [7, 1, 2, 3, 4].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));
    await owner.put(`${C}/working-hours`, { json: { intervals: sunToThu } });
    await owner.put(`${C}/doctors/${ids.doctor1}/working-hours`, {
        json: { intervals: [1, 2, 3, 4].flatMap((weekday) => [{ weekday, start: "09:00", end: "13:00" }, { weekday, start: "14:00", end: "17:00" }]) },
    });
    await owner.put(`${C}/doctors/${ids.doctor2}/working-hours`, { json: { intervals: [{ weekday: 1, start: "09:00", end: "17:00" }] } });
    await owner.put(`${C}/doctors/${ids.doctor3}/working-hours`, { json: { intervals: [{ weekday: 1, start: "09:00", end: "17:00" }] } });

    const ownerD = clients.ownerD;
    ids.serviceD = (await ownerD.post(`${D}/services`, { json: { nameEn: "Consultation", durationMinutes: 30, price: "100" } })).data.service.id;
    ids.doctorD = (await ownerD.post(`${D}/doctors`, { json: { memberId: members.doctorD.id, displayNameEn: "Dr. D", serviceIds: [ids.serviceD] } })).data.doctor.id;
});

test.after(async () => {
    try {
        await resetTestData();
    } finally {
        await stopServer(server);
    }
});

// ---------------------------------------------------------------- public read model

test("public clinic page shows only active, public information", async () => {
    const anon = createClient(baseUrl);
    const res = await anon.get(PUB);
    assert.equal(res.status, 200);
    assert.equal(res.data.clinic.slug, "book-c");
    assert.deepEqual(res.data.services.map((s) => s.nameEn).sort(), ["Consultation", "X-Ray"]);
    assert.deepEqual(res.data.doctors.map((d) => d.displayNameEn).sort(), ["Dr. One", "Dr. Two"]);
    const body = JSON.stringify(res.data);
    for (const secret of ["SECRET-LIC-1", "memberId", "licenseNumber", "passwordHash", "\"id\":" + clinic.id + ","]) {
        assert.equal(body.includes(secret), false, `leaked ${secret}`);
    }
    assert.equal(res.data.workingHours.intervals.length, 5);

    assert.equal((await anon.get("/api/v1/public/clinics/book-suspended")).status, 404);
    assert.equal((await anon.get("/api/v1/public/clinics/nope")).status, 404);
    const listed = await anon.get("/api/v1/public/clinics?q=Clinic");
    assert.deepEqual(listed.data.items.map((c) => c.slug).sort(), ["book-c", "book-d"]);
});

test("public availability: doctor hours ∩ clinic hours with the lunch break, in Cairo time", async () => {
    const res = await createClient(baseUrl).get(`${PUB}/availability?serviceId=${ids.consult}&doctorId=${ids.doctor1}&from=${MON}&to=${MON}`);
    assert.equal(res.status, 200);
    const slots = res.data.doctors[0].slots;
    assert.equal(slots.length, 15 + 11); // 09:00–12:30 and 14:00–16:30 every 15 min
    assert.equal(slots[0].startsAt, new Date(utc("09:00")).toISOString());
    assert.match(slots[0].startsAtLocal, new RegExp(`^${MON}T09:00:00\\+0[23]:00$`));
    assert.equal(slots.some((s) => s.startsAtLocal.includes("T13:00")), false, "no slot in the break");

    const allDoctors = await createClient(baseUrl).get(`${PUB}/availability?serviceId=${ids.consult}&from=${MON}`);
    assert.deepEqual(allDoctors.data.doctors.map((d) => d.id).sort(), [ids.doctor1, ids.doctor2].sort(), "inactive doctor hidden");

    assert.equal((await createClient(baseUrl).get(`${PUB}/availability?serviceId=${ids.consult}&from=${MON}&to=${day.plus({ days: 20 }).toISODate()}`)).status, 400);
    assert.equal((await createClient(baseUrl).get(`${PUB}/availability?serviceId=${ids.hidden}`)).data.error.code, "INVALID_SERVICE");
});

// ---------------------------------------------------------------- online booking

test("online booking requires a logged-in user", async () => {
    const anon = createClient(baseUrl);
    await anon.refreshCsrf();
    const res = await anon.post(`${PUB}/appointments`, { json: { doctorId: ids.doctor1, serviceId: ids.consult, startsAt: local("10:00") } });
    assert.equal(res.status, 401);
});

test("a patient books online: PENDING, price snapshot, clinic patient record linked to the account", async () => {
    const res = await book(clients.p1, { startsAt: local("10:00"), phone: "+20 100 000 0001" });
    assert.equal(res.status, 201);
    const a = res.data.appointment;
    assert.equal(a.status, "PENDING");
    assert.equal(a.source, "ONLINE");
    assert.equal(a.startsAt, new Date(utc("10:00")).toISOString());
    assert.equal(a.price, "300.00");
    assert.equal(a.durationMinutes, 30);
    ids.p1Appointment = a.id;

    const patient = await prisma.patient.findFirst({ where: { clinicId: clinic.id, userId: users.p1.id } });
    assert.equal(patient.fullName, users.p1.name);
    assert.equal(patient.phone, "+20 100 000 0001");
    ids.p1Patient = patient.id;

    // Price edits later never change existing bookings.
    await clients.owner.patch(`${C}/services/${ids.consult}`, { json: { price: "999" } });
    assert.equal((await clients.p1.get("/api/v1/me/appointments")).data.items[0].price, "300.00");
    await clients.owner.patch(`${C}/services/${ids.consult}`, { json: { price: "300" } });

    const avail = await createClient(baseUrl).get(`${PUB}/availability?serviceId=${ids.consult}&doctorId=${ids.doctor1}&from=${MON}`);
    const taken = avail.data.doctors[0].slots.map((s) => s.startsAtLocal.slice(11, 16));
    for (const hhmm of ["09:45", "10:00", "10:15"]) assert.equal(taken.includes(hhmm), false, `${hhmm} should be gone`);
    assert.ok(taken.includes("09:30") && taken.includes("10:30"));
});

test("the same or an overlapping time can't be booked twice; touching is fine", async () => {
    assert.equal((await book(clients.p2, { startsAt: local("10:00") })).data.error.code, "SLOT_TAKEN");
    assert.equal((await book(clients.p2, { startsAt: local("10:15") })).data.error.code, "SLOT_TAKEN");
    assert.equal((await book(clients.p2, { startsAt: local("09:45") })).data.error.code, "SLOT_TAKEN");
    const touching = await book(clients.p2, { startsAt: local("10:30") });
    assert.equal(touching.status, 201);
    ids.p2Appointment = touching.data.appointment.id;
});

test("booking validation covers hours, doctor/service rules, timing and tenant boundaries", async () => {
    const cases = [
        [{ startsAt: local("13:15") }, "OUTSIDE_WORKING_HOURS"],
        [{ startsAt: local("16:45") }, "OUTSIDE_WORKING_HOURS"],
        [{ startsAt: local("10:07") }, "INVALID_START_TIME"],
        [{ doctorId: ids.doctor2, serviceId: ids.xray, startsAt: local("11:00") }, "DOCTOR_DOES_NOT_OFFER_SERVICE"],
        [{ serviceId: ids.serviceD, startsAt: local("11:00") }, "INVALID_SERVICE"],
        [{ serviceId: ids.hidden, startsAt: local("11:00") }, "INVALID_SERVICE"],
        [{ doctorId: ids.doctorD, startsAt: local("11:00") }, "INVALID_DOCTOR"],
        [{ doctorId: ids.doctor3, startsAt: local("11:00") }, "DOCTOR_NOT_BOOKABLE"],
        [{ startsAt: DateTime.now().minus({ hours: 1 }).startOf("hour").toUTC().toISO() }, "BOOKING_TOO_SOON"],
        [{ startsAt: day.plus({ days: 120 }).set({ hour: 10 }).toISO({ suppressMilliseconds: true }) }, "BOOKING_TOO_FAR"],
    ];
    for (const [json, code] of cases) {
        const res = await book(clients.p3, json);
        assert.equal(res.data.error && res.data.error.code, code, JSON.stringify(json));
    }
    assert.equal((await book(clients.p3, { startsAt: local("11:00"), clinicId: otherClinic.id })).status, 400);
    assert.equal((await book(clients.p3, { startsAt: "2027-04-30T00:30" })).status === 400, true, "DST-skipped or far time rejected");
    assert.equal(await prisma.appointment.count({ where: { patient: { userId: users.p3.id } } }), 0);
});

test("schedule exceptions block booking and disappear from availability", async () => {
    await clients.owner.post(`${C}/schedule-exceptions`, { json: { kind: "LEAVE", doctorId: ids.doctor1, startsAt: local("14:00"), endsAt: local("17:00") } });
    assert.equal((await book(clients.p3, { startsAt: local("15:00") })).data.error.code, "DOCTOR_UNAVAILABLE");
    const avail = await createClient(baseUrl).get(`${PUB}/availability?serviceId=${ids.consult}&doctorId=${ids.doctor1}&from=${MON}`);
    assert.equal(avail.data.doctors[0].slots.some((s) => s.startsAtLocal.slice(11, 13) >= "14"), false);
});

test("a patient can't be in two places at once, even with different doctors", async () => {
    const res = await book(clients.p1, { doctorId: ids.doctor2, startsAt: local("10:15") });
    assert.equal(res.data.error.code, "PATIENT_DOUBLE_BOOKED");
});

// ---------------------------------------------------------------- concurrency

test("10 patients racing for the same slot: exactly one wins", async () => {
    const racers = Array.from({ length: 10 }, (_, i) => clients[`racer${i}`]);
    const results = await Promise.all(racers.map((client) => book(client, { startsAt: local("11:00") })));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 201).length, 1, `statuses: ${statuses}`);
    assert.equal(statuses.filter((s) => s === 409).length, 9, `statuses: ${statuses}`);
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.data.error.code === "SLOT_TAKEN"));
    assert.equal(await prisma.appointment.count({ where: { doctorId: ids.doctor1, startsAt: new Date(utc("11:00")), status: { in: ["PENDING", "CONFIRMED"] } } }), 1);
});

test("racing overlapping (not identical) times: still only one wins", async () => {
    const [a, b, c] = await Promise.all([
        book(clients.racer1, { startsAt: local("11:30") }),
        book(clients.racer2, { startsAt: local("11:45") }),
        book(clients.racer3, { startsAt: local("11:40") }),
    ]);
    assert.equal([a, b, c].filter((r) => r.status === 201).length, 1, [a, b, c].map((r) => r.status).join(","));
    const rows = await prisma.appointment.findMany({ where: { doctorId: ids.doctor1, status: { in: ["PENDING", "CONFIRMED"] } }, orderBy: { startsAt: "asc" } });
    for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i].startsAt >= rows[i - 1].endsAt, "no overlapping rows in the database");
});

test("different doctors at the same time don't block each other", async () => {
    const [x, y] = await Promise.all([
        book(clients.racer4, { doctorId: ids.doctor2, startsAt: local("12:30") }),
        book(clients.racer5, { doctorId: ids.doctor1, startsAt: local("12:30") }),
    ]);
    assert.deepEqual([x.status, y.status], [201, 201]);
});

test("one patient can't hoard more than 5 upcoming appointments per clinic", async () => {
    const times = ["09:00", "13:00", "13:30", "14:00", "14:30", "15:00"];
    const results = [];
    for (const hhmm of times) results.push(await book(clients.hoarder, { doctorId: ids.doctor2, startsAt: local(hhmm) }));
    assert.deepEqual(results.slice(0, 5).map((r) => r.status), [201, 201, 201, 201, 201]);
    assert.equal(results[5].data.error.code, "PATIENT_BOOKING_LIMIT");
});

// ---------------------------------------------------------------- staff flows

test("reception books a walk-in patient (no account) as CONFIRMED", async () => {
    const res = await clients.receptionist.post(`${C}/appointments`, {
        json: { doctorId: ids.doctor2, serviceId: ids.consult, startsAt: local("16:00"), patient: { fullName: "Walk In", phone: "01000000000" } },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.appointment.status, "CONFIRMED");
    assert.equal(res.data.appointment.source, "STAFF");
    assert.equal(res.data.appointment.patient.hasAccount, false);
    ids.walkIn = res.data.appointment.id;
    ids.walkInPatient = res.data.appointment.patient.id;

    const search = await clients.receptionist.get(`${C}/patients?q=Walk`);
    assert.deepEqual(search.data.items.map((p) => p.id), [ids.walkInPatient]);
    assert.equal((await clients.receptionist.post(`${C}/appointments`, { json: { doctorId: ids.doctor2, serviceId: ids.consult, startsAt: local("16:30"), patientId: 999999 } })).data.error.code, "INVALID_PATIENT");
    assert.equal((await clients.doctor1.post(`${C}/appointments`, { json: { doctorId: ids.doctor1, serviceId: ids.consult, startsAt: local("12:30"), patientId: ids.walkInPatient } })).status, 403);
});

test("lifecycle: confirm once, no completing the future, complete / no-show after start", async () => {
    const confirmed = await clients.receptionist.post(`${C}/appointments/${ids.p1Appointment}/confirm`, { json: {} });
    assert.equal(confirmed.data.appointment.status, "CONFIRMED");
    assert.ok(confirmed.data.appointment.confirmedAt);
    assert.equal((await clients.receptionist.post(`${C}/appointments/${ids.p1Appointment}/confirm`, { json: {} })).data.error.code, "INVALID_STATUS_TRANSITION");
    assert.equal((await clients.receptionist.post(`${C}/appointments/${ids.p1Appointment}/complete`, { json: {} })).data.error.code, "APPOINTMENT_NOT_STARTED");

    const past1 = await insertAppointment({ startsAt: new Date(Date.now() - 3 * 3_600_000), patientId: ids.walkInPatient });
    const past2 = await insertAppointment({ startsAt: new Date(Date.now() - 5 * 3_600_000), patientId: ids.walkInPatient });
    assert.equal((await clients.doctor1.post(`${C}/appointments/${past1.id}/complete`, { json: {} })).data.appointment.status, "COMPLETED");
    assert.equal((await clients.receptionist.post(`${C}/appointments/${past2.id}/no-show`, { json: {} })).data.appointment.status, "NO_SHOW");
    assert.equal((await clients.receptionist.post(`${C}/appointments/${past1.id}/cancel`, { json: {} })).data.error.code, "INVALID_STATUS_TRANSITION");
});

test("doctors see and update only their own appointments", async () => {
    const list = await clients.doctor1.get(`${C}/appointments?from=${MON}&to=${MON}`);
    assert.ok(list.data.items.length > 0);
    assert.ok(list.data.items.every((a) => a.doctor.id === ids.doctor1));
    assert.deepEqual((await clients.doctor1.get(`${C}/appointments?from=${MON}&to=${MON}&doctorId=${ids.doctor2}`)).data.items, []);

    assert.equal((await clients.doctor1.get(`${C}/appointments/${ids.walkIn}`)).status, 404);
    assert.equal((await clients.doctor2.post(`${C}/appointments/${ids.p2Appointment}/confirm`, { json: {} })).status, 404);
    assert.equal((await clients.doctor1.post(`${C}/appointments/${ids.p2Appointment}/cancel`, { json: {} })).status, 403);
    assert.equal((await clients.doctor1.post(`${C}/appointments/${ids.p2Appointment}/reschedule`, { json: { startsAt: local("12:30") } })).status, 403);
    assert.equal((await clients.doctor1.post(`${C}/appointments/${ids.p2Appointment}/confirm`, { json: {} })).data.appointment.status, "CONFIRMED");
    assert.equal((await clients.doctor1.get(`${C}/patients`)).status, 403);
});

test("staff reschedule re-validates, keeps status and frees the old time", async () => {
    assert.equal((await clients.receptionist.post(`${C}/appointments/${ids.p2Appointment}/reschedule`, { json: { startsAt: local("10:00") } })).data.error.code, "SLOT_TAKEN");
    const moved = await clients.receptionist.post(`${C}/appointments/${ids.p2Appointment}/reschedule`, { json: { startsAt: local("09:00") } });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.appointment.status, "CONFIRMED");
    assert.equal(moved.data.appointment.rescheduleCount, 1);

    const free = await book(clients.p3, { startsAt: local("10:30") });
    assert.equal(free.status, 201, "the old 10:30 slot is free again");
    ids.p3Appointment = free.data.appointment.id;

    const otherDoctor = await clients.receptionist.post(`${C}/appointments/${ids.p3Appointment}/reschedule`, { json: { startsAt: local("10:30"), doctorId: ids.doctor2 } });
    assert.equal(otherDoctor.status, 200);
    assert.equal(otherDoctor.data.appointment.doctor.id, ids.doctor2);
});

// ---------------------------------------------------------------- patient self-service

test("patients see only their own appointments and can't touch anyone else's", async () => {
    const mine = await clients.p2.get("/api/v1/me/appointments");
    assert.deepEqual(mine.data.items.map((a) => a.id), [ids.p2Appointment]);
    assert.equal(mine.data.items[0].clinic.slug, "book-c");
    assert.equal(mine.data.items[0].patient, undefined);

    assert.equal((await clients.p2.post(`/api/v1/me/appointments/${ids.p1Appointment}/cancel`, { json: {} })).status, 404);
    assert.equal((await clients.p2.post(`/api/v1/me/appointments/${ids.p1Appointment}/reschedule`, { json: { startsAt: local("12:45") } })).status, 404);
    assert.equal((await clients.p2.get(`${C}/appointments`)).status, 404, "a patient is not clinic staff");
});

test("patient reschedule returns the booking to PENDING; cancel frees the slot", async () => {
    const moved = await clients.p1.post(`/api/v1/me/appointments/${ids.p1Appointment}/reschedule`, { json: { startsAt: local("09:30") } });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.appointment.status, "PENDING");

    const cancelled = await clients.p1.post(`/api/v1/me/appointments/${ids.p1Appointment}/cancel`, { json: { reason: "Travelling" } });
    assert.equal(cancelled.data.appointment.status, "CANCELLED");
    assert.equal(cancelled.data.appointment.cancellationReason, "Travelling");
    assert.equal((await clients.p1.post(`/api/v1/me/appointments/${ids.p1Appointment}/cancel`, { json: {} })).data.error.code, "INVALID_STATUS_TRANSITION");

    assert.equal((await book(clients.p3, { startsAt: local("09:30") })).status, 201, "cancelled time is bookable again");
    const past = await clients.p1.get("/api/v1/me/appointments?scope=past");
    assert.ok(past.data.items.some((a) => a.id === ids.p1Appointment));
});

test("online changes close 2 hours before the appointment", async () => {
    const soon = await insertAppointment({ startsAt: new Date(Date.now() + 60 * 60_000), status: "CONFIRMED", patientId: ids.p1Patient, doctorId: ids.doctor2 });
    assert.equal((await clients.p1.post(`/api/v1/me/appointments/${soon.id}/cancel`, { json: {} })).data.error.code, "CHANGE_TOO_LATE");
    assert.equal((await clients.p1.post(`/api/v1/me/appointments/${soon.id}/reschedule`, { json: { startsAt: local("15:30") } })).data.error.code, "CHANGE_TOO_LATE");
    assert.equal((await clients.receptionist.post(`${C}/appointments/${soon.id}/cancel`, { json: { reason: "Patient called" } })).status, 200, "staff can still cancel");
});

// ---------------------------------------------------------------- tenant isolation

test("another clinic can't see or touch these appointments or patients", async () => {
    const d = clients.ownerD;
    assert.equal((await d.get(`${D}/appointments/${ids.walkIn}`)).status, 404);
    assert.equal((await d.post(`${D}/appointments/${ids.walkIn}/cancel`, { json: {} })).status, 404);
    assert.equal((await d.post(`${D}/appointments/${ids.walkIn}/reschedule`, { json: { startsAt: local("11:00") } })).status, 404);
    assert.deepEqual((await d.get(`${D}/appointments?from=${MON}&to=${MON}`)).data.items, []);
    assert.equal((await d.get(`${D}/patients/${ids.walkInPatient}`)).status, 404);
    assert.deepEqual((await d.get(`${D}/patients?q=Walk`)).data.items, []);
    assert.equal((await d.post(`${D}/appointments`, { json: { doctorId: ids.doctor1, serviceId: ids.serviceD, startsAt: local("11:00"), patient: { fullName: "Xy Zed" } } })).data.error.code, "INVALID_DOCTOR");
    assert.equal((await d.post(`${D}/appointments`, { json: { doctorId: ids.doctorD, serviceId: ids.serviceD, startsAt: local("11:00"), patientId: ids.walkInPatient } })).data.error.code, "INVALID_PATIENT");
    assert.equal((await d.get(`${C}/appointments`)).status, 404);
    assert.equal(await prisma.patient.count({ where: { clinicId: otherClinic.id } }), 0, "failed bookings left no patient rows");
});

test("the database refuses appointments that mix clinics", async () => {
    await assertConnectedToTestDatabase();
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status, source, duration_minutes, price_minor, currency, updated_at)
            VALUES (${otherClinic.id}, ${ids.doctor1}, ${ids.serviceD}, ${ids.walkInPatient}, '2030-01-01 10:00:00', '2030-01-01 10:30:00', 'CONFIRMED', 'STAFF', 30, 100, 'EGP', NOW(3))`,
        /foreign key|FOREIGN KEY|1452/
    );
    await assert.rejects(
        prisma.$executeRaw`INSERT INTO appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status, source, duration_minutes, price_minor, currency, updated_at)
            VALUES (${clinic.id}, ${ids.doctor1}, ${ids.consult}, ${ids.walkInPatient}, '2030-01-01 10:30:00', '2030-01-01 10:00:00', 'CONFIRMED', 'STAFF', 30, 100, 'EGP', NOW(3))`,
        /constraint|CONSTRAINT|4025/
    );
});

test("audit trail covers the booking lifecycle", async () => {
    const actions = new Set((await prisma.auditLog.findMany({ where: { clinicId: clinic.id }, select: { action: true } })).map((a) => a.action));
    for (const action of ["appointment.created", "appointment.confirmed", "appointment.cancelled", "appointment.completed", "appointment.no_show", "appointment.rescheduled", "patient.created"]) {
        assert.ok(actions.has(action), `missing ${action}`);
    }
});
