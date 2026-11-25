// Booking rules in one place. Constants for v1; can become per-clinic settings later.
module.exports = Object.freeze({
    // Slot grid offered to patients (minutes between possible start times).
    slotStepMinutes: 15,
    // Any booked start time must sit on this boundary (staff may book off-grid, e.g. 09:05).
    startGranularityMinutes: 5,
    // Online bookings need at least this much notice; staff bookings only need to be in the future.
    onlineMinNoticeMinutes: 60,
    // How far ahead anyone can book.
    maxAdvanceDays: 90,
    // Patients may cancel/reschedule online until this many hours before the start.
    patientChangeMinHours: 2,
    // Anti-hoarding: active future appointments one patient may hold per clinic.
    maxActiveAppointmentsPerPatient: 5,
    // Availability query windows.
    maxStaffAvailabilityDays: 31,
    maxPublicAvailabilityDays: 14,
    // Statuses that occupy the doctor's time.
    activeStatuses: ["PENDING", "CONFIRMED"],
});
