const { z } = require("zod");
const { parseHHMM, patterns } = require("../../lib/time");
const { idSchema, optionalText } = require("../../lib/tenant-data");

const hhmm = z.string().regex(patterns.hhmmPattern, "Use 24-hour time like 09:00 (24:00 allowed as an end).");

const interval = z
    .strictObject({
        weekday: z.number().int().min(1).max(7),
        start: hhmm,
        end: hhmm,
    })
    .transform(({ weekday, start, end }) => ({ weekday, startMinute: parseHHMM(start), endMinute: parseHHMM(end) }))
    .refine((value) => value.startMinute < value.endMinute, "End time must be after start time (overnight shifts are not supported).");

// The full weekly schedule. A weekday with no intervals is closed. Breaks = gaps between intervals.
const weeklyHoursSchema = z
    .strictObject({ intervals: z.array(interval).max(70) })
    .superRefine(({ intervals }, ctx) => {
        const byDay = new Map();
        intervals.forEach((value, index) => {
            if (!byDay.has(value.weekday)) byDay.set(value.weekday, []);
            byDay.get(value.weekday).push({ ...value, index });
        });
        for (const dayIntervals of byDay.values()) {
            dayIntervals.sort((a, b) => a.startMinute - b.startMinute);
            for (let i = 1; i < dayIntervals.length; i += 1) {
                if (dayIntervals[i].startMinute < dayIntervals[i - 1].endMinute) {
                    ctx.addIssue({
                        code: "custom",
                        path: ["intervals", dayIntervals[i].index],
                        message: "Intervals on the same weekday must not overlap.",
                    });
                }
            }
            if (dayIntervals.length > 10) {
                ctx.addIssue({ code: "custom", path: ["intervals"], message: "At most 10 intervals per weekday." });
            }
        }
    });

const kind = z.enum(["HOLIDAY", "LEAVE", "UNAVAILABLE"]);
const localDate = z.string().regex(patterns.localDatePattern, "Use the format YYYY-MM-DD.");
const dateTime = z
    .string()
    .refine(
        (value) => patterns.localDateTimePattern.test(value) || patterns.offsetDateTimePattern.test(value),
        "Use YYYY-MM-DDTHH:mm (clinic time) or an ISO time with an offset."
    );

const common = {
    kind,
    reason: optionalText(255),
    // Omit or null for a clinic-wide exception.
    doctorId: idSchema.nullable().optional(),
};

// Either a range of whole days (inclusive, clinic time) or an exact period.
const createExceptionSchema = z.union([
    z.strictObject({ ...common, allDay: z.literal(true), startDate: localDate, endDate: localDate }),
    z.strictObject({ ...common, allDay: z.literal(false).optional(), startsAt: dateTime, endsAt: dateTime }),
]);

const listExceptionsQuery = z.strictObject({
    from: localDate.optional(),
    to: localDate.optional(),
    doctorId: z.coerce.number().int().positive().max(2_147_483_647).optional(),
});

module.exports = { weeklyHoursSchema, createExceptionSchema, listExceptionsQuery };
