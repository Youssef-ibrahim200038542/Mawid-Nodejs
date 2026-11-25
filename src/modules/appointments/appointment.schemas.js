const { z } = require("zod");
const { patterns } = require("../../lib/time");
const { idSchema, optionalText } = require("../../lib/tenant-data");
const { patientFields, phone } = require("../patients/patient.schemas");

const dateTime = z
    .string()
    .refine(
        (value) => patterns.localDateTimePattern.test(value) || patterns.offsetDateTimePattern.test(value),
        "Use YYYY-MM-DDTHH:mm (clinic time) or an ISO time with an offset."
    );
const localDate = z.string().regex(patterns.localDatePattern, "Use the format YYYY-MM-DD.");
const optionalId = z.coerce.number().int().positive().max(2_147_483_647).optional();

const staffCreateSchema = z
    .strictObject({
        doctorId: idSchema,
        serviceId: idSchema,
        startsAt: dateTime,
        patientId: idSchema.optional(),
        patient: z.strictObject(patientFields).optional(),
        note: optionalText(500),
        status: z.enum(["PENDING", "CONFIRMED"]).optional(),
    })
    .refine((value) => Boolean(value.patientId) !== Boolean(value.patient), "Send either patientId or patient details, not both.");

const onlineBookingSchema = z.strictObject({
    doctorId: idSchema,
    serviceId: idSchema,
    startsAt: dateTime,
    phone,
    note: optionalText(500),
});

const rescheduleSchema = z.strictObject({ startsAt: dateTime, doctorId: idSchema.optional() });
const cancelSchema = z.strictObject({ reason: optionalText(255) });
const emptySchema = z.strictObject({});

// Defaults (today → +6 days) are applied in the service, in the clinic's own timezone.
const listAppointmentsQuery = z.strictObject({
    from: localDate.optional(),
    to: localDate.optional(),
    doctorId: optionalId,
    patientId: optionalId,
    status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const availabilityQuery = z.strictObject({
    serviceId: z.coerce.number().int().positive().max(2_147_483_647),
    doctorId: optionalId,
    from: localDate.optional(),
    to: localDate.optional(),
});

const myAppointmentsQuery = z.strictObject({
    scope: z.enum(["upcoming", "past"]).default("upcoming"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const publicClinicsQuery = z.strictObject({
    q: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

module.exports = {
    staffCreateSchema,
    onlineBookingSchema,
    rescheduleSchema,
    cancelSchema,
    emptySchema,
    listAppointmentsQuery,
    availabilityQuery,
    myAppointmentsQuery,
    publicClinicsQuery,
};
