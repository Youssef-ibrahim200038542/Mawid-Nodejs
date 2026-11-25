// Shared helpers for tenant-owned data.
const { z } = require("zod");
const { AppError, notFound } = require("./errors");

const maxId = 2_147_483_647;

// Route params like :doctorId. Anything that is not a positive 32-bit integer is a 404.
function parseIdParam(value) {
    if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) throw notFound();
    const id = Number(value);
    if (id > maxId) throw notFound();
    return id;
}

const idSchema = z.number().int().positive().max(maxId);
const idListSchema = z
    .array(idSchema)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, "Each id may appear only once.");

// Throws 400 unless every id exists in this clinic. `delegate` is e.g. tx.specialty.
async function assertAllInClinic(delegate, clinicId, ids, code, label) {
    if (ids.length === 0) return;
    const found = await delegate.count({ where: { clinicId, id: { in: ids } } });
    if (found !== ids.length) {
        throw new AppError(400, code, `One or more ${label} don't belong to this clinic.`);
    }
}

function isUniqueViolation(error) {
    return Boolean(error && error.code === "P2002");
}

function isRecordNotFound(error) {
    return Boolean(error && error.code === "P2025");
}

// Bilingual text helpers: English is required by default, Arabic optional.
const optionalText = (max) =>
    z
        .string()
        .trim()
        .max(max)
        .transform((value) => (value === "" ? null : value))
        .nullable()
        .optional();

const requiredText = (min, max) => z.string().trim().min(min).max(max);

const includeInactiveQuery = z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true");

module.exports = {
    parseIdParam,
    idSchema,
    idListSchema,
    assertAllInClinic,
    isUniqueViolation,
    isRecordNotFound,
    optionalText,
    requiredText,
    includeInactiveQuery,
};
