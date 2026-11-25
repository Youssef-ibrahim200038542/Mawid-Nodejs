const test = require("node:test");
const assert = require("node:assert/strict");
const time = require("../src/lib/time");
const { hasPermission } = require("../src/lib/permissions");
const { parseIdParam } = require("../src/lib/tenant-data");
const { createServiceSchema, updateServiceSchema } = require("../src/modules/clinic-services/clinic-service.schemas");
const { createSpecialtySchema } = require("../src/modules/specialties/specialty.schemas");
const { createDoctorSchema } = require("../src/modules/doctors/doctor.schemas");
const { weeklyHoursSchema, createExceptionSchema } = require("../src/modules/schedules/schedule.schemas");
const { assertCanManageSchedule, resolvePeriod } = require("../src/modules/schedules/schedule.service");

const cairo = "Africa/Cairo";

test("time: HH:mm parsing and formatting", () => {
    assert.equal(time.parseHHMM("00:00"), 0);
    assert.equal(time.parseHHMM("09:30"), 570);
    assert.equal(time.parseHHMM("24:00"), 1440);
    for (const bad of ["24:01", "9:00", "25:00", "12:60", "noon"]) assert.equal(time.parseHHMM(bad), null, bad);
    assert.equal(time.formatHHMM(570), "09:30");
    assert.equal(time.formatHHMM(1440), "24:00");
});

test("time: Cairo wall-clock converts to UTC with the right offset in winter and summer", () => {
    assert.equal(time.localDateTimeToUtc("2026-01-15T09:00", cairo).toISOString(), "2026-01-15T07:00:00.000Z");
    assert.equal(time.localDateTimeToUtc("2026-07-15T09:00", cairo).toISOString(), "2026-07-15T06:00:00.000Z");
});

test("time: a wall-clock time skipped by the Cairo DST jump is rejected, not shifted", () => {
    assert.throws(() => time.localDateTimeToUtc("2026-04-24T00:30", cairo), { code: "LOCAL_TIME_INVALID" });
    assert.equal(time.localDateTimeToUtc("2026-04-24T01:00", cairo).toISOString(), "2026-04-23T22:00:00.000Z");
});

test("time: offset ISO input is taken as-is; local input uses the clinic zone", () => {
    assert.equal(time.instantToUtc("2026-01-15T09:00:00+02:00", cairo).toISOString(), "2026-01-15T07:00:00.000Z");
    assert.equal(time.instantToUtc("2026-01-15T07:00:00Z", "Asia/Tokyo").toISOString(), "2026-01-15T07:00:00.000Z");
    assert.equal(time.instantToUtc("2026-01-15T09:00", cairo).toISOString(), "2026-01-15T07:00:00.000Z");
    assert.throws(() => time.instantToUtc("2026-02-30T09:00", cairo), { code: "LOCAL_TIME_INVALID" });
});

test("time: whole local days map to [00:00, next 00:00) in the clinic zone", () => {
    assert.equal(time.localDateStartToUtc("2026-01-07", cairo).toISOString(), "2026-01-06T22:00:00.000Z");
    assert.equal(time.nextLocalDateStartToUtc("2026-01-07", cairo).toISOString(), "2026-01-07T22:00:00.000Z");
    assert.equal(time.utcToLocalIso(new Date("2026-07-15T06:00:00Z"), cairo), "2026-07-15T09:00:00+03:00");
});

test("service price is parsed exactly into minor units", () => {
    const base = { nameEn: "Consultation", durationMinutes: 30 };
    const cases = [["350", 35000], ["350.5", 35050], ["350.50", 35050], [0.1, 10], [350.5, 35050], ["0", 0]];
    for (const [price, minor] of cases) {
        assert.equal(createServiceSchema.parse({ ...base, price }).price, minor, String(price));
    }
    for (const price of ["1.234", "-5", "abc", "", -1, 1e21, "99999999"]) {
        assert.equal(createServiceSchema.safeParse({ ...base, price }).success, false, String(price));
    }
});

test("service validation: duration bounds, currency list, defaults and unknown fields", () => {
    const ok = createServiceSchema.parse({ nameEn: " Cleaning ", nameAr: "تنظيف", durationMinutes: 45, price: "500" });
    assert.equal(ok.nameEn, "Cleaning");
    assert.equal(ok.currency, "EGP");
    for (const input of [
        { nameEn: "X1", durationMinutes: 4, price: "1" },
        { nameEn: "X1", durationMinutes: 481, price: "1" },
        { nameEn: "X1", durationMinutes: 30.5, price: "1" },
        { nameEn: "X1", durationMinutes: 30, price: "1", currency: "XYZ" },
        { nameEn: "X1", durationMinutes: 30, price: "1", clinicId: 3 },
    ]) {
        assert.equal(createServiceSchema.safeParse(input).success, false, JSON.stringify(input));
    }
    assert.equal(updateServiceSchema.safeParse({}).success, false);
});

test("specialty and doctor schemas reject clinicId and duplicate ids", () => {
    assert.equal(createSpecialtySchema.safeParse({ nameEn: "Dentistry", clinicId: 1 }).success, false);
    assert.equal(createSpecialtySchema.safeParse({ nameEn: "D" }).success, false);
    assert.equal(createDoctorSchema.safeParse({ memberId: 1, displayNameEn: "Dr A", specialtyIds: [1, 1] }).success, false);
    assert.equal(createDoctorSchema.safeParse({ memberId: 1, displayNameEn: "Dr A", clinicId: 2 }).success, false);
    assert.deepEqual(createDoctorSchema.parse({ memberId: 1, displayNameEn: "Dr A" }).serviceIds, []);
});

test("weekly hours: breaks as separate intervals, touching allowed, overlaps rejected", () => {
    const parsed = weeklyHoursSchema.parse({
        intervals: [
            { weekday: 1, start: "14:00", end: "18:00" },
            { weekday: 1, start: "09:00", end: "13:00" },
            { weekday: 2, start: "09:00", end: "13:00" },
            { weekday: 2, start: "13:00", end: "24:00" },
        ],
    });
    assert.deepEqual(parsed.intervals[1], { weekday: 1, startMinute: 540, endMinute: 780 });

    for (const intervals of [
        [{ weekday: 1, start: "09:00", end: "13:00" }, { weekday: 1, start: "12:00", end: "15:00" }],
        [{ weekday: 1, start: "13:00", end: "09:00" }],
        [{ weekday: 1, start: "09:00", end: "09:00" }],
        [{ weekday: 0, start: "09:00", end: "10:00" }],
        [{ weekday: 8, start: "09:00", end: "10:00" }],
        [{ weekday: 1, start: "9:00", end: "10:00" }],
    ]) {
        assert.equal(weeklyHoursSchema.safeParse({ intervals }).success, false, JSON.stringify(intervals));
    }
    assert.deepEqual(weeklyHoursSchema.parse({ intervals: [] }).intervals, []);
});

test("schedule exception schema: all-day or exact period, nothing in between", () => {
    assert.equal(createExceptionSchema.safeParse({ kind: "HOLIDAY", allDay: true, startDate: "2026-01-07", endDate: "2026-01-07" }).success, true);
    assert.equal(createExceptionSchema.safeParse({ kind: "LEAVE", startsAt: "2026-07-15T09:00", endsAt: "2026-07-15T17:00" }).success, true);
    for (const input of [
        { kind: "HOLIDAY", allDay: true, startsAt: "2026-07-15T09:00", endsAt: "2026-07-15T17:00" },
        { kind: "PARTY", startsAt: "2026-07-15T09:00", endsAt: "2026-07-15T17:00" },
        { kind: "LEAVE", startsAt: "tomorrow", endsAt: "2026-07-15T17:00" },
        { kind: "LEAVE", startsAt: "2026-07-15T09:00", endsAt: "2026-07-15T17:00", clinicId: 1 },
    ]) {
        assert.equal(createExceptionSchema.safeParse(input).success, false, JSON.stringify(input));
    }
});

test("resolvePeriod converts in the clinic zone and rejects empty or over-long periods", () => {
    const allDay = resolvePeriod({ allDay: true, startDate: "2026-01-07", endDate: "2026-01-08" }, cairo);
    assert.equal(allDay.startsAt.toISOString(), "2026-01-06T22:00:00.000Z");
    assert.equal(allDay.endsAt.toISOString(), "2026-01-08T22:00:00.000Z");

    assert.throws(() => resolvePeriod({ startsAt: "2026-07-15T17:00", endsAt: "2026-07-15T09:00" }, cairo), { code: "INVALID_PERIOD" });
    assert.throws(() => resolvePeriod({ allDay: true, startDate: "2026-01-01", endDate: "2027-06-01" }, cairo), { code: "INVALID_PERIOD" });
});

test("schedule ownership: owners manage all, doctors only their own, receptionists none", () => {
    const ownDoctor = { id: 5, memberId: 50 };
    const otherDoctor = { id: 6, memberId: 60 };
    assert.doesNotThrow(() => assertCanManageSchedule({ role: "OWNER", memberId: 1 }, otherDoctor));
    assert.doesNotThrow(() => assertCanManageSchedule({ role: "OWNER", memberId: 1 }, null));
    assert.doesNotThrow(() => assertCanManageSchedule({ role: "DOCTOR", memberId: 50 }, ownDoctor));
    assert.throws(() => assertCanManageSchedule({ role: "DOCTOR", memberId: 50 }, otherDoctor), { status: 403 });
    assert.throws(() => assertCanManageSchedule({ role: "DOCTOR", memberId: 50 }, null), { status: 403 });
    assert.throws(() => assertCanManageSchedule({ role: "RECEPTIONIST", memberId: 70 }, ownDoctor), { status: 403 });
});

test("permissions: every role can read clinic operations, only owners manage them", () => {
    for (const area of ["specialties", "services", "doctors", "schedule"]) {
        for (const role of ["OWNER", "DOCTOR", "RECEPTIONIST"]) {
            assert.equal(hasPermission(role, `${area}:read`), true, `${role} ${area}:read`);
        }
        assert.equal(hasPermission("OWNER", `${area}:manage`), true);
        assert.equal(hasPermission("DOCTOR", `${area}:manage`), false);
        assert.equal(hasPermission("RECEPTIONIST", `${area}:manage`), false);
    }
    assert.equal(hasPermission("DOCTOR", "schedule:manage_own"), true);
    assert.equal(hasPermission("RECEPTIONIST", "schedule:manage_own"), false);
});

test("id params: only positive 32-bit integers, everything else is a 404", () => {
    assert.equal(parseIdParam("42"), 42);
    for (const bad of ["0", "-1", "01", "1.5", "abc", "2147483648", "99999999999", undefined]) {
        assert.throws(() => parseIdParam(bad), { status: 404 }, String(bad));
    }
});
