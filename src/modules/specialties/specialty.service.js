const prisma = require("../../config/database");
const { AppError, notFound } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const { isUniqueViolation, isRecordNotFound } = require("../../lib/tenant-data");

const specialtySelect = { id: true, nameEn: true, nameAr: true, isActive: true, createdAt: true, updatedAt: true };
// A clinic has a handful of specialties; the cap keeps the query bounded.
const maxListed = 500;

const nameTaken = () => new AppError(409, "SPECIALTY_NAME_TAKEN", "This clinic already has a specialty with that name.");

async function listSpecialties(tenant, { includeInactive }) {
    return prisma.specialty.findMany({
        where: { clinicId: tenant.clinicId, ...(includeInactive ? {} : { isActive: true }) },
        select: specialtySelect,
        orderBy: { nameEn: "asc" },
        take: maxListed,
    });
}

async function createSpecialty(tenant, { input, ipAddress }) {
    try {
        return await prisma.$transaction(async (tx) => {
            const specialty = await tx.specialty.create({
                data: { ...input, clinicId: tenant.clinicId },
                select: specialtySelect,
            });
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action: "specialty.created",
                targetType: "specialty",
                targetId: specialty.id,
                ipAddress,
            });
            return specialty;
        });
    } catch (error) {
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
    }
}

async function updateSpecialty(tenant, specialtyId, { input, ipAddress }) {
    try {
        return await prisma.$transaction(async (tx) => {
            // Compound unique (clinicId, id): a specialty id from another clinic simply isn't found.
            const specialty = await tx.specialty.update({
                where: { clinicId_id: { clinicId: tenant.clinicId, id: specialtyId } },
                data: input,
                select: specialtySelect,
            });
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action: "specialty.updated",
                targetType: "specialty",
                targetId: specialtyId,
                metadata: { fields: Object.keys(input) },
                ipAddress,
            });
            return specialty;
        });
    } catch (error) {
        if (isRecordNotFound(error)) throw notFound();
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
    }
}

module.exports = { listSpecialties, createSpecialty, updateSpecialty };
