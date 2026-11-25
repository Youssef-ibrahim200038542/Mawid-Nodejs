const express = require("express");
const controller = require("./appointment.controller");
const schemas = require("./appointment.schemas");
const validate = require("../../middleware/validate");
const { requirePermission, requireAnyPermission } = require("../../middleware/tenant");

// Mounted under /api/v1/clinics/:clinicSlug after requireApiAuth + loadTenant.
// Doctor-level ownership (own appointments only) is enforced again in the service.
const router = express.Router();
const canRead = requireAnyPermission("appointments:read", "appointments:read_own");
const canChangeStatus = requireAnyPermission("appointments:manage", "appointments:update_own");
const canManage = requirePermission("appointments:manage");

router.get("/availability", requirePermission("schedule:read"), validate(schemas.availabilityQuery, "query"), controller.availability);

router.get("/appointments", canRead, validate(schemas.listAppointmentsQuery, "query"), controller.list);
router.post("/appointments", requirePermission("appointments:create"), validate(schemas.staffCreateSchema), controller.create);
router.get("/appointments/:appointmentId", canRead, controller.show);

router.post("/appointments/:appointmentId/confirm", canChangeStatus, validate(schemas.emptySchema), controller.statusAction("confirm"));
router.post("/appointments/:appointmentId/complete", canChangeStatus, validate(schemas.emptySchema), controller.statusAction("complete"));
router.post("/appointments/:appointmentId/no-show", canChangeStatus, validate(schemas.emptySchema), controller.statusAction("no_show"));
router.post("/appointments/:appointmentId/cancel", canManage, validate(schemas.cancelSchema), controller.statusAction("cancel"));
router.post("/appointments/:appointmentId/reschedule", canManage, validate(schemas.rescheduleSchema), controller.reschedule);

module.exports = router;
