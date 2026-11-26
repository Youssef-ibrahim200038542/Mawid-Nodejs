const prisma = require("../../config/database");
const { AppError, notFound } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const trust = require("../membership/membership-trust.service");

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

// Any logged-in user with a VERIFIED email may open a clinic; they become its TRUSTED OWNER
// (trust source CLINIC_CREATOR) in the same transaction.
async function createClinic({ actorUserId, ipAddress, input }) {
    try {
        return await prisma.$transaction(async (tx) => {
            const now = new Date();
            const users = await tx.$queryRaw`SELECT id, email_verified_at AS emailVerifiedAt FROM users WHERE id = ${actorUserId} FOR UPDATE`;
            if (users.length === 0) throw new AppError(401, "UNAUTHENTICATED", "Log in to continue.");
            if (!users[0].emailVerifiedAt) {
                throw new AppError(403, "EMAIL_NOT_VERIFIED", "Confirm your email address before opening a clinic.");
            }
            const clinic = await tx.clinic.create({ data: input, select: clinicSelect });
            await trust.createCreatorMembership(tx, { clinicId: clinic.id, userId: actorUserId, userEmailVerified: true, now });
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
        select: {
            id: true,
            role: true,
            trustState: true,
            doctorProfile: { select: { id: true } },
            clinic: { select: { id: true, slug: true, name: true, timezone: true, defaultLocale: true } },
        },
        orderBy: { createdAt: "asc" },
        take: maxClinicsListed,
    });
    // memberId / doctorProfileId let the UI find "my own" doctor schedule; they are the caller's
    // own ids, and the server still enforces ownership on every request. trustState tells the UI
    // whether the workspace can open (loadTenant enforces it).
    return memberships.map(({ id, role, trustState, doctorProfile, clinic }) => ({
        ...clinic,
        role,
        trustState,
        memberId: id,
        doctorProfileId: doctorProfile ? doctorProfile.id : null,
    }));
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
            select: memberSelect,
            orderBy: { id: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.clinicMember.count({ where }),
    ]);
    // Open re-confirmation requests for the listed legacy members.
    const legacyIds = items.filter((m) => m.trustState === "LEGACY_UNREVIEWED").map((m) => m.id);
    const pending = legacyIds.length
        ? await prisma.clinicInvitation.findMany({
            where: { clinicId: tenant.clinicId, kind: "RECONFIRM", status: "PENDING", memberId: { in: legacyIds } },
            select: { id: true, memberId: true, expiresAt: true },
        })
        : [];
    const byMember = new Map(pending.map((p) => [p.memberId, p]));
    return {
        items: items.map((m) => ({
            ...m,
            pendingReconfirmation: byMember.has(m.id) ? { invitationId: byMember.get(m.id).id, expiresAt: byMember.get(m.id).expiresAt.toISOString() } : null,
        })),
        page,
        pageSize,
        total,
    };
}

module.exports = { createClinic, listClinicsForUser, getClinic, updateClinic, listMembers };

const memberSelect = {
    id: true,
    role: true,
    status: true,
    trustState: true,
    trustSource: true,
    trustedAt: true,
    createdAt: true,
    user: { select: { id: true, name: true, email: true } },
};

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
            select: { id: true, role: true, status: true, trustState: true, doctorProfile: { select: { id: true } } },
        });
        if (!current) throw notFound();

        const nextRole = input.role ?? current.role;
        const nextStatus = input.status ?? current.status;
        const losesOwnership =
            current.role === "OWNER" && current.status === "ACTIVE" && current.trustState === "TRUSTED" && (nextRole !== "OWNER" || nextStatus !== "ACTIVE");
        if (losesOwnership) {
            // Only trusted owners can run the clinic, so only they count towards "keep one owner".
            const otherOwners = await tx.clinicMember.count({
                where: { clinicId: tenant.clinicId, role: "OWNER", status: "ACTIVE", trustState: "TRUSTED", id: { not: memberId } },
            });
            if (otherOwners === 0) throw new AppError(409, "LAST_OWNER", "A clinic must keep at least one active owner.");
        }
        if (current.doctorProfile && nextRole === "RECEPTIONIST") {
            throw new AppError(409, "MEMBER_HAS_DOCTOR_PROFILE", "This member has a doctor profile, so they must stay an owner or doctor.");
        }

        const member = await tx.clinicMember.update({ where: { id: memberId }, data: { role: input.role, status: input.status }, select: memberSelect });
        const legacyDisabled = current.trustState === "LEGACY_UNREVIEWED" && current.status === "ACTIVE" && nextStatus === "DISABLED";
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: tenant.clinicId,
            action: legacyDisabled ? "member.legacy_disabled" : "member.updated",
            targetType: "member",
            targetId: memberId,
            metadata: { from: { role: current.role, status: current.status }, to: { role: nextRole, status: nextStatus } },
            ipAddress,
        });
        return member;
    });
}

module.exports.updateMember = updateMember;
