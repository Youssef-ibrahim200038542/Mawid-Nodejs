const express = require("express");
const controller = require("./clinic.controller");
const { createClinicSchema, updateClinicSchema, paginationSchema } = require("./clinic.schemas");
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

module.exports = router;
