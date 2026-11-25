const prisma = require("../../config/database");
const { AppError, notFound } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");

const clinicSelect = {
    id: true,
    slug: true,
    name: true,
    timezone: true,
    defaultLocale: true,
    status: true,
    phone: true,
    email: true,
    address: true,
    city: true,
    createdAt: true,
};

const maxClinicsListed = 100;

// Any logged-in user may open a clinic; they become its OWNER in the same transaction.
async function createClinic({ actorUserId, ipAddress, input }) {
    try {
        return await prisma.$transaction(async (tx) => {
            const clinic = await tx.clinic.create({ data: input, select: clinicSelect });
            await tx.clinicMember.create({
                data: { clinicId: clinic.id, userId: actorUserId, role: "OWNER" },
            });
            await recordAudit(tx, {
                actorUserId,
                clinicId: clinic.id,
                action: "clinic.created",
                targetType: "clinic",
                targetId: clinic.id,
                ipAddress,
            });
            return clinic;
        });
    } catch (error) {
        if (error && error.code === "P2002") {
            throw new AppError(409, "CLINIC_SLUG_TAKEN", "That clinic address is already taken.");
        }
        throw error;
    }
}

async function listClinicsForUser(userId) {
    const memberships = await prisma.clinicMember.findMany({
        where: { userId, status: "ACTIVE", clinic: { status: "ACTIVE" } },
        select: { role: true, clinic: { select: { id: true, slug: true, name: true, timezone: true, defaultLocale: true } } },
        orderBy: { createdAt: "asc" },
        take: maxClinicsListed,
    });
    return memberships.map(({ role, clinic }) => ({ ...clinic, role }));
}

// Every tenant query filters by tenant.clinicId, which comes from loadTenant, never the request.
async function getClinic(tenant) {
    const clinic = await prisma.clinic.findUnique({ where: { id: tenant.clinicId }, select: clinicSelect });
    if (!clinic) throw notFound();
    return clinic;
}

async function updateClinic(tenant, { ipAddress, input }) {
    return prisma.$transaction(async (tx) => {
        const clinic = await tx.clinic.update({
            where: { id: tenant.clinicId },
            data: input,
            select: clinicSelect,
        });
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: tenant.clinicId,
            action: "clinic.updated",
            targetType: "clinic",
            targetId: tenant.clinicId,
            metadata: { fields: Object.keys(input) },
            ipAddress,
        });
        return clinic;
    });
}

async function listMembers(tenant, { page, pageSize }) {
    const where = { clinicId: tenant.clinicId };
    const [items, total] = await Promise.all([
        prisma.clinicMember.findMany({
            where,
            select: {
                id: true,
                role: true,
                status: true,
                createdAt: true,
                user: { select: { id: true, name: true, email: true } },
            },
            orderBy: { id: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.clinicMember.count({ where }),
    ]);
    return { items, page, pageSize, total };
}

module.exports = { createClinic, listClinicsForUser, getClinic, updateClinic, listMembers };
