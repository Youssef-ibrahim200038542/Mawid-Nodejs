const prisma = require("../../config/database");
const { notFound, AppError } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const { isRecordNotFound, isUniqueViolation } = require("../../lib/tenant-data");
const { appointmentSelect, presentAppointment } = require("../appointments/appointment.presenter");

const patientSelect = { id: true, fullName: true, phone: true, email: true, userId: true, createdAt: true, updatedAt: true };

function present(row) {
    const { userId, ...rest } = row;
    return { ...rest, hasAccount: userId !== null };
}

async function listPatients(tenant, { q, page, pageSize }) {
    const where = {
        clinicId: tenant.clinicId,
        ...(q ? { OR: [{ fullName: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] } : {}),
    };
    const [rows, total] = await Promise.all([
        prisma.patient.findMany({ where, select: patientSelect, orderBy: [{ fullName: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
        prisma.patient.count({ where }),
    ]);
    return { items: rows.map(present), page, pageSize, total };
}

async function getPatient(tenant, patientId) {
    const row = await prisma.patient.findUnique({ where: { clinicId_id: { clinicId: tenant.clinicId, id: patientId } }, select: patientSelect });
    if (!row) throw notFound();
    const appointments = await prisma.appointment.findMany({
        where: { clinicId: tenant.clinicId, patientId },
        select: appointmentSelect,
        orderBy: { startsAt: "desc" },
        take: 20,
    });
    return { ...present(row), recentAppointments: appointments.map((a) => presentAppointment(a, tenant.timezone, { includePatient: false })) };
}

async function createPatient(tenant, { input, ipAddress }) {
    return prisma.$transaction(async (tx) => {
        const row = await tx.patient.create({ data: { ...input, clinicId: tenant.clinicId }, select: patientSelect });
        await recordAudit(tx, { actorUserId: tenant.userId, clinicId: tenant.clinicId, action: "patient.created", targetType: "patient", targetId: row.id, ipAddress });
        return present(row);
    });
}

async function updatePatient(tenant, patientId, { input, ipAddress }) {
    try {
        return await prisma.$transaction(async (tx) => {
            const row = await tx.patient.update({ where: { clinicId_id: { clinicId: tenant.clinicId, id: patientId } }, data: input, select: patientSelect });
            await recordAudit(tx, {
                actorUserId: tenant.userId,
                clinicId: tenant.clinicId,
                action: "patient.updated",
                targetType: "patient",
                targetId: patientId,
                metadata: { fields: Object.keys(input) },
                ipAddress,
            });
            return present(row);
        });
    } catch (error) {
        if (isRecordNotFound(error)) throw notFound();
        throw error;
    }
}

// The clinic-scoped patient record for a platform user booking online (created on first booking).
async function ensurePatientForUser(clinicId, user, phone) {
    const where = { clinicId_userId: { clinicId, userId: user.id } };
    try {
        return await prisma.patient.upsert({
            where,
            create: { clinicId, userId: user.id, fullName: user.name, email: user.email, phone: phone ?? null },
            update: phone ? { phone } : {},
            select: { id: true },
        });
    } catch (error) {
        if (isUniqueViolation(error)) {
            const existing = await prisma.patient.findUnique({ where, select: { id: true } });
            if (existing) return existing;
        }
        throw error instanceof AppError ? error : error;
    }
}

module.exports = { listPatients, getPatient, createPatient, updatePatient, ensurePatientForUser };
