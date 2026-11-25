const express = require("express");
const controller = require("./specialty.controller");
const { createSpecialtySchema, updateSpecialtySchema, listSpecialtiesQuery } = require("./specialty.schemas");
const validate = require("../../middleware/validate");
const { requirePermission } = require("../../middleware/tenant");

// Mounted under /api/v1/clinics/:clinicSlug after requireApiAuth + loadTenant.
const router = express.Router();

router.get("/specialties", requirePermission("specialties:read"), validate(listSpecialtiesQuery, "query"), controller.list);
router.post("/specialties", requirePermission("specialties:manage"), validate(createSpecialtySchema), controller.create);
router.patch(
    "/specialties/:specialtyId",
    requirePermission("specialties:manage"),
    validate(updateSpecialtySchema),
    controller.update
);

module.exports = router;
