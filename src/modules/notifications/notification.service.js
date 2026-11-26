const prisma = require("../../config/database");
const logger = require("../../lib/logger");
const { notFound } = require("../../lib/errors");
const { getEmailProvider } = require("./email-provider");

// Who is told about what. `actor` is who caused the event; they are never notified about
// their own action.
//   patient → staff (owners, receptionists, the appointment's doctor)
//   staff   → the patient (only if the patient has a Mawid account)
const eventTypes = {
    booked: "APPOINTMENT_BOOKED",
    confirmed: "APPOINTMENT_CONFIRMED",
    cancelled: "APPOINTMENT_CANCELLED",
    rescheduled: "APPOINTMENT_RESCHEDULED",
    reminder: "APPOINTMENT_REMINDER",
};

async function loadAppointmentContext(db, appointmentId) {
    return db.appointment.findUnique({
        where: { id: appointmentId },
        select: {
            id: true,
            clinicId: true,
            status: true,
            startsAt: true,
            endsAt: true,
            clinic: { select: { slug: true, name: true, timezone: true } },
            doctor: { select: { displayNameEn: true, displayNameAr: true, member: { select: { userId: true, status: true, trustState: true } } } },
            service: { select: { nameEn: true, nameAr: true } },
            patient: { select: { userId: true } },
        },
    });
}

async function staffRecipients(db, appointment) {
    const staff = await db.clinicMember.findMany({
        // Only trusted memberships see clinic activity (legacy ones await re-confirmation).
        where: { clinicId: appointment.clinicId, status: "ACTIVE", trustState: "TRUSTED", role: { in: ["OWNER", "RECEPTIONIST"] } },
        select: { userId: true },
        take: 50,
    });
    const ids = new Set(staff.map((member) => member.userId));
    const doctorMember = appointment.doctor.member;
    if (doctorMember.status === "ACTIVE" && doctorMember.trustState === "TRUSTED") ids.add(doctorMember.userId);
    return [...ids];
}

function payloadFor(appointment) {
    return {
        appointmentId: appointment.id,
        status: appointment.status,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        timezone: appointment.clinic.timezone,
        clinic: { slug: appointment.clinic.slug, name: appointment.clinic.name },
        doctor: { nameEn: appointment.doctor.displayNameEn, nameAr: appointment.doctor.displayNameAr },
        service: { nameEn: appointment.service.nameEn, nameAr: appointment.service.nameAr },
    };
}

/**
 * Records in-app notifications for an appointment event, inside the caller's transaction, so a
 * rolled-back booking never leaves a notification behind.
 */
async function notifyAppointmentEvent(tx, { appointmentId, event, actor, actorUserId, dedupeKey = null }) {
    const appointment = await loadAppointmentContext(tx, appointmentId);
    if (!appointment) return 0;

    let recipients;
    if (actor === "patient") {
        recipients = await staffRecipients(tx, appointment);
    } else {
        recipients = appointment.patient.userId ? [appointment.patient.userId] : [];
    }
    recipients = recipients.filter((userId) => userId !== actorUserId);
    if (recipients.length === 0) return 0;

    const type = eventTypes[event];
    const payload = payloadFor(appointment);
    const result = await tx.notification.createMany({
        data: recipients.map((userId) => ({
            userId,
            clinicId: appointment.clinicId,
            appointmentId: appointment.id,
            type,
            payload: { ...payload, audience: actor === "patient" ? "staff" : "patient" },
            // Without an email provider there is nothing to deliver.
            emailStatus: getEmailProvider().enabled ? "PENDING" : "SKIPPED",
            dedupeKey: dedupeKey && recipients.length === 1 ? dedupeKey : null,
        })),
        skipDuplicates: Boolean(dedupeKey),
    });
    // Rows actually written; duplicates skipped by the dedupe key are not counted.
    return result.count;
}

const subjects = {
    APPOINTMENT_BOOKED: "Appointment booked",
    APPOINTMENT_CONFIRMED: "Appointment confirmed",
    APPOINTMENT_CANCELLED: "Appointment cancelled",
    APPOINTMENT_RESCHEDULED: "Appointment rescheduled",
    APPOINTMENT_REMINDER: "Appointment reminder",
};

// Email delivery runs after commit and never fails the request. Each pending notification is
// handed to the configured provider and its email_status updated.
async function deliverPendingEmails({ limit = 50 } = {}) {
    const provider = getEmailProvider();
    const pending = await prisma.notification.findMany({
        where: { emailStatus: "PENDING" },
        select: { id: true, type: true, payload: true, user: { select: { email: true, emailVerifiedAt: true } } },
        orderBy: { id: "asc" },
        take: limit,
    });
    for (const item of pending) {
        // Email only goes to addresses whose owner proved control of them.
        if (!item.user.emailVerifiedAt) {
            await prisma.notification.update({ where: { id: item.id }, data: { emailStatus: "SKIPPED" } });
            continue;
        }
        try {
            const result = await provider.send({ to: item.user.email, subject: subjects[item.type], text: JSON.stringify(item.payload) });
            await prisma.notification.update({ where: { id: item.id }, data: { emailStatus: result.status } });
        } catch (error) {
            logger.warn({ err: error, notificationId: item.id }, "Email delivery failed");
            await prisma.notification.update({ where: { id: item.id }, data: { emailStatus: "FAILED", emailError: String(error.message).slice(0, 255) } });
        }
    }
    return pending.length;
}

function scheduleEmailDelivery() {
    if (!getEmailProvider().enabled) return;
    setImmediate(() => {
        deliverPendingEmails().catch((error) => logger.warn({ err: error }, "Email delivery run failed"));
    });
}

// ---------------------------------------------------------------- reading (the user's own only)

const notificationSelect = { id: true, type: true, payload: true, readAt: true, createdAt: true, appointmentId: true };

async function listMyNotifications(userId, { unreadOnly, page, pageSize }) {
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
        prisma.notification.findMany({ where, select: notificationSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, page, pageSize, total, unread };
}

async function markRead(userId, notificationId) {
    const result = await prisma.notification.updateMany({ where: { id: notificationId, userId, readAt: null }, data: { readAt: new Date() } });
    if (result.count === 0) {
        const exists = await prisma.notification.count({ where: { id: notificationId, userId } });
        if (!exists) throw notFound();
    }
}

async function markAllRead(userId) {
    const result = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return result.count;
}

// ---------------------------------------------------------------- reminders (scheduled job)

// Reminds patients (with accounts) about CONFIRMED appointments starting 23–25 h from `now`.
// Safe to run repeatedly (e.g. hourly): the dedupe key stops double reminders.
async function sendDueReminders({ now = new Date() } = {}) {
    const from = new Date(now.getTime() + 23 * 3_600_000);
    const to = new Date(now.getTime() + 25 * 3_600_000);
    const due = await prisma.appointment.findMany({
        where: { status: "CONFIRMED", startsAt: { gte: from, lt: to }, patient: { userId: { not: null } } },
        select: { id: true },
        take: 1000,
    });
    let created = 0;
    for (const { id } of due) {
        await prisma.$transaction(async (tx) => {
            created += await notifyAppointmentEvent(tx, { appointmentId: id, event: "reminder", actor: "system", actorUserId: null, dedupeKey: `reminder:${id}` });
        });
    }
    scheduleEmailDelivery();
    return { candidates: due.length, created };
}

module.exports = {
    notifyAppointmentEvent,
    deliverPendingEmails,
    scheduleEmailDelivery,
    listMyNotifications,
    markRead,
    markAllRead,
    sendDueReminders,
};
