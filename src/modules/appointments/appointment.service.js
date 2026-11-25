// Staff-side appointment management inside one clinic (tenant).
const { DateTime } = require("luxon");
const prisma = require("../../config/database");
const { AppError, notFound, forbidden } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const { hasPermission } = require("../../lib/permissions");
const time = require("../../lib/time");
const policy = require("./booking-policy");
const engine = require("./booking-engine");
const { assertTransition } = require("./appointment-status");
const { appointmentSelect, presentAppointment } = require("./appointment.presenter");
const { notifyAppointmentEvent, scheduleEmailDelivery } = require("../notifications/notification.service");

const maxListRangeDays = 92;

function clinicOf(tenant) {
    return { id: tenant.clinicId, timezone: tenant.timezone };
}

// The doctor profile of the caller in this clinic, if any.
async function ownDoctorId(tenant) {
    const profile = await prisma.doctorProfile.findUnique({ where: { memberId: tenant.memberId }, select: { id: true, clinicId: true } });
    return profile && profile.clinicId === tenant.clinicId ? profile.id : null;
}

// Owners/receptionists see everything; doctors only their own appointments.
async function readScope(tenant) {
    if (hasPermission(tenant.role, "appointments:read")) return {};
    if (hasPermission(tenant.role, "appointments:read_own")) {
        const doctorId = await ownDoctorId(tenant);
        return { doctorId: doctorId ?? -1 };
    }
    throw forbidden();
}

async function listAppointments(tenant, { from: fromInput, to: toInput, doctorId, status, patientId, page, pageSize }) {
    const zone = tenant.timezone;
    const from = fromInput || DateTime.now().setZone(zone).toISODate();
    const to = toInput || DateTime.fromISO(from, { zone }).plus({ days: 6 }).toISODate();
    const rangeStart = time.localDateStartToUtc(from, zone);
    const rangeEnd = time.nextLocalDateStartToUtc(to, zone);
    if (rangeStart >= rangeEnd || rangeEnd - rangeStart > (maxListRangeDays + 1) * 86_400_000) {
        throw new AppError(400, "INVALID_PERIOD", `Choose a range of at most ${maxListRangeDays} days.`);
    }
    const scope = await readScope(tenant);
    if (scope.doctorId !== undefined && doctorId && doctorId !== scope.doctorId) {
        return { items: [], page, pageSize, total: 0 };
    }
    const where = {
        clinicId: tenant.clinicId,
        startsAt: { gte: rangeStart, lt: rangeEnd },
        ...(doctorId ? { doctorId } : {}),
        ...(status ? { status } : {}),
        ...(patientId ? { patientId } : {}),
        ...scope,
    };
    const [rows, total] = await Promise.all([
        prisma.appointment.findMany({ where, select: appointmentSelect, orderBy: [{ startsAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
        prisma.appointment.count({ where }),
    ]);
    return { items: rows.map((row) => presentAppointment(row, zone)), page, pageSize, total };
}

async function findScoped(db, tenant, appointmentId, scope) {
    const row = await db.appointment.findFirst({ where: { id: appointmentId, clinicId: tenant.clinicId, ...scope }, select: appointmentSelect });
    if (!row) throw notFound();
    return row;
}

async function getAppointment(tenant, appointmentId) {
    return presentAppointment(await findScoped(prisma, tenant, appointmentId, await readScope(tenant)), tenant.timezone);
}

async function resolveStaffPatient(tx, tenant, input, ipAddress) {
    if (input.patientId) return input.patientId;
    const patient = await tx.patient.create({ data: { ...input.patient, clinicId: tenant.clinicId }, select: { id: true } });
    await recordAudit(tx, {
        actorUserId: tenant.userId,
        clinicId: tenant.clinicId,
        action: "patient.created",
        targetType: "patient",
        targetId: patient.id,
        ipAddress,
    });
    return patient.id;
}

async function createStaffAppointment(tenant, { input, ipAddress, now = new Date() }) {
    const clinic = clinicOf(tenant);
    const startsAt = time.instantToUtc(input.startsAt, clinic.timezone);

    const row = await engine.runBookingTransaction(async (tx) => {
        const doctors = await engine.lockDoctors(tx, clinic.id, [input.doctorId]);
        const patientId = await resolveStaffPatient(tx, tenant, input, ipAddress);
        await engine.lockPatient(tx, clinic.id, patientId);
        const { service, endsAt } = await engine.validateBooking(tx, {
            clinic,
            doctor: doctors.get(input.doctorId),
            serviceId: input.serviceId,
            startsAt,
            patientId,
            online: false,
            now,
        });
        const status = input.status === "PENDING" ? "PENDING" : "CONFIRMED";
        const created = await tx.appointment.create({
            data: {
                clinicId: clinic.id,
                doctorId: input.doctorId,
                serviceId: service.id,
                patientId,
                startsAt,
                endsAt,
                status,
                source: "STAFF",
                durationMinutes: service.durationMinutes,
                priceMinor: service.priceMinor,
                currency: service.currency,
                note: input.note ?? null,
                createdByUserId: tenant.userId,
                confirmedAt: status === "CONFIRMED" ? now : null,
            },
            select: appointmentSelect,
        });
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: clinic.id,
            action: "appointment.created",
            targetType: "appointment",
            targetId: created.id,
            metadata: { doctorId: input.doctorId, serviceId: service.id, patientId, startsAt: startsAt.toISOString(), source: "STAFF" },
            ipAddress,
        });
        await notifyAppointmentEvent(tx, { appointmentId: created.id, event: "booked", actor: "staff", actorUserId: tenant.userId });
        return created;
    });
    scheduleEmailDelivery();
    return presentAppointment(row, clinic.timezone);
}

const ownStatusActions = new Set(["confirm", "complete", "no_show"]);

async function assertCanChange(tenant, row, action) {
    if (hasPermission(tenant.role, "appointments:manage")) return;
    if (hasPermission(tenant.role, "appointments:update_own") && ownStatusActions.has(action)) {
        if (row.doctorId === (await ownDoctorId(tenant))) return;
    }
    throw forbidden();
}

async function changeStatus(tenant, appointmentId, action, { reason = null, ipAddress, now = new Date() }) {
    const row = await engine.runBookingTransaction(async (tx) => {
        // Lock the appointment row so two staff can't apply conflicting transitions at once.
        const locked = await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} AND clinic_id = ${tenant.clinicId} FOR UPDATE`;
        if (locked.length === 0) throw notFound();
        const current = await findScoped(tx, tenant, appointmentId, {});
        // Doctors may only see their own appointments: hide others as 404, not 403.
        const scope = await readScope(tenant);
        if (scope.doctorId !== undefined && current.doctorId !== scope.doctorId) throw notFound();
        await assertCanChange(tenant, current, action);

        const status = assertTransition(action, current, now);
        const data = { status };
        if (status === "CONFIRMED") data.confirmedAt = now;
        if (status === "CANCELLED") Object.assign(data, { cancelledAt: now, cancelledByUserId: tenant.userId, cancellationReason: reason });

        const updated = await tx.appointment.update({ where: { id: appointmentId }, data, select: appointmentSelect });
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: tenant.clinicId,
            action: `appointment.${status === "NO_SHOW" ? "no_show" : status.toLowerCase()}`,
            targetType: "appointment",
            targetId: appointmentId,
            metadata: { from: current.status, to: status, ...(reason ? { reason } : {}) },
            ipAddress,
        });
        const event = { CONFIRMED: "confirmed", CANCELLED: "cancelled" }[status];
        if (event) await notifyAppointmentEvent(tx, { appointmentId, event, actor: "staff", actorUserId: tenant.userId });
        return updated;
    });
    scheduleEmailDelivery();
    return presentAppointment(row, tenant.timezone);
}

// Moves an appointment to a new time and/or doctor after full re-validation.
async function rescheduleAppointment({ clinic, appointmentId, startsAtInput, doctorId, actorUserId, online, scope = {}, resetToPending, ipAddress, now, authorize }) {
    const startsAt = time.instantToUtc(startsAtInput, clinic.timezone);
    return engine.runBookingTransaction(async (tx) => {
        const current = await tx.appointment.findFirst({ where: { id: appointmentId, clinicId: clinic.id, ...scope }, select: { id: true, doctorId: true, serviceId: true, patientId: true, status: true, startsAt: true } });
        if (!current) throw notFound();
        if (authorize) await authorize(current);
        assertTransition("reschedule", current, now);

        const targetDoctorId = doctorId ?? current.doctorId;
        const doctors = await engine.lockDoctors(tx, clinic.id, [current.doctorId, targetDoctorId]);
        await engine.lockPatient(tx, clinic.id, current.patientId);
        // Re-read under lock: the status may have changed while we waited.
        const fresh = await tx.appointment.findUnique({ where: { id: appointmentId }, select: { status: true, startsAt: true } });
        assertTransition("reschedule", { ...current, ...fresh }, now);

        const { service, endsAt } = await engine.validateBooking(tx, {
            clinic,
            doctor: doctors.get(targetDoctorId),
            serviceId: current.serviceId,
            startsAt,
            patientId: current.patientId,
            excludeAppointmentId: appointmentId,
            online,
            now,
        });
        const data = {
            doctorId: targetDoctorId,
            startsAt,
            endsAt,
            durationMinutes: service.durationMinutes,
            rescheduleCount: { increment: 1 },
        };
        if (resetToPending) Object.assign(data, { status: "PENDING", confirmedAt: null });
        const updated = await tx.appointment.update({ where: { id: appointmentId }, data, select: appointmentSelect });
        await recordAudit(tx, {
            actorUserId,
            clinicId: clinic.id,
            action: "appointment.rescheduled",
            targetType: "appointment",
            targetId: appointmentId,
            metadata: {
                fromStartsAt: current.startsAt.toISOString(),
                toStartsAt: startsAt.toISOString(),
                fromDoctorId: current.doctorId,
                toDoctorId: targetDoctorId,
                by: online ? "patient" : "staff",
            },
            ipAddress,
        });
        await notifyAppointmentEvent(tx, { appointmentId, event: "rescheduled", actor: online ? "patient" : "staff", actorUserId });
        return updated;
    }).finally(scheduleEmailDelivery);
}

async function rescheduleByStaff(tenant, appointmentId, { input, ipAddress, now = new Date() }) {
    const row = await rescheduleAppointment({
        clinic: clinicOf(tenant),
        appointmentId,
        startsAtInput: input.startsAt,
        doctorId: input.doctorId,
        actorUserId: tenant.userId,
        online: false,
        resetToPending: false,
        ipAddress,
        now,
        authorize: async () => {
            if (!hasPermission(tenant.role, "appointments:manage")) throw forbidden();
        },
    });
    return presentAppointment(row, tenant.timezone);
}

module.exports = {
    listAppointments,
    getAppointment,
    createStaffAppointment,
    changeStatus,
    rescheduleAppointment,
    rescheduleByStaff,
    readScope,
    policy,
};
