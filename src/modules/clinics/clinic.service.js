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

const memberSelect = {
    id: true,
    role: true,
    status: true,
    createdAt: true,
    user: { select: { id: true, name: true, email: true } },
};

async function addMember(tenant, { input, ipAddress }) {
    const user = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (!user) {
        throw new AppError(404, "USER_NOT_FOUND", "No Mawid account uses that email. Ask them to sign up first.");
    }
    try {
        return await prisma.$transaction(async (tx) => {
            const member = await tx.clinicMember.create({
                data: { clinicId: tenant.clinicId, userId: user.id, role: input.role },
                select: memberSelect,
            });
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action: "member.added",
                targetType: "member",
                targetId: member.id,
                metadata: { userId: user.id, role: input.role },
                ipAddress,
            });
            return member;
        });
    } catch (error) {
        if (error && error.code === "P2002") {
            throw new AppError(409, "MEMBER_EXISTS", "That person is already a member of this clinic.");
        }
        throw error;
    }
}

// Guards: nobody changes their own role/status (prevents accidental lock-out), the last
// active owner can't be demoted or disabled, and someone with a doctor profile must stay
// an OWNER or DOCTOR.
async function updateMember(tenant, memberId, { input, ipAddress }) {
    if (memberId === tenant.memberId) {
        throw new AppError(403, "CANNOT_CHANGE_SELF", "You can't change your own role or status.");
    }
    return prisma.$transaction(async (tx) => {
        // Serialise membership changes per clinic so two owners can't demote each other at once.
        await tx.$queryRaw`SELECT id FROM clinics WHERE id = ${tenant.clinicId} FOR UPDATE`;
        const current = await tx.clinicMember.findFirst({
            where: { id: memberId, clinicId: tenant.clinicId },
            select: { id: true, role: true, status: true, doctorProfile: { select: { id: true } } },
        });
        if (!current) throw notFound();

        const nextRole = input.role ?? current.role;
        const nextStatus = input.status ?? current.status;
        const losesOwnership = current.role === "OWNER" && current.status === "ACTIVE" && (nextRole !== "OWNER" || nextStatus !== "ACTIVE");
        if (losesOwnership) {
            const otherOwners = await tx.clinicMember.count({
                where: { clinicId: tenant.clinicId, role: "OWNER", status: "ACTIVE", id: { not: memberId } },
            });
            if (otherOwners === 0) throw new AppError(409, "LAST_OWNER", "A clinic must keep at least one active owner.");
        }
        if (current.doctorProfile && nextRole === "RECEPTIONIST") {
            throw new AppError(409, "MEMBER_HAS_DOCTOR_PROFILE", "This member has a doctor profile, so they must stay an owner or doctor.");
        }

        const member = await tx.clinicMember.update({ where: { id: memberId }, data: input, select: memberSelect });
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: tenant.clinicId,
            action: "member.updated",
            targetType: "member",
            targetId: memberId,
            metadata: { from: { role: current.role, status: current.status }, to: { role: nextRole, status: nextStatus } },
            ipAddress,
        });
        return member;
    });
}

module.exports.addMember = addMember;
module.exports.updateMember = updateMember;
