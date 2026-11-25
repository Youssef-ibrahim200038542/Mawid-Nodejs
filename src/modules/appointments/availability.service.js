// Loads schedule data and runs the pure availability engine. Read-only and lock-free:
// slots are informational, and every booking re-validates inside a locked transaction.
const { DateTime } = require("luxon");
const prisma = require("../../config/database");
const { AppError } = require("../../lib/errors");
const time = require("../../lib/time");
const policy = require("./booking-policy");
const { computeSlots } = require("./availability");
const { bookingWindow } = require("./booking-engine");

function resolveRange({ fromDate, toDate, zone, maxDays, now }) {
    const from = fromDate || DateTime.fromJSDate(now).setZone(zone).toISODate();
    const to = toDate || from;
    const days = DateTime.fromISO(to, { zone }).diff(DateTime.fromISO(from, { zone }), "days").days;
    if (!(days >= 0) || days > maxDays - 1) {
        throw new AppError(400, "INVALID_PERIOD", `Choose a range of 1 to ${maxDays} days.`);
    }
    return { from, to, rangeStart: time.localDateStartToUtc(from, zone), rangeEnd: time.nextLocalDateStartToUtc(to, zone) };
}

async function getAvailability({ clinic, serviceId, doctorId, fromDate, toDate, online, now = new Date() }) {
    const zone = clinic.timezone;
    const { from, to, rangeStart, rangeEnd } = resolveRange({
        fromDate,
        toDate,
        zone,
        maxDays: online ? policy.maxPublicAvailabilityDays : policy.maxStaffAvailabilityDays,
        now,
    });

    const service = await prisma.service.findUnique({
        where: { clinicId_id: { clinicId: clinic.id, id: serviceId } },
        select: { id: true, isActive: true, durationMinutes: true },
    });
    if (!service || !service.isActive) throw new AppError(400, "INVALID_SERVICE", "That service isn't available at this clinic.");

    const doctors = await prisma.doctorProfile.findMany({
        where: {
            clinicId: clinic.id,
            isActive: true,
            member: { status: "ACTIVE" },
            services: { some: { serviceId } },
            ...(doctorId ? { id: doctorId } : {}),
        },
        select: { id: true, displayNameEn: true, displayNameAr: true },
        orderBy: { displayNameEn: "asc" },
        take: 100,
    });
    const doctorIds = doctors.map((d) => d.id);
    if (doctorIds.length === 0) {
        return { timezone: zone, from, to, service: { id: service.id, durationMinutes: service.durationMinutes }, doctors: [] };
    }

    const overlap = { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } };
    const [hours, exceptions, appointments] = await Promise.all([
        prisma.workingHours.findMany({
            where: { clinicId: clinic.id, OR: [{ doctorId: null }, { doctorId: { in: doctorIds } }] },
            select: { doctorId: true, weekday: true, startMinute: true, endMinute: true },
        }),
        prisma.scheduleException.findMany({
            where: { clinicId: clinic.id, OR: [{ doctorId: null }, { doctorId: { in: doctorIds } }], ...overlap },
            select: { doctorId: true, startsAt: true, endsAt: true },
        }),
        prisma.appointment.findMany({
            where: { clinicId: clinic.id, doctorId: { in: doctorIds }, status: { in: policy.activeStatuses }, ...overlap },
            select: { doctorId: true, startsAt: true, endsAt: true },
        }),
    ]);

    const clinicHours = hours.filter((row) => row.doctorId === null);
    const clinicExceptions = exceptions.filter((row) => row.doctorId === null);
    const window = bookingWindow({ now, online });

    return {
        timezone: zone,
        from,
        to,
        service: { id: service.id, durationMinutes: service.durationMinutes },
        doctors: doctors.map((doctor) => ({
            ...doctor,
            slots: computeSlots({
                zone,
                fromDate: from,
                toDate: to,
                clinicHours,
                doctorHours: hours.filter((row) => row.doctorId === doctor.id),
                blocked: [
                    ...clinicExceptions,
                    ...exceptions.filter((row) => row.doctorId === doctor.id),
                    ...appointments.filter((row) => row.doctorId === doctor.id),
                ],
                durationMinutes: service.durationMinutes,
                stepMinutes: policy.slotStepMinutes,
                ...window,
            }).map((slot) => ({
                startsAt: slot.startsAt.toISOString(),
                endsAt: slot.endsAt.toISOString(),
                startsAtLocal: time.utcToLocalIso(slot.startsAt, zone),
            })),
        })),
    };
}

module.exports = { getAvailability, resolveRange };
