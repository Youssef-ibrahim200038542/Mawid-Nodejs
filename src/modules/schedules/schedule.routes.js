const express = require("express");
const controller = require("./schedule.controller");
const { weeklyHoursSchema, createExceptionSchema, listExceptionsQuery } = require("./schedule.schemas");
const validate = require("../../middleware/validate");
const { requirePermission, requireAnyPermission } = require("../../middleware/tenant");

// Mounted under /api/v1/clinics/:clinicSlug after requireApiAuth + loadTenant.
const router = express.Router();
const canRead = requirePermission("schedule:read");
// Doctor-scoped writes: owners always; doctors only for their own profile (checked in the service).
const canManageDoctorSchedule = requireAnyPermission("schedule:manage", "schedule:manage_own");

router.get("/working-hours", canRead, controller.clinicHours);
router.put("/working-hours", requirePermission("schedule:manage"), validate(weeklyHoursSchema), controller.replaceClinicHours);

router.get("/doctors/:doctorId/working-hours", canRead, controller.doctorHours);
router.put(
    "/doctors/:doctorId/working-hours",
    canManageDoctorSchedule,
    validate(weeklyHoursSchema),
    controller.replaceDoctorHours
);

router.get("/schedule-exceptions", canRead, validate(listExceptionsQuery, "query"), controller.listExceptions);
router.post("/schedule-exceptions", canManageDoctorSchedule, validate(createExceptionSchema), controller.createException);
router.delete("/schedule-exceptions/:exceptionId", canManageDoctorSchedule, controller.deleteException);

module.exports = router;
