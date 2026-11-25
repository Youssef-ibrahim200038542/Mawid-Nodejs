const appointmentService = require("./appointment.service");
const { getAvailability } = require("./availability.service");
const { parseIdParam } = require("../../lib/tenant-data");

const clinicOf = (tenant) => ({ id: tenant.clinicId, timezone: tenant.timezone });

async function availability(req, res) {
    const { serviceId, doctorId, from, to } = req.validatedQuery;
    res.json(await getAvailability({ clinic: clinicOf(req.tenant), serviceId, doctorId, fromDate: from, toDate: to, online: false }));
}

async function list(req, res) {
    res.json(await appointmentService.listAppointments(req.tenant, req.validatedQuery));
}

async function show(req, res) {
    res.json({ appointment: await appointmentService.getAppointment(req.tenant, parseIdParam(req.params.appointmentId)) });
}

async function create(req, res) {
    const appointment = await appointmentService.createStaffAppointment(req.tenant, { input: req.body, ipAddress: req.ip });
    res.status(201).json({ appointment });
}

function statusAction(action) {
    return async function changeStatus(req, res) {
        const appointment = await appointmentService.changeStatus(req.tenant, parseIdParam(req.params.appointmentId), action, {
            reason: req.body.reason,
            ipAddress: req.ip,
        });
        res.json({ appointment });
    };
}

async function reschedule(req, res) {
    const appointment = await appointmentService.rescheduleByStaff(req.tenant, parseIdParam(req.params.appointmentId), {
        input: req.body,
        ipAddress: req.ip,
    });
    res.json({ appointment });
}

module.exports = { availability, list, show, create, statusAction, reschedule };
