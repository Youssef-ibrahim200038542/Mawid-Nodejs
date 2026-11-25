// Public (patient-facing) routes: /api/v1/public/* and /api/v1/me/*.
const express = require("express");
const schemas = require("./appointment.schemas");
const publicService = require("./public.service");
const portal = require("./patient-portal.service");
const validate = require("../../middleware/validate");
const requireApiAuth = require("../../middleware/require-api-auth");
const { createLimiter } = require("../../middleware/rate-limit");
const { parseIdParam } = require("../../lib/tenant-data");

const router = express.Router();
const bookingLimiter = createLimiter({ windowMs: 10 * 60 * 1000, limit: 30, keyByUser: true });
const publicReadLimiter = createLimiter({ windowMs: 60 * 1000, limit: 120 });

router.get("/public/clinics", publicReadLimiter, validate(schemas.publicClinicsQuery, "query"), async (req, res) => {
    res.json(await publicService.listClinics(req.validatedQuery));
});

router.get("/public/clinics/:clinicSlug", publicReadLimiter, async (req, res) => {
    res.json(await publicService.getPublicClinic(req.params.clinicSlug));
});

router.get("/public/clinics/:clinicSlug/availability", publicReadLimiter, validate(schemas.availabilityQuery, "query"), async (req, res) => {
    res.json(await publicService.getPublicAvailability(req.params.clinicSlug, req.validatedQuery));
});

router.post("/public/clinics/:clinicSlug/appointments", requireApiAuth, bookingLimiter, validate(schemas.onlineBookingSchema), async (req, res) => {
    const appointment = await portal.bookOnline(req.session.user.id, req.params.clinicSlug, { input: req.body, ipAddress: req.ip });
    res.status(201).json({ appointment });
});

router.get("/me/appointments", requireApiAuth, validate(schemas.myAppointmentsQuery, "query"), async (req, res) => {
    res.json(await portal.listMyAppointments(req.session.user.id, req.validatedQuery));
});

router.post("/me/appointments/:appointmentId/cancel", requireApiAuth, bookingLimiter, validate(schemas.cancelSchema), async (req, res) => {
    const appointment = await portal.cancelMine(req.session.user.id, parseIdParam(req.params.appointmentId), { reason: req.body.reason, ipAddress: req.ip });
    res.json({ appointment });
});

router.post("/me/appointments/:appointmentId/reschedule", requireApiAuth, bookingLimiter, validate(schemas.rescheduleSchema), async (req, res) => {
    const appointment = await portal.rescheduleMine(req.session.user.id, parseIdParam(req.params.appointmentId), { input: req.body, ipAddress: req.ip });
    res.json({ appointment });
});

module.exports = router;
