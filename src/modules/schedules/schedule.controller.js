const scheduleService = require("./schedule.service");
const { parseIdParam } = require("../../lib/tenant-data");

async function clinicHours(req, res) {
    res.json(await scheduleService.getClinicHours(req.tenant));
}

async function replaceClinicHours(req, res) {
    res.json(await scheduleService.replaceClinicHours(req.tenant, { intervals: req.body.intervals, ipAddress: req.ip }));
}

async function doctorHours(req, res) {
    res.json(await scheduleService.getDoctorHours(req.tenant, parseIdParam(req.params.doctorId)));
}

async function replaceDoctorHours(req, res) {
    res.json(
        await scheduleService.replaceDoctorHours(req.tenant, parseIdParam(req.params.doctorId), {
            intervals: req.body.intervals,
            ipAddress: req.ip,
        })
    );
}

async function listExceptions(req, res) {
    res.json(await scheduleService.listExceptions(req.tenant, req.validatedQuery));
}

async function createException(req, res) {
    const exception = await scheduleService.createException(req.tenant, { input: req.body, ipAddress: req.ip });
    res.status(201).json({ exception });
}

async function deleteException(req, res) {
    await scheduleService.deleteException(req.tenant, parseIdParam(req.params.exceptionId), { ipAddress: req.ip });
    res.status(204).end();
}

module.exports = {
    clinicHours,
    replaceClinicHours,
    doctorHours,
    replaceDoctorHours,
    listExceptions,
    createException,
    deleteException,
};
