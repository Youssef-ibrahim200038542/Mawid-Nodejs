const clinicService = require("./clinic.service");

async function create(req, res) {
    const clinic = await clinicService.createClinic({
        actorUserId: req.session.user.id,
        ipAddress: req.ip,
        input: req.body,
    });
    res.status(201).json({ clinic: { ...clinic, role: "OWNER" } });
}

async function listMine(req, res) {
    res.json({ clinics: await clinicService.listClinicsForUser(req.session.user.id) });
}

async function show(req, res) {
    const clinic = await clinicService.getClinic(req.tenant);
    res.json({ clinic: { ...clinic, role: req.tenant.role } });
}

async function update(req, res) {
    const clinic = await clinicService.updateClinic(req.tenant, { ipAddress: req.ip, input: req.body });
    res.json({ clinic: { ...clinic, role: req.tenant.role } });
}

async function members(req, res) {
    res.json(await clinicService.listMembers(req.tenant, req.validatedQuery));
}

module.exports = { create, listMine, show, update, members };
