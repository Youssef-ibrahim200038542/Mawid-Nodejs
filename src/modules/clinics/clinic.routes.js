const express = require("express");
const controller = require("./clinic.controller");
const { createClinicSchema, updateClinicSchema, paginationSchema, addMemberSchema, updateMemberSchema } = require("./clinic.schemas");
const clinicService = require("./clinic.service");
const { parseIdParam } = require("../../lib/tenant-data");
const requireApiAuth = require("../../middleware/require-api-auth");
const validate = require("../../middleware/validate");
const { loadTenant, requirePermission } = require("../../middleware/tenant");
const { createLimiter } = require("../../middleware/rate-limit");

const router = express.Router();
const clinicCreationLimiter = createLimiter({ windowMs: 60 * 60 * 1000, limit: 5 });

router.use("/clinics", requireApiAuth);

router.get("/clinics", controller.listMine);
router.post("/clinics", clinicCreationLimiter, validate(createClinicSchema), controller.create);

router.get("/clinics/:clinicSlug", loadTenant, requirePermission("clinic:read"), controller.show);
router.patch(
    "/clinics/:clinicSlug",
    loadTenant,
    requirePermission("clinic:update"),
    validate(updateClinicSchema),
    controller.update
);
router.get(
    "/clinics/:clinicSlug/members",
    loadTenant,
    requirePermission("members:read"),
    validate(paginationSchema, "query"),
    controller.members
);

router.post(
    "/clinics/:clinicSlug/members",
    loadTenant,
    requirePermission("members:manage"),
    validate(addMemberSchema),
    async (req, res) => {
        res.status(201).json({ member: await clinicService.addMember(req.tenant, { input: req.body, ipAddress: req.ip }) });
    }
);
router.patch(
    "/clinics/:clinicSlug/members/:memberId",
    loadTenant,
    requirePermission("members:manage"),
    validate(updateMemberSchema),
    async (req, res) => {
        const member = await clinicService.updateMember(req.tenant, parseIdParam(req.params.memberId), { input: req.body, ipAddress: req.ip });
        res.json({ member });
    }
);

module.exports = router;
