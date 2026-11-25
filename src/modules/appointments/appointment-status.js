// Appointment lifecycle. Pure: which action is allowed from which status.
//
//   PENDING ──confirm──▶ CONFIRMED ──complete──▶ COMPLETED
//      │                    │  └────no_show───▶ NO_SHOW
//      └──cancel──▶ CANCELLED ◀──cancel──┘
//   reschedule: PENDING/CONFIRMED → new time (same status for staff; PENDING for patients)
const { AppError } = require("../../lib/errors");

const transitions = {
    confirm: { from: ["PENDING"], to: "CONFIRMED" },
    cancel: { from: ["PENDING", "CONFIRMED"], to: "CANCELLED" },
    complete: { from: ["CONFIRMED"], to: "COMPLETED", requiresStarted: true },
    no_show: { from: ["CONFIRMED"], to: "NO_SHOW", requiresStarted: true },
    reschedule: { from: ["PENDING", "CONFIRMED"] },
};

function assertTransition(action, appointment, now = new Date()) {
    const rule = transitions[action];
    if (!rule) throw new Error(`Unknown appointment action: ${action}`);
    if (!rule.from.includes(appointment.status)) {
        throw new AppError(409, "INVALID_STATUS_TRANSITION", `A ${appointment.status.toLowerCase()} appointment can't be changed that way.`);
    }
    if (rule.requiresStarted && appointment.startsAt > now) {
        throw new AppError(409, "APPOINTMENT_NOT_STARTED", "This can only be recorded once the appointment time has started.");
    }
    return rule.to;
}

module.exports = { transitions, assertTransition };
