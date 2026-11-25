// Clinic dashboard analytics. Everything is scoped to tenant.clinicId and computed from
// appointments only (no medical data exists). Per-day buckets use the clinic's timezone and
// are computed in JS, because MariaDB's timezone tables may not be loaded on every server.
const { DateTime } = require("luxon");
const prisma = require("../../config/database");
const { AppError } = require("../../lib/errors");
const time = require("../../lib/time");

const maxRangeDays = 366;
const maxRowsForDaily = 50_000;
const statuses = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];

function resolveRange(tenant, { from, to }) {
    const zone = tenant.timezone;
    const toDate = to || DateTime.now().setZone(zone).toISODate();
    const fromDate = from || DateTime.fromISO(toDate, { zone }).minus({ days: 29 }).toISODate();
    const start = time.localDateStartToUtc(fromDate, zone);
    const end = time.nextLocalDateStartToUtc(toDate, zone);
    if (start >= end || end - start > (maxRangeDays + 1) * 86_400_000) {
        throw new AppError(400, "INVALID_PERIOD", `Choose a range of at most ${maxRangeDays} days.`);
    }
    return { fromDate, toDate, start, end };
}

async function overview(tenant, query, now = new Date()) {
    const zone = tenant.timezone;
    const { fromDate, toDate, start, end } = resolveRange(tenant, query);
    const where = { clinicId: tenant.clinicId, startsAt: { gte: start, lt: end } };
    const todayStart = time.localDateStartToUtc(DateTime.fromJSDate(now).setZone(zone).toISODate(), zone);
    const todayEnd = new Date(todayStart.getTime() + 86_400_000 + 3_600_000); // tolerate DST days
    const todayLocal = DateTime.fromJSDate(now).setZone(zone).toISODate();

    const [byStatus, revenue, byDoctor, byService, rows, todayRows, pendingUpcoming, newPatients] = await Promise.all([
        prisma.appointment.groupBy({ by: ["status"], where, _count: { _all: true } }),
        prisma.appointment.groupBy({ by: ["currency"], where: { ...where, status: "COMPLETED" }, _sum: { priceMinor: true }, _count: { _all: true } }),
        prisma.appointment.groupBy({ by: ["doctorId", "status"], where, _count: { _all: true } }),
        prisma.appointment.groupBy({ by: ["serviceId"], where: { ...where, status: { not: "CANCELLED" } }, _count: { _all: true }, orderBy: { _count: { serviceId: "desc" } }, take: 10 }),
        prisma.appointment.findMany({ where, select: { startsAt: true, status: true }, take: maxRowsForDaily }),
        prisma.appointment.findMany({ where: { clinicId: tenant.clinicId, startsAt: { gte: todayStart, lt: todayEnd } }, select: { startsAt: true, status: true } }),
        prisma.appointment.count({ where: { clinicId: tenant.clinicId, status: "PENDING", startsAt: { gte: now } } }),
        prisma.patient.count({ where: { clinicId: tenant.clinicId, createdAt: { gte: start, lt: end } } }),
    ]);

    const counts = Object.fromEntries(statuses.map((s) => [s, 0]));
    for (const row of byStatus) counts[row.status] = row._count._all;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const attended = counts.COMPLETED + counts.NO_SHOW;

    const daily = new Map();
    for (let d = DateTime.fromISO(fromDate, { zone }); d.toISODate() <= toDate; d = d.plus({ days: 1 })) {
        daily.set(d.toISODate(), { date: d.toISODate(), total: 0, completed: 0, cancelled: 0, noShow: 0 });
    }
    for (const row of rows) {
        const bucket = daily.get(DateTime.fromJSDate(row.startsAt).setZone(zone).toISODate());
        if (!bucket) continue;
        bucket.total += 1;
        if (row.status === "COMPLETED") bucket.completed += 1;
        if (row.status === "CANCELLED") bucket.cancelled += 1;
        if (row.status === "NO_SHOW") bucket.noShow += 1;
    }

    const doctorIds = [...new Set(byDoctor.map((r) => r.doctorId))];
    const serviceIds = byService.map((r) => r.serviceId);
    const [doctors, services] = await Promise.all([
        prisma.doctorProfile.findMany({ where: { clinicId: tenant.clinicId, id: { in: doctorIds } }, select: { id: true, displayNameEn: true, displayNameAr: true } }),
        prisma.service.findMany({ where: { clinicId: tenant.clinicId, id: { in: serviceIds } }, select: { id: true, nameEn: true, nameAr: true } }),
    ]);
    const doctorStats = doctors.map((doctor) => {
        const mine = byDoctor.filter((r) => r.doctorId === doctor.id);
        const get = (status) => (mine.find((r) => r.status === status) || { _count: { _all: 0 } })._count._all;
        return { ...doctor, total: mine.reduce((sum, r) => sum + r._count._all, 0), completed: get("COMPLETED"), cancelled: get("CANCELLED"), noShow: get("NO_SHOW") };
    }).sort((a, b) => b.total - a.total);

    const today = todayRows.filter((r) => DateTime.fromJSDate(r.startsAt).setZone(zone).toISODate() === todayLocal);
    return {
        timezone: zone,
        from: fromDate,
        to: toDate,
        totals: {
            appointments: total,
            byStatus: counts,
            noShowRate: attended === 0 ? null : Number((counts.NO_SHOW / attended).toFixed(4)),
            cancellationRate: total === 0 ? null : Number((counts.CANCELLED / total).toFixed(4)),
            newPatients,
            pendingUpcoming,
        },
        revenue: revenue.map((r) => ({ currency: r.currency, completedAppointments: r._count._all, amountMinor: r._sum.priceMinor || 0, amount: ((r._sum.priceMinor || 0) / 100).toFixed(2) })),
        today: { date: todayLocal, total: today.length, active: today.filter((r) => ["PENDING", "CONFIRMED"].includes(r.status)).length },
        daily: [...daily.values()],
        byDoctor: doctorStats,
        topServices: byService.map((r) => ({ ...(services.find((s) => s.id === r.serviceId) || { id: r.serviceId }), count: r._count._all })),
        truncated: rows.length >= maxRowsForDaily,
    };
}

module.exports = { overview };
