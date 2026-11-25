const serviceLogic = require("./clinic-service.service");
const { parseIdParam } = require("../../lib/tenant-data");

async function list(req, res) {
    res.json({ services: await serviceLogic.listServices(req.tenant, req.validatedQuery) });
}

async function show(req, res) {
    res.json({ service: await serviceLogic.getService(req.tenant, parseIdParam(req.params.serviceId)) });
}

async function create(req, res) {
    const service = await serviceLogic.createService(req.tenant, { input: req.body, ipAddress: req.ip });
    res.status(201).json({ service });
}

async function update(req, res) {
    const service = await serviceLogic.updateService(req.tenant, parseIdParam(req.params.serviceId), {
        input: req.body,
        ipAddress: req.ip,
    });
    res.json({ service });
}

module.exports = { list, show, create, update };
