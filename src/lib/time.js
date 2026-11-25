// All timezone math goes through this module.
// Storage: absolute instants in UTC. Weekly hours: wall-clock minutes in the clinic's IANA zone.
const { DateTime } = require("luxon");
const { AppError } = require("./errors");

const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const offsetDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function parseHHMM(value) {
    if (!hhmmPattern.test(value)) return null;
    if (value === "24:00") return 1440;
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
}

function formatHHMM(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function invalidLocalTime(message) {
    return new AppError(400, "LOCAL_TIME_INVALID", message);
}

// "2026-04-24T00:30" in Africa/Cairo → UTC Date. Rejects wall-clock times that do not exist
// (skipped by a DST jump) instead of silently shifting them.
function localDateTimeToUtc(value, zone) {
    if (!localDateTimePattern.test(value)) throw invalidLocalTime("Use the format YYYY-MM-DDTHH:mm.");
    const local = DateTime.fromISO(value, { zone });
    if (!local.isValid) throw invalidLocalTime("That date or time is not valid.");
    const roundTrip = local.toFormat(value.length > 16 ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyy-MM-dd'T'HH:mm");
    if (roundTrip !== value) {
        throw invalidLocalTime("That time does not exist in the clinic's time zone (daylight saving change).");
    }
    return local.toUTC().toJSDate();
}

// Start of a local calendar day (00:00 in the clinic's zone) as a UTC Date.
function localDateStartToUtc(value, zone) {
    if (!localDatePattern.test(value)) throw invalidLocalTime("Use the format YYYY-MM-DD.");
    const start = DateTime.fromISO(value, { zone }).startOf("day");
    if (!start.isValid) throw invalidLocalTime("That date is not valid.");
    return start.toUTC().toJSDate();
}

function nextLocalDateStartToUtc(value, zone) {
    if (!localDatePattern.test(value)) throw invalidLocalTime("Use the format YYYY-MM-DD.");
    const next = DateTime.fromISO(value, { zone }).startOf("day").plus({ days: 1 });
    if (!next.isValid) throw invalidLocalTime("That date is not valid.");
    return next.toUTC().toJSDate();
}

// Accepts either an absolute ISO instant with Z/offset, or a local wall-clock time in `zone`.
function instantToUtc(value, zone) {
    if (offsetDateTimePattern.test(value)) {
        const instant = DateTime.fromISO(value, { setZone: true });
        if (!instant.isValid) throw invalidLocalTime("That date or time is not valid.");
        return instant.toUTC().toJSDate();
    }
    return localDateTimeToUtc(value, zone);
}

function utcToLocalIso(date, zone) {
    return DateTime.fromJSDate(date, { zone: "utc" }).setZone(zone).toISO({ suppressMilliseconds: true });
}

module.exports = {
    parseHHMM,
    formatHHMM,
    localDateTimeToUtc,
    localDateStartToUtc,
    nextLocalDateStartToUtc,
    instantToUtc,
    utcToLocalIso,
    patterns: { hhmmPattern, localDateTimePattern, localDatePattern, offsetDateTimePattern },
};
