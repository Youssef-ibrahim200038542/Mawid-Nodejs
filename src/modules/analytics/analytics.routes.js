const express = require("express");
const { z } = require("zod");
const analytics = require("./analytics.service");
const prisma = require("../../config/database");
const validate = require("../../middleware/validate");
const { requirePermission } = require("../../middleware/tenant");
const { patterns } = require("../../lib/time");

// Mounted under /api/v1/clinics/:clinicSlug after requireApiAuth + loadTenant.
const router = express.Router();

const localDate = z.string().regex(patterns.localDatePattern, "Use the format YYYY-MM-DD.");
const overviewQuery = z.strictObject({ from: localDate.optional(), to: localDate.optional() });
const auditQuery = z.strictObject({
    action: z.string().trim().max(80).regex(/^[a-z_.]+$/).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

router.get("/analytics/overview", requirePermission("analytics:read"), validate(overviewQuery, "query"), async (req, res) => {
    res.json(await analytics.overview(req.tenant, req.validatedQuery));
});

// The clinic's own audit trail (never another clinic's, never platform-wide).
router.get("/audit-logs", requirePermission("audit:read"), validate(auditQuery, "query"), async (req, res) => {
    const { action, page, pageSize } = req.validatedQuery;
    const where = { clinicId: req.tenant.clinicId, ...(action ? { action } : {}) };
    const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            select: { id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.auditLog.count({ where }),
    ]);
    res.json({ items, page, pageSize, total });
});

module.exports = router;
