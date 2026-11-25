const express = require("express");
const patientService = require("./patient.service");
const { createPatientSchema, updatePatientSchema, listPatientsQuery } = require("./patient.schemas");
const validate = require("../../middleware/validate");
const { requirePermission } = require("../../middleware/tenant");
const { parseIdParam } = require("../../lib/tenant-data");

// Mounted under /api/v1/clinics/:clinicSlug after requireApiAuth + loadTenant.
const router = express.Router();
const canRead = requirePermission("patients:read");
const canManage = requirePermission("patients:manage");

router.get("/patients", canRead, validate(listPatientsQuery, "query"), async (req, res) => {
    res.json(await patientService.listPatients(req.tenant, req.validatedQuery));
});

router.post("/patients", canManage, validate(createPatientSchema), async (req, res) => {
    res.status(201).json({ patient: await patientService.createPatient(req.tenant, { input: req.body, ipAddress: req.ip }) });
});

router.get("/patients/:patientId", canRead, async (req, res) => {
    res.json({ patient: await patientService.getPatient(req.tenant, parseIdParam(req.params.patientId)) });
});

router.patch("/patients/:patientId", canManage, validate(updatePatientSchema), async (req, res) => {
    const patient = await patientService.updatePatient(req.tenant, parseIdParam(req.params.patientId), { input: req.body, ipAddress: req.ip });
    res.json({ patient });
});

module.exports = router;
