// Pure availability engine — no database access, fully deterministic, unit-tested.
//
// Effective working time for a doctor on a local date =
//   doctor's weekly intervals for that weekday
//   ∩ clinic's weekly intervals (only if the clinic has configured any opening hours)
//   − blocked periods (clinic-wide + doctor exceptions, and the doctor's active appointments).
//
// Weekly intervals are wall-clock minutes in the clinic's IANA zone; every candidate start is
// converted to a real instant with Luxon, so DST days are handled and skipped local times are
// never offered.
const { DateTime } = require("luxon");

function intersectIntervals(a, b) {
    const result = [];
    for (const x of a) {
        for (const y of b) {
            const start = Math.max(x.startMinute, y.startMinute);
            const end = Math.min(x.endMinute, y.endMinute);
            if (start < end) result.push({ startMinute: start, endMinute: end });
        }
    }
    return result.sort((p, q) => p.startMinute - q.startMinute);
}

function intervalsForWeekday(rows, weekday) {
    return rows
        .filter((row) => row.weekday === weekday)
        .map(({ startMinute, endMinute }) => ({ startMinute, endMinute }));
}

// Local wall-clock minute on a local date → instant. Returns null when that local time doesn't
// exist (DST gap). Minute 1440 means 00:00 of the next day.
function localMinuteToInstant(date, minute, zone) {
    const base = DateTime.fromObject({ year: date.year, month: date.month, day: date.day }, { zone });
    const local = minute === 1440 ? base.plus({ days: 1 }).startOf("day") : base.set({ hour: Math.floor(minute / 60), minute: minute % 60 });
    if (!local.isValid) return null;
    if (minute !== 1440 && (local.hour !== Math.floor(minute / 60) || local.minute !== minute % 60)) return null;
    return local;
}

function effectiveIntervals({ weekday, clinicHours, doctorHours }) {
    const doctor = intervalsForWeekday(doctorHours, weekday);
    if (clinicHours.length === 0) return doctor;
    return intersectIntervals(doctor, intervalsForWeekday(clinicHours, weekday));
}

function overlapsAny(startMs, endMs, blocked) {
    return blocked.some((period) => startMs < period.endsAt.getTime() && endMs > period.startsAt.getTime());
}

/**
 * Bookable slots between two local dates (inclusive).
 * @returns {{startsAt: Date, endsAt: Date}[]} sorted, UTC instants
 */
function computeSlots({ zone, fromDate, toDate, clinicHours, doctorHours, blocked, durationMinutes, stepMinutes, notBefore, notAfter }) {
    const slots = [];
    const last = DateTime.fromISO(toDate, { zone }).startOf("day");
    for (let day = DateTime.fromISO(fromDate, { zone }).startOf("day"); day <= last; day = day.plus({ days: 1 })) {
        for (const interval of effectiveIntervals({ weekday: day.weekday, clinicHours, doctorHours })) {
            const intervalEnd = localMinuteToInstant(day, interval.endMinute, zone);
            if (!intervalEnd) continue;
            for (let minute = interval.startMinute; minute + durationMinutes <= interval.endMinute; minute += stepMinutes) {
                const start = localMinuteToInstant(day, minute, zone);
                if (!start) continue;
                const startMs = start.toMillis();
                const endMs = startMs + durationMinutes * 60_000;
                if (endMs > intervalEnd.toMillis()) continue;
                if (notBefore && startMs < notBefore.getTime()) continue;
                if (notAfter && startMs > notAfter.getTime()) continue;
                if (overlapsAny(startMs, endMs, blocked)) continue;
                slots.push({ startsAt: new Date(startMs), endsAt: new Date(endMs) });
            }
        }
    }
    return slots;
}

/**
 * Why a specific start time is not bookable, or null if it is.
 * Unlike computeSlots, the start does not have to sit on the slot grid.
 */
function checkSlot({ zone, startsAt, durationMinutes, clinicHours, doctorHours, exceptions, appointments, notBefore, notAfter }) {
    const startMs = startsAt.getTime();
    const endMs = startMs + durationMinutes * 60_000;
    if (notBefore && startMs < notBefore.getTime()) return "BOOKING_TOO_SOON";
    if (notAfter && startMs > notAfter.getTime()) return "BOOKING_TOO_FAR";

    const local = DateTime.fromJSDate(startsAt, { zone: "utc" }).setZone(zone);
    const day = local.startOf("day");
    const startMinute = local.hour * 60 + local.minute;
    const fits = effectiveIntervals({ weekday: local.weekday, clinicHours, doctorHours }).some((interval) => {
        if (startMinute < interval.startMinute || local.second !== 0 || local.millisecond !== 0) return false;
        const intervalEnd = localMinuteToInstant(day, interval.endMinute, zone);
        return intervalEnd !== null && endMs <= intervalEnd.toMillis();
    });
    if (!fits) return "OUTSIDE_WORKING_HOURS";
    if (overlapsAny(startMs, endMs, exceptions)) return "DOCTOR_UNAVAILABLE";
    if (overlapsAny(startMs, endMs, appointments)) return "SLOT_TAKEN";
    return null;
}

module.exports = { computeSlots, checkSlot, intersectIntervals, effectiveIntervals, localMinuteToInstant };
