// Mawid Super Admin API: /api/v1/admin/*.
// Separate, explicit authorization: the caller's platform_role is read from the database on
// every request. Super admins do NOT get implicit access to clinic tenant routes; this API only
// exposes platform-level management, and every change is audited.
const express = require("express");
const { z } = require("zod");
const prisma = require("../../config/database");
const requireApiAuth = require("../../middleware/require-api-auth");
const validate = require("../../middleware/validate");
const { AppError, notFound } = require("../../lib/errors");
const { recordAudit } = require("../../lib/audit");
const { parseIdParam } = require("../../lib/tenant-data");

const router = express.Router();

async function requireSuperAdmin(req, res, next) {
    const user = await prisma.user.findUnique({ where: { id: req.session.user.id }, select: { platformRole: true } });
    // 404 instead of 403: the admin area's existence isn't confirmed to other users.
    if (!user || user.platformRole !== "SUPER_ADMIN") return next(notFound());
    next();
}

router.use("/admin", requireApiAuth, requireSuperAdmin);

const page = { page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const clinicsQuery = z.strictObject({ q: z.string().trim().max(100).optional(), status: z.enum(["ACTIVE", "SUSPENDED"]).optional(), ...page });
const usersQuery = z.strictObject({ q: z.string().trim().max(100).optional(), ...page });
const auditQuery = z.strictObject({ clinicId: z.coerce.number().int().positive().optional(), action: z.string().trim().max(80).regex(/^[a-z_.]+$/).optional(), ...page });
const clinicStatusSchema = z.strictObject({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().trim().max(255).optional() });
const platformRoleSchema = z.strictObject({ platformRole: z.enum(["USER", "SUPER_ADMIN"]) });

router.get("/admin/overview", async (req, res) => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [clinicsByStatus, users, superAdmins, appointments, recentAppointments, patients] = await Promise.all([
        prisma.clinic.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.user.count(),
        prisma.user.count({ where: { platformRole: "SUPER_ADMIN" } }),
        prisma.appointment.count(),
        prisma.appointment.count({ where: { createdAt: { gte: since } } }),
        prisma.patient.count(),
    ]);
    res.json({
        clinics: Object.fromEntries(clinicsByStatus.map((r) => [r.status, r._count._all])),
        users,
        superAdmins,
        patients,
        appointments: { total: appointments, last30Days: recentAppointments },
    });
});

router.get("/admin/clinics", validate(clinicsQuery, "query"), async (req, res) => {
    const { q, status, page: p, pageSize } = req.validatedQuery;
    const where = { ...(status ? { status } : {}), ...(q ? { OR: [{ name: { contains: q } }, { slug: { contains: q } }, { city: { contains: q } }] } : {}) };
    const [items, total] = await Promise.all([
        prisma.clinic.findMany({
            where,
            select: { id: true, slug: true, name: true, city: true, status: true, timezone: true, createdAt: true, _count: { select: { members: true, doctors: true, appointments: true, patients: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (p - 1) * pageSize,
            take: pageSize,
        }),
        prisma.clinic.count({ where }),
    ]);
    res.json({ items, page: p, pageSize, total });
});

router.patch("/admin/clinics/:clinicId", validate(clinicStatusSchema), async (req, res) => {
    const clinicId = parseIdParam(req.params.clinicId);
    const clinic = await prisma.$transaction(async (tx) => {
        const current = await tx.clinic.findUnique({ where: { id: clinicId }, select: { id: true, status: true } });
        if (!current) throw notFound();
        const updated = await tx.clinic.update({ where: { id: clinicId }, data: { status: req.body.status }, select: { id: true, slug: true, name: true, status: true } });
        await recordAudit(tx, {
            actorUserId: req.session.user.id,
            clinicId,
            action: "admin.clinic_status_changed",
            targetType: "clinic",
            targetId: clinicId,
            metadata: { from: current.status, to: req.body.status, reason: req.body.reason ?? null },
            ipAddress: req.ip,
        });
        return updated;
    });
    res.json({ clinic });
});

router.get("/admin/users", validate(usersQuery, "query"), async (req, res) => {
    const { q, page: p, pageSize } = req.validatedQuery;
    const where = q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {};
    const [items, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: { id: true, name: true, email: true, platformRole: true, locale: true, createdAt: true, _count: { select: { memberships: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (p - 1) * pageSize,
            take: pageSize,
        }),
        prisma.user.count({ where }),
    ]);
    res.json({ items, page: p, pageSize, total });
});

router.patch("/admin/users/:userId", validate(platformRoleSchema), async (req, res) => {
    const userId = parseIdParam(req.params.userId);
    if (userId === req.session.user.id) {
        throw new AppError(403, "CANNOT_CHANGE_SELF", "You can't change your own platform role.");
    }
    const user = await prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({ where: { id: userId }, select: { platformRole: true } });
        if (!current) throw notFound();
        const updated = await tx.user.update({ where: { id: userId }, data: { platformRole: req.body.platformRole }, select: { id: true, name: true, email: true, platformRole: true } });
        await recordAudit(tx, {
            actorUserId: req.session.user.id,
            action: "admin.user_role_changed",
            targetType: "user",
            targetId: userId,
            metadata: { from: current.platformRole, to: req.body.platformRole },
            ipAddress: req.ip,
        });
        return updated;
    });
    res.json({ user });
});

router.get("/admin/audit-logs", validate(auditQuery, "query"), async (req, res) => {
    const { clinicId, action, page: p, pageSize } = req.validatedQuery;
    const where = { ...(clinicId ? { clinicId } : {}), ...(action ? { action } : {}) };
    const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            select: { id: true, action: true, clinicId: true, targetType: true, targetId: true, metadata: true, ipAddress: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (p - 1) * pageSize,
            take: pageSize,
        }),
        prisma.auditLog.count({ where }),
    ]);
    res.json({ items, page: p, pageSize, total });
});

module.exports = router;
