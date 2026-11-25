const specialtyService = require("./specialty.service");
const { parseIdParam } = require("../../lib/tenant-data");

async function list(req, res) {
    res.json({ specialties: await specialtyService.listSpecialties(req.tenant, req.validatedQuery) });
}

async function create(req, res) {
    const specialty = await specialtyService.createSpecialty(req.tenant, { input: req.body, ipAddress: req.ip });
    res.status(201).json({ specialty });
}

async function update(req, res) {
    const specialty = await specialtyService.updateSpecialty(req.tenant, parseIdParam(req.params.specialtyId), {
        input: req.body,
        ipAddress: req.ip,
    });
    res.json({ specialty });
}

module.exports = { list, create, update };
