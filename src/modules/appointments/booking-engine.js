// Transactional booking core shared by staff booking, online booking and rescheduling.
//
// Concurrency strategy (MariaDB 10.4 has no exclusion constraints):
//   1. Every booking runs in a READ COMMITTED transaction.
//   2. It first takes row locks: the doctor row(s) in ascending id order, then the patient row.
//      All bookings for one doctor are therefore serialised; different doctors never block each other.
//   3. Only after holding the locks does it read hours, exceptions and existing appointments
//      (READ COMMITTED → it sees everything committed by the transaction that held the lock before it).
//   4. It re-validates everything and inserts/updates. Commit releases the locks.
// A deadlock or lock timeout is retried a few times before failing.
const prisma = require("../../config/database");
const { AppError } = require("../../lib/errors");
const policy = require("./booking-policy");
const { checkSlot } = require("./availability");

const slotErrors = {
    BOOKING_TOO_SOON: [409, "That time is too soon to book. Choose a later time."],
    BOOKING_TOO_FAR: [409, `Appointments can be booked up to ${policy.maxAdvanceDays} days ahead.`],
    OUTSIDE_WORKING_HOURS: [409, "The doctor isn't working at that time."],
    DOCTOR_UNAVAILABLE: [409, "The doctor is unavailable at that time."],
    SLOT_TAKEN: [409, "That time has just been booked. Choose another time."],
};

function slotError(code) {
    const [status, message] = slotErrors[code];
    return new AppError(status, code, message);
}

const transactionOptions = { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 };
const retryableCodes = new Set(["P2034"]);
const retryableDbCodes = new Set([1213, 1205]); // deadlock, lock wait timeout

function isRetryable(error) {
    if (!error) return false;
    if (retryableCodes.has(error.code)) return true;
    const cause = error.meta && error.meta.driverAdapterError && error.meta.driverAdapterError.cause;
    return Boolean(cause && retryableDbCodes.has(Number(cause.code || cause.originalCode)));
}

async function runBookingTransaction(work, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await prisma.$transaction(work, transactionOptions);
        } catch (error) {
            if (attempt >= attempts || !isRetryable(error)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
        }
    }
}

async function lockDoctors(tx, clinicId, doctorIds) {
    const unique = [...new Set(doctorIds)].sort((a, b) => a - b);
    const locked = new Map();
    for (const id of unique) {
        const rows = await tx.$queryRaw`
            SELECT d.id, d.member_id AS memberId, d.is_active AS isActive, m.status AS memberStatus, m.trust_state AS trustState
            FROM doctor_profiles d JOIN clinic_members m ON m.id = d.member_id
            WHERE d.id = ${id} AND d.clinic_id = ${clinicId}
            FOR UPDATE
        `;
        if (rows.length === 0) throw new AppError(400, "INVALID_DOCTOR", "That doctor isn't part of this clinic.");
        locked.set(id, {
            id,
            memberId: rows[0].memberId,
            isActive: Boolean(rows[0].isActive),
            memberStatus: rows[0].memberStatus,
            trustState: rows[0].trustState,
        });
    }
    return locked;
}

async function lockPatient(tx, clinicId, patientId) {
    const rows = await tx.$queryRaw`SELECT id FROM patients WHERE id = ${patientId} AND clinic_id = ${clinicId} FOR UPDATE`;
    if (rows.length === 0) throw new AppError(400, "INVALID_PATIENT", "That patient isn't registered with this clinic.");
}

function bookingWindow({ now, online }) {
    const notBefore = online ? new Date(now.getTime() + policy.onlineMinNoticeMinutes * 60_000) : now;
    const notAfter = new Date(now.getTime() + policy.maxAdvanceDays * 24 * 60 * 60_000);
    return { notBefore, notAfter };
}

/**
 * Validates that `doctor` can see the patient for `serviceId` at `startsAt`, inside a transaction
 * that already holds the doctor's lock. Returns the service snapshot and end time.
 */
async function validateBooking(tx, { clinic, doctor, serviceId, startsAt, patientId, excludeAppointmentId = null, online, now }) {
    // Checked under the doctor + membership row lock: a doctor whose membership is still
    // LEGACY_UNREVIEWED (not re-confirmed) takes no new bookings or moves onto their calendar.
    if (!doctor.isActive || doctor.memberStatus !== "ACTIVE" || doctor.trustState !== "TRUSTED") {
        throw new AppError(409, "DOCTOR_NOT_BOOKABLE", "This doctor isn't taking appointments.");
    }
    if (startsAt.getUTCSeconds() !== 0 || startsAt.getUTCMilliseconds() !== 0 || startsAt.getUTCMinutes() % policy.startGranularityMinutes !== 0) {
        throw new AppError(400, "INVALID_START_TIME", `Start times must be on a ${policy.startGranularityMinutes}-minute boundary.`);
    }

    const service = await tx.service.findUnique({
        where: { clinicId_id: { clinicId: clinic.id, id: serviceId } },
        select: { id: true, isActive: true, durationMinutes: true, priceMinor: true, currency: true },
    });
    if (!service || !service.isActive) throw new AppError(400, "INVALID_SERVICE", "That service isn't available at this clinic.");
    const offered = await tx.doctorService.findUnique({ where: { doctorId_serviceId: { doctorId: doctor.id, serviceId } } });
    if (!offered) throw new AppError(400, "DOCTOR_DOES_NOT_OFFER_SERVICE", "This doctor doesn't offer that service.");

    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
    const overlap = { startsAt: { lt: endsAt }, endsAt: { gt: startsAt } };
    const notSelf = excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {};

    const [hours, exceptions, appointments, patientOverlaps] = await Promise.all([
        tx.workingHours.findMany({
            where: { clinicId: clinic.id, OR: [{ doctorId: null }, { doctorId: doctor.id }] },
            select: { doctorId: true, weekday: true, startMinute: true, endMinute: true },
        }),
        tx.scheduleException.findMany({
            where: { clinicId: clinic.id, OR: [{ doctorId: null }, { doctorId: doctor.id }], ...overlap },
            select: { startsAt: true, endsAt: true },
        }),
        tx.appointment.findMany({
            where: { doctorId: doctor.id, status: { in: policy.activeStatuses }, ...overlap, ...notSelf },
            select: { startsAt: true, endsAt: true },
        }),
        tx.appointment.count({
            where: { clinicId: clinic.id, patientId, status: { in: policy.activeStatuses }, ...overlap, ...notSelf },
        }),
    ]);

    const reason = checkSlot({
        zone: clinic.timezone,
        startsAt,
        durationMinutes: service.durationMinutes,
        clinicHours: hours.filter((row) => row.doctorId === null),
        doctorHours: hours.filter((row) => row.doctorId === doctor.id),
        exceptions,
        appointments,
        ...bookingWindow({ now, online }),
    });
    if (reason) throw slotError(reason);
    if (patientOverlaps > 0) {
        throw new AppError(409, "PATIENT_DOUBLE_BOOKED", "The patient already has an appointment at that time.");
    }
    return { service, endsAt };
}

async function assertPatientBookingLimit(tx, clinicId, patientId, now) {
    const active = await tx.appointment.count({
        where: { clinicId, patientId, status: { in: policy.activeStatuses }, startsAt: { gt: now } },
    });
    if (active >= policy.maxActiveAppointmentsPerPatient) {
        throw new AppError(409, "PATIENT_BOOKING_LIMIT", `A patient can hold at most ${policy.maxActiveAppointmentsPerPatient} upcoming appointments at this clinic.`);
    }
}

module.exports = {
    runBookingTransaction,
    lockDoctors,
    lockPatient,
    validateBooking,
    assertPatientBookingLimit,
    bookingWindow,
    isRetryable,
};
