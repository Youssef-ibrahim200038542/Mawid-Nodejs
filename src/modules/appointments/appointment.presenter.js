const time = require("../../lib/time");

const appointmentSelect = {
    id: true,
    clinicId: true,
    doctorId: true,
    serviceId: true,
    patientId: true,
    startsAt: true,
    endsAt: true,
    status: true,
    source: true,
    durationMinutes: true,
    priceMinor: true,
    currency: true,
    note: true,
    confirmedAt: true,
    cancelledAt: true,
    cancellationReason: true,
    rescheduleCount: true,
    createdAt: true,
    doctor: { select: { id: true, displayNameEn: true, displayNameAr: true } },
    service: { select: { id: true, nameEn: true, nameAr: true } },
    patient: { select: { id: true, fullName: true, phone: true, email: true, userId: true } },
};

const iso = (date) => (date ? date.toISOString() : null);

function presentAppointment(row, zone, { includePatient = true, clinic = null } = {}) {
    const result = {
        id: row.id,
        status: row.status,
        source: row.source,
        startsAt: iso(row.startsAt),
        endsAt: iso(row.endsAt),
        startsAtLocal: time.utcToLocalIso(row.startsAt, zone),
        endsAtLocal: time.utcToLocalIso(row.endsAt, zone),
        timezone: zone,
        durationMinutes: row.durationMinutes,
        price: (row.priceMinor / 100).toFixed(2),
        priceMinor: row.priceMinor,
        currency: row.currency,
        note: row.note,
        confirmedAt: iso(row.confirmedAt),
        cancelledAt: iso(row.cancelledAt),
        cancellationReason: row.cancellationReason,
        rescheduleCount: row.rescheduleCount,
        createdAt: iso(row.createdAt),
        doctor: row.doctor,
        service: row.service,
    };
    if (includePatient && row.patient) {
        const { userId, ...patient } = row.patient;
        result.patient = { ...patient, hasAccount: userId !== null };
    }
    if (clinic) result.clinic = clinic;
    return result;
}

module.exports = { appointmentSelect, presentAppointment };
