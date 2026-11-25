// "Services" here are the clinic's bookable offerings (consultation, cleaning, …).
const prisma = require("../../config/database");
const { AppError, notFound } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const { isUniqueViolation, isRecordNotFound } = require("../../lib/tenant-data");
const { toServiceData } = require("./clinic-service.schemas");

const serviceSelect = {
    id: true,
    nameEn: true,
    nameAr: true,
    descriptionEn: true,
    descriptionAr: true,
    durationMinutes: true,
    priceMinor: true,
    currency: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
};
const maxListed = 500;

const nameTaken = () => new AppError(409, "SERVICE_NAME_TAKEN", "This clinic already has a service with that name.");

function present(service) {
    if (!service) return service;
    const { doctors, ...rest } = service;
    const result = { ...rest, price: (service.priceMinor / 100).toFixed(2) };
    if (doctors) {
        result.doctors = doctors.map(({ doctor }) => doctor);
    }
    return result;
}

async function listServices(tenant, { includeInactive }) {
    const services = await prisma.service.findMany({
        where: { clinicId: tenant.clinicId, ...(includeInactive ? {} : { isActive: true }) },
        select: serviceSelect,
        orderBy: { nameEn: "asc" },
        take: maxListed,
    });
    return services.map(present);
}

async function getService(tenant, serviceId) {
    const service = await prisma.service.findUnique({
        where: { clinicId_id: { clinicId: tenant.clinicId, id: serviceId } },
        select: {
            ...serviceSelect,
            doctors: {
                select: { doctor: { select: { id: true, displayNameEn: true, displayNameAr: true, isActive: true } } },
                orderBy: { doctorId: "asc" },
            },
        },
    });
    if (!service) throw notFound();
    return present(service);
}

async function createService(tenant, { input, ipAddress }) {
    try {
        return await prisma.$transaction(async (tx) => {
            const service = await tx.service.create({
                data: { ...toServiceData(input), clinicId: tenant.clinicId },
                select: serviceSelect,
            });
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action: "service.created",
                targetType: "service",
                targetId: service.id,
                ipAddress,
            });
            return present(service);
        });
    } catch (error) {
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
    }
}

async function updateService(tenant, serviceId, { input, ipAddress }) {
    try {
        return await prisma.$transaction(async (tx) => {
            const service = await tx.service.update({
                where: { clinicId_id: { clinicId: tenant.clinicId, id: serviceId } },
                data: toServiceData(input),
                select: serviceSelect,
            });
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action: "service.updated",
                targetType: "service",
                targetId: serviceId,
                metadata: { fields: Object.keys(input) },
                ipAddress,
            });
            return present(service);
        });
    } catch (error) {
        if (isRecordNotFound(error)) throw notFound();
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
    }
}

module.exports = { listServices, getService, createService, updateService };
