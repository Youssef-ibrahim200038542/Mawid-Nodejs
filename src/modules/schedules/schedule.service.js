const { DateTime } = require("luxon");
const prisma = require("../../config/database");
const { AppError, notFound, forbidden } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const { hasPermission } = require("../../lib/permissions");
const time = require("../../lib/time");
const { lockDoctor } = require("../doctors/doctor.service");

const maxExceptionDays = 366;
const maxListRangeDays = 366;
const defaultListRangeDays = 90;
const maxExceptionsListed = 500;

// Owners manage every schedule; a doctor manages only their own (doctor.memberId === their membership).
function assertCanManageSchedule(tenant, doctor) {
    if (hasPermission(tenant.role, "schedule:manage")) return;
    if (doctor && hasPermission(tenant.role, "schedule:manage_own") && doctor.memberId === tenant.memberId) return;
    throw forbidden();
}

function presentHours(rows, timezone) {
    return {
        timezone,
        intervals: rows.map((row) => ({
            weekday: row.weekday,
            start: time.formatHHMM(row.startMinute),
            end: time.formatHHMM(row.endMinute),
        })),
    };
}

async function readHours(db, clinicId, doctorId) {
    return db.workingHours.findMany({
        where: { clinicId, doctorId },
        select: { weekday: true, startMinute: true, endMinute: true },
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
    });
}

async function getClinicHours(tenant) {
    return presentHours(await readHours(prisma, tenant.clinicId, null), tenant.timezone);
}

async function getDoctorHours(tenant, doctorId) {
    const doctor = await prisma.doctorProfile.findUnique({
        where: { clinicId_id: { clinicId: tenant.clinicId, id: doctorId } },
        select: { id: true },
    });
    if (!doctor) throw notFound();
    return presentHours(await readHours(prisma, tenant.clinicId, doctorId), tenant.timezone);
}

async function writeHours(tx, tenant, doctorId, intervals, ipAddress) {
    await tx.workingHours.deleteMany({ where: { clinicId: tenant.clinicId, doctorId } });
    if (intervals.length > 0) {
        await tx.workingHours.createMany({
            data: intervals.map((value) => ({ ...value, clinicId: tenant.clinicId, doctorId })),
        });
    }
    await recordAudit(tx, {
        actorUserId: tenant.userId,
        clinicId: tenant.clinicId,
        action: doctorId ? "doctor.working_hours_updated" : "clinic.working_hours_updated",
        targetType: doctorId ? "doctor" : "clinic",
        targetId: doctorId || tenant.clinicId,
        metadata: { intervals: intervals.length },
        ipAddress,
    });
    return presentHours(await readHours(tx, tenant.clinicId, doctorId), tenant.timezone);
}

// Full replacement inside a transaction; the clinic/doctor row lock serialises concurrent edits.
async function replaceClinicHours(tenant, { intervals, ipAddress }) {
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM clinics WHERE id = ${tenant.clinicId} FOR UPDATE`;
        return writeHours(tx, tenant, null, intervals, ipAddress);
    });
}

async function replaceDoctorHours(tenant, doctorId, { intervals, ipAddress }) {
    return prisma.$transaction(async (tx) => {
        const doctor = await lockDoctor(tx, tenant.clinicId, doctorId);
        assertCanManageSchedule(tenant, doctor);
        return writeHours(tx, tenant, doctorId, intervals, ipAddress);
    });
}

function presentException(row, timezone) {
    return {
        id: row.id,
        doctorId: row.doctorId,
        kind: row.kind,
        reason: row.reason,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        startsAtLocal: time.utcToLocalIso(row.startsAt, timezone),
        endsAtLocal: time.utcToLocalIso(row.endsAt, timezone),
        timezone,
        createdAt: row.createdAt.toISOString(),
    };
}

const exceptionSelect = { id: true, doctorId: true, kind: true, reason: true, startsAt: true, endsAt: true, createdAt: true };

function resolvePeriod(input, zone) {
    let startsAt;
    let endsAt;
    if (input.allDay === true) {
        startsAt = time.localDateStartToUtc(input.startDate, zone);
        endsAt = time.nextLocalDateStartToUtc(input.endDate, zone);
    } else {
        startsAt = time.instantToUtc(input.startsAt, zone);
        endsAt = time.instantToUtc(input.endsAt, zone);
    }
    if (startsAt >= endsAt) {
        throw new AppError(400, "INVALID_PERIOD", "The end must be after the start.");
    }
    if (endsAt - startsAt > maxExceptionDays * 24 * 60 * 60 * 1000) {
        throw new AppError(400, "INVALID_PERIOD", `An exception can last at most ${maxExceptionDays} days.`);
    }
    return { startsAt, endsAt };
}

async function listExceptions(tenant, { from, to, doctorId }) {
    const zone = tenant.timezone;
    const fromDate = from || DateTime.now().setZone(zone).toISODate();
    const toDate = to || DateTime.fromISO(fromDate, { zone }).plus({ days: defaultListRangeDays }).toISODate();
    const rangeStart = time.localDateStartToUtc(fromDate, zone);
    const rangeEnd = time.nextLocalDateStartToUtc(toDate, zone);
    if (rangeStart >= rangeEnd || rangeEnd - rangeStart > (maxListRangeDays + 1) * 24 * 60 * 60 * 1000) {
        throw new AppError(400, "INVALID_PERIOD", `Choose a range of at most ${maxListRangeDays} days.`);
    }

    const rows = await prisma.scheduleException.findMany({
        where: {
            clinicId: tenant.clinicId,
            // Overlap test: starts before the range ends and ends after it starts.
            startsAt: { lt: rangeEnd },
            endsAt: { gt: rangeStart },
            // A doctor's view includes clinic-wide closures, which apply to them too.
            ...(doctorId ? { OR: [{ doctorId }, { doctorId: null }] } : {}),
        },
        select: exceptionSelect,
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: maxExceptionsListed,
    });
    return { from: fromDate, to: toDate, timezone: zone, items: rows.map((row) => presentException(row, zone)) };
}

async function createException(tenant, { input, ipAddress }) {
    const { startsAt, endsAt } = resolvePeriod(input, tenant.timezone);
    const doctorId = input.doctorId ?? null;

    return prisma.$transaction(async (tx) => {
        const doctor = doctorId ? await lockDoctor(tx, tenant.clinicId, doctorId) : null;
        assertCanManageSchedule(tenant, doctor);

        const row = await tx.scheduleException.create({
            data: {
                clinicId: tenant.clinicId,
                doctorId,
                kind: input.kind,
                reason: input.reason ?? null,
                startsAt,
                endsAt,
                createdByUserId: tenant.userId,
            },
            select: exceptionSelect,
        });
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: tenant.clinicId,
            action: "schedule_exception.created",
            targetType: "schedule_exception",
            targetId: row.id,
            metadata: { doctorId, kind: input.kind, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
            ipAddress,
        });
        return presentException(row, tenant.timezone);
    });
}

async function deleteException(tenant, exceptionId, { ipAddress }) {
    return prisma.$transaction(async (tx) => {
        const row = await tx.scheduleException.findFirst({
            where: { id: exceptionId, clinicId: tenant.clinicId },
            select: { id: true, doctorId: true },
        });
        if (!row) throw notFound();
        const doctor = row.doctorId ? await lockDoctor(tx, tenant.clinicId, row.doctorId) : null;
        assertCanManageSchedule(tenant, doctor);

        await tx.scheduleException.deleteMany({ where: { id: exceptionId, clinicId: tenant.clinicId } });
        await recordAudit(tx, {
            actorUserId: tenant.userId,
            clinicId: tenant.clinicId,
            action: "schedule_exception.deleted",
            targetType: "schedule_exception",
            targetId: exceptionId,
            metadata: { doctorId: row.doctorId },
            ipAddress,
        });
    });
}

module.exports = {
    assertCanManageSchedule,
    getClinicHours,
    getDoctorHours,
    replaceClinicHours,
    replaceDoctorHours,
    listExceptions,
    createException,
    deleteException,
    resolvePeriod,
};
