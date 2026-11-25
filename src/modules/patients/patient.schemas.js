const { z } = require("zod");
const { requiredText } = require("../../lib/tenant-data");

const phone = z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,30}$/, "Enter a valid phone number.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null));

const email = z
    .union([z.literal(""), z.email().max(255)])
    .transform((value) => (value === "" ? null : value.toLowerCase()))
    .nullable()
    .optional();

// Basic contact details only — Mawid v1 stores no medical information.
const patientFields = { fullName: requiredText(2, 150), phone, email };

const createPatientSchema = z.strictObject(patientFields);

const updatePatientSchema = z
    .strictObject({ fullName: patientFields.fullName.optional(), phone, email })
    .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");

const listPatientsQuery = z.strictObject({
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

module.exports = { createPatientSchema, updatePatientSchema, listPatientsQuery, patientFields, phone };
