const doctorService = require("./doctor.service");
const { parseIdParam } = require("../../lib/tenant-data");

async function list(req, res) {
    res.json(await doctorService.listDoctors(req.tenant, req.validatedQuery));
}

async function show(req, res) {
    res.json({ doctor: await doctorService.getDoctor(req.tenant, parseIdParam(req.params.doctorId)) });
}

async function create(req, res) {
    const doctor = await doctorService.createDoctor(req.tenant, { input: req.body, ipAddress: req.ip });
    res.status(201).json({ doctor });
}

async function update(req, res) {
    const doctor = await doctorService.updateDoctor(req.tenant, parseIdParam(req.params.doctorId), {
        input: req.body,
        ipAddress: req.ip,
    });
    res.json({ doctor });
}

async function setSpecialties(req, res) {
    const doctor = await doctorService.setDoctorSpecialties(req.tenant, parseIdParam(req.params.doctorId), {
        ids: req.body.specialtyIds,
        ipAddress: req.ip,
    });
    res.json({ doctor });
}

async function setServices(req, res) {
    const doctor = await doctorService.setDoctorServices(req.tenant, parseIdParam(req.params.doctorId), {
        ids: req.body.serviceIds,
        ipAddress: req.ip,
    });
    res.json({ doctor });
}

module.exports = { list, show, create, update, setSpecialties, setServices };
