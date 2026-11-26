const prisma = require("../../config/database");
const { AppError, notFound } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const { assertAllInClinic, isUniqueViolation, isRecordNotFound } = require("../../lib/tenant-data");

const doctorRoles = new Set(["OWNER", "DOCTOR"]);

const doctorSelect = {
    id: true,
    memberId: true,
    displayNameEn: true,
    displayNameAr: true,
    titleEn: true,
    titleAr: true,
    bioEn: true,
    bioAr: true,
    yearsOfExperience: true,
    licenseNumber: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    specialties: {
        select: { specialty: { select: { id: true, nameEn: true, nameAr: true, isActive: true } } },
        orderBy: { specialtyId: "asc" },
    },
    services: {
        select: { service: { select: { id: true, nameEn: true, nameAr: true, durationMinutes: true, isActive: true } } },
        orderBy: { serviceId: "asc" },
    },
    member: { select: { status: true, trustState: true } },
};

// `bookable` mirrors what the booking engine enforces: an active profile on an ACTIVE, TRUSTED membership.
function present(doctor) {
    const { specialties, services, member, ...rest } = doctor;
    return {
        ...rest,
        memberTrustState: member.trustState,
        bookable: rest.isActive && member.status === "ACTIVE" && member.trustState === "TRUSTED",
        specialties: specialties.map(({ specialty }) => specialty),
        services: services.map(({ service }) => service),
    };
}

// Locks the doctor row for the rest of the transaction and proves it belongs to the clinic.
// Serialises concurrent edits of the same doctor's links and schedule.
async function lockDoctor(tx, clinicId, doctorId) {
    const rows = await tx.$queryRaw`
        SELECT id, member_id AS memberId FROM doctor_profiles WHERE id = ${doctorId} AND clinic_id = ${clinicId} FOR UPDATE
    `;
    if (rows.length === 0) throw notFound();
    return { id: rows[0].id, memberId: rows[0].memberId };
}

async function listDoctors(tenant, { includeInactive, specialtyId, serviceId, page, pageSize }) {
    const where = {
        clinicId: tenant.clinicId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(specialtyId ? { specialties: { some: { specialtyId } } } : {}),
        ...(serviceId ? { services: { some: { serviceId } } } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.doctorProfile.findMany({
            where,
            select: doctorSelect,
            orderBy: { displayNameEn: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.doctorProfile.count({ where }),
    ]);
    return { items: items.map(present), page, pageSize, total };
}

async function getDoctor(tenant, doctorId) {
    const doctor = await prisma.doctorProfile.findUnique({
        where: { clinicId_id: { clinicId: tenant.clinicId, id: doctorId } },
        select: doctorSelect,
    });
    if (!doctor) throw notFound();
    return present(doctor);
}

async function createDoctor(tenant, { input, ipAddress }) {
    const { memberId, specialtyIds, serviceIds, ...profile } = input;
    try {
        return await prisma.$transaction(async (tx) => {
            const member = await tx.clinicMember.findFirst({
                where: { id: memberId, clinicId: tenant.clinicId, status: "ACTIVE" },
                select: { id: true, role: true, trustState: true },
            });
            if (!member) {
                throw new AppError(400, "INVALID_MEMBER", "That person isn't an active member of this clinic.");
            }
            if (member.trustState !== "TRUSTED") {
                throw new AppError(400, "MEMBER_NOT_TRUSTED", "This member must re-confirm their access before getting a doctor profile.");
            }
            if (!doctorRoles.has(member.role)) {
                throw new AppError(400, "MEMBER_CANNOT_BE_DOCTOR", "Only owners and doctors can have a doctor profile.");
            }
            await assertAllInClinic(tx.specialty, tenant.clinicId, specialtyIds, "INVALID_SPECIALTY", "specialties");
            await assertAllInClinic(tx.service, tenant.clinicId, serviceIds, "INVALID_SERVICE", "services");

            const doctor = await tx.doctorProfile.create({
                data: { ...profile, clinicId: tenant.clinicId, memberId },
                select: { id: true },
            });
            if (specialtyIds.length > 0) {
                await tx.doctorSpecialty.createMany({
                    data: specialtyIds.map((specialtyId) => ({ clinicId: tenant.clinicId, doctorId: doctor.id, specialtyId })),
                });
            }
            if (serviceIds.length > 0) {
                await tx.doctorService.createMany({
                    data: serviceIds.map((serviceId) => ({ clinicId: tenant.clinicId, doctorId: doctor.id, serviceId })),
                });
            }
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action: "doctor.created",
                targetType: "doctor",
                targetId: doctor.id,
                metadata: { memberId, specialtyIds, serviceIds },
                ipAddress,
            });
            return present(await tx.doctorProfile.findUnique({ where: { id: doctor.id }, select: doctorSelect }));
        });
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new AppError(409, "DOCTOR_PROFILE_EXISTS", "This member already has a doctor profile.");
        }
        throw error;
    }
}

async function updateDoctor(tenant, doctorId, { input, ipAddress }) {
    try {
        return await prisma.$transaction(async (tx) => {
            const doctor = await tx.doctorProfile.update({
                where: { clinicId_id: { clinicId: tenant.clinicId, id: doctorId } },
                data: input,
                select: doctorSelect,
            });
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action: "doctor.updated",
                targetType: "doctor",
                targetId: doctorId,
                metadata: { fields: Object.keys(input) },
                ipAddress,
            });
            return present(doctor);
        });
    } catch (error) {
        if (isRecordNotFound(error)) throw notFound();
        throw error;
    }
}

// Replaces the full set of links in one transaction (idempotent PUT semantics).
function replaceLinks({ linkModel, targetModel, idField, code, label, action }) {
    return async function replace(tenant, doctorId, { ids, ipAddress }) {
        return prisma.$transaction(async (tx) => {
            await lockDoctor(tx, tenant.clinicId, doctorId);
            await assertAllInClinic(tx[targetModel], tenant.clinicId, ids, code, label);

            await tx[linkModel].deleteMany({ where: { clinicId: tenant.clinicId, doctorId } });
            if (ids.length > 0) {
                await tx[linkModel].createMany({
                    data: ids.map((id) => ({ clinicId: tenant.clinicId, doctorId, [idField]: id })),
                });
            }
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action,
                targetType: "doctor",
                targetId: doctorId,
                metadata: { [`${idField}s`]: ids },
                ipAddress,
            });
            return present(await tx.doctorProfile.findUnique({ where: { id: doctorId }, select: doctorSelect }));
        });
    };
}

const setDoctorSpecialties = replaceLinks({
    linkModel: "doctorSpecialty",
    targetModel: "specialty",
    idField: "specialtyId",
    code: "INVALID_SPECIALTY",
    label: "specialties",
    action: "doctor.specialties_updated",
});

const setDoctorServices = replaceLinks({
    linkModel: "doctorService",
    targetModel: "service",
    idField: "serviceId",
    code: "INVALID_SERVICE",
    label: "services",
    action: "doctor.services_updated",
});

module.exports = {
    lockDoctor,
    listDoctors,
    getDoctor,
    createDoctor,
    updateDoctor,
    setDoctorSpecialties,
    setDoctorServices,
};
