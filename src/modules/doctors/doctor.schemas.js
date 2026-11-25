const { z } = require("zod");
const { optionalText, requiredText, idSchema, idListSchema, includeInactiveQuery } = require("../../lib/tenant-data");

const profileFields = {
    displayNameEn: requiredText(2, 150),
    displayNameAr: optionalText(150),
    titleEn: optionalText(100),
    titleAr: optionalText(100),
    bioEn: optionalText(4000),
    bioAr: optionalText(4000),
    yearsOfExperience: z.number().int().min(0).max(80).nullable().optional(),
    licenseNumber: optionalText(64),
};

// memberId is the clinic membership (not the user id) of an OWNER or DOCTOR in this clinic.
const createDoctorSchema = z.strictObject({
    memberId: idSchema,
    ...profileFields,
    specialtyIds: idListSchema.default([]),
    serviceIds: idListSchema.default([]),
});

const updateDoctorSchema = z
    .strictObject({
        displayNameEn: profileFields.displayNameEn.optional(),
        displayNameAr: profileFields.displayNameAr,
        titleEn: profileFields.titleEn,
        titleAr: profileFields.titleAr,
        bioEn: profileFields.bioEn,
        bioAr: profileFields.bioAr,
        yearsOfExperience: profileFields.yearsOfExperience,
        licenseNumber: profileFields.licenseNumber,
        isActive: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");

const setSpecialtiesSchema = z.strictObject({ specialtyIds: idListSchema });
const setServicesSchema = z.strictObject({ serviceIds: idListSchema });

const listDoctorsQuery = z.strictObject({
    includeInactive: includeInactiveQuery,
    specialtyId: z.coerce.number().int().positive().max(2_147_483_647).optional(),
    serviceId: z.coerce.number().int().positive().max(2_147_483_647).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

module.exports = { createDoctorSchema, updateDoctorSchema, setSpecialtiesSchema, setServicesSchema, listDoctorsQuery };
