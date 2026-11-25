const express = require("express");
const controller = require("./doctor.controller");
const schemas = require("./doctor.schemas");
const validate = require("../../middleware/validate");
const { requirePermission } = require("../../middleware/tenant");

// Mounted under /api/v1/clinics/:clinicSlug after requireApiAuth + loadTenant.
const router = express.Router();
const canRead = requirePermission("doctors:read");
const canManage = requirePermission("doctors:manage");

router.get("/doctors", canRead, validate(schemas.listDoctorsQuery, "query"), controller.list);
router.post("/doctors", canManage, validate(schemas.createDoctorSchema), controller.create);
router.get("/doctors/:doctorId", canRead, controller.show);
router.patch("/doctors/:doctorId", canManage, validate(schemas.updateDoctorSchema), controller.update);
router.put("/doctors/:doctorId/specialties", canManage, validate(schemas.setSpecialtiesSchema), controller.setSpecialties);
router.put("/doctors/:doctorId/services", canManage, validate(schemas.setServicesSchema), controller.setServices);

module.exports = router;
