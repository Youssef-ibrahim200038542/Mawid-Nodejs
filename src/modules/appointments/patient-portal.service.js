// Patient-facing booking: a logged-in platform user books, lists, cancels and reschedules
// their own appointments. Ownership = the appointment's patient record links to this user.
const prisma = require("../../config/database");
const { AppError, notFound, unauthenticated } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const time = require("../../lib/time");
const policy = require("./booking-policy");
const engine = require("./booking-engine");
const { assertTransition } = require("./appointment-status");
const { appointmentSelect, presentAppointment } = require("./appointment.presenter");
const { rescheduleAppointment } = require("./appointment.service");
const { ensurePatientForUser } = require("../patients/patient.service");
const { resolvePublicClinic } = require("./public.service");

async function loadUser(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
    if (!user) throw unauthenticated();
    return user;
}

async function bookOnline(userId, clinicSlug, { input, ipAddress, now = new Date() }) {
    const clinic = await resolvePublicClinic(clinicSlug);
    const user = await loadUser(userId);
    const startsAt = time.instantToUtc(input.startsAt, clinic.timezone);
    const patient = await ensurePatientForUser(clinic.id, user, input.phone);

    const row = await engine.runBookingTransaction(async (tx) => {
        const doctors = await engine.lockDoctors(tx, clinic.id, [input.doctorId]);
        await engine.lockPatient(tx, clinic.id, patient.id);
        await engine.assertPatientBookingLimit(tx, clinic.id, patient.id, now);
        const { service, endsAt } = await engine.validateBooking(tx, {
            clinic,
            doctor: doctors.get(input.doctorId),
            serviceId: input.serviceId,
            startsAt,
            patientId: patient.id,
            online: true,
            now,
        });
        const created = await tx.appointment.create({
            data: {
                clinicId: clinic.id,
                doctorId: input.doctorId,
                serviceId: service.id,
                patientId: patient.id,
                startsAt,
                endsAt,
                status: "PENDING",
                source: "ONLINE",
                durationMinutes: service.durationMinutes,
                priceMinor: service.priceMinor,
                currency: service.currency,
                note: input.note ?? null,
                createdByUserId: user.id,
            },
            select: appointmentSelect,
        });
        await recordAudit(tx, {
            actorUserId: user.id,
            clinicId: clinic.id,
            action: "appointment.created",
            targetType: "appointment",
            targetId: created.id,
            metadata: { doctorId: input.doctorId, serviceId: service.id, patientId: patient.id, startsAt: startsAt.toISOString(), source: "ONLINE" },
            ipAddress,
        });
        return created;
    });
    return presentAppointment(row, clinic.timezone, { clinic: { slug: clinic.slug, name: clinic.name } });
}

const clinicSummary = { select: { slug: true, name: true, timezone: true } };

async function listMyAppointments(userId, { scope, page, pageSize, now = new Date() }) {
    const mine = { patient: { userId } };
    const where =
        scope === "upcoming"
            ? { ...mine, status: { in: policy.activeStatuses }, endsAt: { gte: now } }
            : { ...mine, OR: [{ endsAt: { lt: now } }, { status: { notIn: policy.activeStatuses } }] };
    const [rows, total] = await Promise.all([
        prisma.appointment.findMany({
            where,
            select: { ...appointmentSelect, clinic: clinicSummary },
            orderBy: [{ startsAt: scope === "upcoming" ? "asc" : "desc" }, { id: "asc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.appointment.count({ where }),
    ]);
    return {
        items: rows.map(({ clinic, ...row }) => presentAppointment(row, clinic.timezone, { includePatient: false, clinic: { slug: clinic.slug, name: clinic.name } })),
        page,
        pageSize,
        total,
    };
}

function assertChangeWindow(appointment, now) {
    if (appointment.startsAt.getTime() - now.getTime() < policy.patientChangeMinHours * 3_600_000) {
        throw new AppError(409, "CHANGE_TOO_LATE", `Online changes close ${policy.patientChangeMinHours} hours before the appointment. Please call the clinic.`);
    }
}

async function findMine(db, userId, appointmentId) {
    const row = await db.appointment.findFirst({
        where: { id: appointmentId, patient: { userId } },
        select: { ...appointmentSelect, clinic: { select: { id: true, slug: true, name: true, timezone: true, status: true } } },
    });
    // Someone else's appointment looks exactly like a missing one.
    if (!row) throw notFound();
    return row;
}

async function cancelMine(userId, appointmentId, { reason, ipAddress, now = new Date() }) {
    const row = await engine.runBookingTransaction(async (tx) => {
        const current = await findMine(tx, userId, appointmentId);
        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE`;
        const fresh = await findMine(tx, userId, appointmentId);
        assertTransition("cancel", fresh, now);
        assertChangeWindow(fresh, now);
        const updated = await tx.appointment.update({
            where: { id: appointmentId },
            data: { status: "CANCELLED", cancelledAt: now, cancelledByUserId: userId, cancellationReason: reason ?? null },
            select: appointmentSelect,
        });
        await recordAudit(tx, {
            actorUserId: userId,
            clinicId: current.clinic.id,
            action: "appointment.cancelled",
            targetType: "appointment",
            targetId: appointmentId,
            metadata: { from: fresh.status, to: "CANCELLED", by: "patient" },
            ipAddress,
        });
        return { updated, clinic: current.clinic };
    });
    return presentAppointment(row.updated, row.clinic.timezone, { includePatient: false, clinic: { slug: row.clinic.slug, name: row.clinic.name } });
}

async function rescheduleMine(userId, appointmentId, { input, ipAddress, now = new Date() }) {
    const current = await findMine(prisma, userId, appointmentId);
    if (current.clinic.status !== "ACTIVE") throw notFound();
    const clinic = { id: current.clinic.id, timezone: current.clinic.timezone };
    const row = await rescheduleAppointment({
        clinic,
        appointmentId,
        startsAtInput: input.startsAt,
        doctorId: input.doctorId,
        actorUserId: userId,
        online: true,
        scope: { patient: { userId } },
        resetToPending: true,
        ipAddress,
        now,
        authorize: async (appointment) => assertChangeWindow(appointment, now),
    });
    return presentAppointment(row, clinic.timezone, { includePatient: false, clinic: { slug: current.clinic.slug, name: current.clinic.name } });
}

module.exports = { bookOnline, listMyAppointments, cancelMine, rescheduleMine };
