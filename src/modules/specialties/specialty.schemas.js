const { z } = require("zod");
const { optionalText, requiredText, includeInactiveQuery } = require("../../lib/tenant-data");

const createSpecialtySchema = z.strictObject({
    nameEn: requiredText(2, 100),
    nameAr: optionalText(100),
});

const updateSpecialtySchema = z
    .strictObject({
        nameEn: requiredText(2, 100).optional(),
        nameAr: optionalText(100),
        isActive: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");

const listSpecialtiesQuery = z.strictObject({ includeInactive: includeInactiveQuery });

module.exports = { createSpecialtySchema, updateSpecialtySchema, listSpecialtiesQuery };
