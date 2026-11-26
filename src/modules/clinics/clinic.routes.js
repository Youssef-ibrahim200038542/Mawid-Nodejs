const express = require("express");
const controller = require("./clinic.controller");
const { createClinicSchema, updateClinicSchema, paginationSchema, updateMemberSchema } = require("./clinic.schemas");
const { AppError } = require("../../lib/errors");
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

// Adding a member directly by email was removed (account security, H1): it granted access to
// whoever held an account with that address. Staff now join by accepting an invitation.
router.post("/clinics/:clinicSlug/members", (req, res, next) => {
    next(new AppError(410, "ENDPOINT_REPLACED", "Members are now invited: use POST /clinics/:slug/invitations."));
});
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
