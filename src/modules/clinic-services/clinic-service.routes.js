const express = require("express");
const controller = require("./clinic-service.controller");
const { createServiceSchema, updateServiceSchema, listServicesQuery } = require("./clinic-service.schemas");
const validate = require("../../middleware/validate");
const { requirePermission } = require("../../middleware/tenant");

// Mounted under /api/v1/clinics/:clinicSlug after requireApiAuth + loadTenant.
const router = express.Router();

router.get("/services", requirePermission("services:read"), validate(listServicesQuery, "query"), controller.list);
router.post("/services", requirePermission("services:manage"), validate(createServiceSchema), controller.create);
router.get("/services/:serviceId", requirePermission("services:read"), controller.show);
router.patch("/services/:serviceId", requirePermission("services:manage"), validate(updateServiceSchema), controller.update);

module.exports = router;
