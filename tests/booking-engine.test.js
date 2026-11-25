const test = require("node:test");
const assert = require("node:assert/strict");
const { computeSlots, checkSlot, intersectIntervals } = require("../src/modules/appointments/availability");
const { assertTransition } = require("../src/modules/appointments/appointment-status");
const { assertProductionWriteAllowed } = require("../src/config/db-guard");
const { onlineBookingSchema, staffCreateSchema } = require("../src/modules/appointments/appointment.schemas");

const zone = "Africa/Cairo";
const h = (weekday, start, end) => ({ weekday, startMinute: start * 60, endMinute: end * 60 });
const at = (iso) => new Date(iso);
const locals = (slots) => slots.map((s) => s.startsAt.toISOString());

// 2026-01-12 is a Monday (ISO weekday 1); Cairo is UTC+2 in January.
const monday = "2026-01-12";

function slotsFor(overrides = {}) {
    return computeSlots({
        zone,
        fromDate: monday,
        toDate: monday,
        clinicHours: [h(1, 10, 18)],
        doctorHours: [h(1, 9, 12)],
        blocked: [],
        durationMinutes: 30,
        stepMinutes: 15,
        ...overrides,
    });
}

test("intersectIntervals keeps only the shared part of both schedules", () => {
    assert.deepEqual(intersectIntervals([{ startMinute: 540, endMinute: 720 }], [{ startMinute: 600, endMinute: 1080 }]), [{ startMinute: 600, endMinute: 720 }]);
    assert.deepEqual(intersectIntervals([{ startMinute: 540, endMinute: 600 }], [{ startMinute: 600, endMinute: 660 }]), []);
});

test("slots = doctor hours ∩ clinic hours, on a 15-minute grid, converted to UTC", () => {
    const slots = slotsFor();
    // Doctor 09–12 ∩ clinic 10–18 = 10:00–12:00 → starts 10:00 … 11:30 (7 slots).
    assert.equal(slots.length, 7);
    assert.equal(slots[0].startsAt.toISOString(), "2026-01-12T08:00:00.000Z");
    assert.equal(slots[6].startsAt.toISOString(), "2026-01-12T09:30:00.000Z");
    assert.equal(slots[6].endsAt.toISOString(), "2026-01-12T10:00:00.000Z");
});

test("without configured clinic hours the doctor's hours alone apply", () => {
    assert.equal(slotsFor({ clinicHours: [] }).length, 11); // 09:00 … 11:30
});

test("a weekday the doctor doesn't work has no slots", () => {
    assert.equal(slotsFor({ fromDate: "2026-01-13", toDate: "2026-01-13" }).length, 0);
});

test("booked appointments and exceptions remove overlapping slots; touching ends are fine", () => {
    // Busy 10:30–11:00 local (08:30–09:00Z).
    const slots = slotsFor({ blocked: [{ startsAt: at("2026-01-12T08:30:00Z"), endsAt: at("2026-01-12T09:00:00Z") }] });
    assert.deepEqual(locals(slots), [
        "2026-01-12T08:00:00.000Z", // 10:00–10:30 touches the busy block: allowed
        "2026-01-12T09:00:00.000Z", // 11:00
        "2026-01-12T09:15:00.000Z",
        "2026-01-12T09:30:00.000Z",
    ]);
    const closed = slotsFor({ blocked: [{ startsAt: at("2026-01-11T22:00:00Z"), endsAt: at("2026-01-12T22:00:00Z") }] });
    assert.equal(closed.length, 0);
});

test("notBefore / notAfter trim the window", () => {
    const slots = slotsFor({ notBefore: at("2026-01-12T09:00:00Z"), notAfter: at("2026-01-12T09:15:00Z") });
    assert.deepEqual(locals(slots), ["2026-01-12T09:00:00.000Z", "2026-01-12T09:15:00.000Z"]);
});

test("summer time: 09:00 Cairo is 06:00Z in July (UTC+3)", () => {
    const slots = computeSlots({ zone, fromDate: "2026-07-13", toDate: "2026-07-13", clinicHours: [], doctorHours: [h(1, 9, 10)], blocked: [], durationMinutes: 30, stepMinutes: 30 });
    assert.deepEqual(locals(slots), ["2026-07-13T06:00:00.000Z", "2026-07-13T06:30:00.000Z"]);
});

test("DST start day: wall-clock times skipped by the jump are never offered", () => {
    // Egypt: Friday 2026-04-24 00:00 → 01:00. Doctor works Fridays 00:00–02:00.
    const slots = computeSlots({ zone, fromDate: "2026-04-24", toDate: "2026-04-24", clinicHours: [], doctorHours: [h(5, 0, 2)], blocked: [], durationMinutes: 30, stepMinutes: 15 });
    assert.deepEqual(locals(slots), ["2026-04-23T22:00:00.000Z", "2026-04-23T22:15:00.000Z", "2026-04-23T22:30:00.000Z"]);
    for (let i = 1; i < slots.length; i += 1) assert.ok(slots[i].startsAt > slots[i - 1].startsAt);
});

test("multi-day ranges walk each local day", () => {
    const slots = computeSlots({ zone, fromDate: "2026-01-12", toDate: "2026-01-18", clinicHours: [], doctorHours: [h(1, 9, 10), h(3, 9, 10)], blocked: [], durationMinutes: 60, stepMinutes: 60 });
    assert.deepEqual(locals(slots), ["2026-01-12T07:00:00.000Z", "2026-01-14T07:00:00.000Z"]);
});

test("checkSlot explains exactly why a time can't be booked", () => {
    const base = {
        zone,
        durationMinutes: 30,
        clinicHours: [h(1, 9, 17)],
        doctorHours: [{ weekday: 1, startMinute: 540, endMinute: 780 }, { weekday: 1, startMinute: 840, endMinute: 1020 }],
        exceptions: [{ startsAt: at("2026-01-12T13:00:00Z"), endsAt: at("2026-01-12T15:00:00Z") }],
        appointments: [{ startsAt: at("2026-01-12T08:00:00Z"), endsAt: at("2026-01-12T08:30:00Z") }],
        notBefore: at("2026-01-12T06:00:00Z"),
        notAfter: at("2026-04-01T00:00:00Z"),
    };
    const check = (iso) => checkSlot({ ...base, startsAt: at(iso) });
    assert.equal(check("2026-01-12T07:00:00Z"), null); // 09:00
    assert.equal(check("2026-01-12T07:05:00Z"), null); // 09:05, off-grid is fine for staff
    assert.equal(check("2026-01-12T08:15:00Z"), "SLOT_TAKEN"); // 10:15 overlaps 10:00–10:30
    assert.equal(check("2026-01-12T08:30:00Z"), null); // 10:30 touches
    assert.equal(check("2026-01-12T10:45:00Z"), "OUTSIDE_WORKING_HOURS"); // 12:45–13:15 crosses the break
    assert.equal(check("2026-01-12T11:30:00Z"), "OUTSIDE_WORKING_HOURS"); // 13:30 in the break
    assert.equal(check("2026-01-12T13:00:00Z"), "DOCTOR_UNAVAILABLE"); // 15:00 during exception
    assert.equal(check("2026-01-12T05:00:00Z"), "BOOKING_TOO_SOON");
    assert.equal(check("2026-05-04T07:00:00Z"), "BOOKING_TOO_FAR");
    assert.equal(check("2026-01-13T07:00:00Z"), "OUTSIDE_WORKING_HOURS"); // Tuesday
});

test("appointment lifecycle transitions", () => {
    const now = at("2026-01-12T12:00:00Z");
    const past = at("2026-01-12T08:00:00Z");
    const future = at("2026-01-13T08:00:00Z");
    assert.equal(assertTransition("confirm", { status: "PENDING", startsAt: future }, now), "CONFIRMED");
    assert.equal(assertTransition("cancel", { status: "PENDING", startsAt: future }, now), "CANCELLED");
    assert.equal(assertTransition("cancel", { status: "CONFIRMED", startsAt: future }, now), "CANCELLED");
    assert.equal(assertTransition("complete", { status: "CONFIRMED", startsAt: past }, now), "COMPLETED");
    assert.equal(assertTransition("no_show", { status: "CONFIRMED", startsAt: past }, now), "NO_SHOW");

    for (const [action, status, startsAt, code] of [
        ["confirm", "CONFIRMED", future, "INVALID_STATUS_TRANSITION"],
        ["cancel", "CANCELLED", future, "INVALID_STATUS_TRANSITION"],
        ["cancel", "COMPLETED", past, "INVALID_STATUS_TRANSITION"],
        ["complete", "PENDING", past, "INVALID_STATUS_TRANSITION"],
        ["complete", "CONFIRMED", future, "APPOINTMENT_NOT_STARTED"],
        ["reschedule", "CANCELLED", future, "INVALID_STATUS_TRANSITION"],
        ["reschedule", "NO_SHOW", past, "INVALID_STATUS_TRANSITION"],
    ]) {
        assert.throws(() => assertTransition(action, { status, startsAt }, now), { code }, `${action} from ${status}`);
    }
});

test("booking schemas: either patientId or patient details; no clinicId", () => {
    const base = { doctorId: 1, serviceId: 2, startsAt: "2026-01-12T10:00" };
    assert.equal(staffCreateSchema.safeParse({ ...base, patientId: 3 }).success, true);
    assert.equal(staffCreateSchema.safeParse({ ...base, patient: { fullName: "Walk In" } }).success, true);
    assert.equal(staffCreateSchema.safeParse(base).success, false);
    assert.equal(staffCreateSchema.safeParse({ ...base, patientId: 3, patient: { fullName: "Both" } }).success, false);
    assert.equal(onlineBookingSchema.safeParse({ ...base, clinicId: 9 }).success, false);
    assert.equal(onlineBookingSchema.safeParse({ ...base, status: "CONFIRMED" }).success, false, "patients can't self-confirm");
    assert.equal(onlineBookingSchema.safeParse({ ...base, phone: "not a phone!" }).success, false);
});

test("production guard: writing Prisma commands against mawid are refused", () => {
    const url = "mysql://root@127.0.0.1:3306/mawid";
    const argv = (...args) => ["node", "prisma", ...args];
    for (const args of [["migrate", "deploy"], ["migrate", "dev"], ["migrate", "reset", "--force"], ["db", "push"], ["db", "execute", "--stdin"], ["migrate", "resolve", "--applied", "x"]]) {
        assert.throws(() => assertProductionWriteAllowed({ argv: argv(...args), databaseUrl: url, allow: undefined }), /Refusing/, args.join(" "));
    }
    for (const args of [["generate"], ["validate"], ["migrate", "status"], ["migrate", "diff", "--script"], ["format"]]) {
        assert.doesNotThrow(() => assertProductionWriteAllowed({ argv: argv(...args), databaseUrl: url, allow: undefined }), args.join(" "));
    }
    assert.doesNotThrow(() => assertProductionWriteAllowed({ argv: argv("migrate", "deploy"), databaseUrl: "mysql://root@h/mawid_test", allow: undefined }));
    assert.doesNotThrow(() => assertProductionWriteAllowed({ argv: argv("migrate", "deploy"), databaseUrl: url, allow: "1" }));
});
