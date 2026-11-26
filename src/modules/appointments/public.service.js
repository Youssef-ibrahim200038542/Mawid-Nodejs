// Public, unauthenticated read model for patients: clinic discovery, clinic page, availability.
// Only ACTIVE clinics, active doctors (with an active membership) and active services are shown,
// and only fields meant for the public (no member ids, licence numbers, emails of staff, audit…).
const prisma = require("../../config/database");
const { notFound } = require("../../lib/errors");
const time = require("../../lib/time");
const { getAvailability } = require("./availability.service");

async function resolvePublicClinic(slug) {
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 80) throw notFound();
    const clinic = await prisma.clinic.findFirst({
        where: { slug, status: "ACTIVE" },
        select: { id: true, slug: true, name: true, timezone: true, defaultLocale: true },
    });
    if (!clinic) throw notFound();
    return clinic;
}

async function listClinics({ q, city, page, pageSize }) {
    const where = {
        status: "ACTIVE",
        ...(q ? { name: { contains: q } } : {}),
        ...(city ? { city: { contains: city } } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.clinic.findMany({
            where,
            select: {
                slug: true,
                name: true,
                city: true,
                address: true,
                defaultLocale: true,
                specialties: { where: { isActive: true }, select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: "asc" }, take: 10 },
            },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.clinic.count({ where }),
    ]);
    return { items, page, pageSize, total };
}

async function getPublicClinic(slug) {
    const clinic = await resolvePublicClinic(slug);
    const [details, specialties, services, doctors, hours] = await Promise.all([
        prisma.clinic.findUnique({ where: { id: clinic.id }, select: { phone: true, email: true, address: true, city: true } }),
        prisma.specialty.findMany({ where: { clinicId: clinic.id, isActive: true }, select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: "asc" }, take: 200 }),
        prisma.service.findMany({
            where: { clinicId: clinic.id, isActive: true },
            select: { id: true, nameEn: true, nameAr: true, descriptionEn: true, descriptionAr: true, durationMinutes: true, priceMinor: true, currency: true },
            orderBy: { nameEn: "asc" },
            take: 200,
        }),
        prisma.doctorProfile.findMany({
            // Only bookable doctors are public: a not-yet-re-confirmed membership is hidden.
            where: { clinicId: clinic.id, isActive: true, member: { status: "ACTIVE", trustState: "TRUSTED" } },
            select: {
                id: true,
                displayNameEn: true,
                displayNameAr: true,
                titleEn: true,
                titleAr: true,
                bioEn: true,
                bioAr: true,
                yearsOfExperience: true,
                specialties: { where: { specialty: { isActive: true } }, select: { specialtyId: true } },
                services: { where: { service: { isActive: true } }, select: { serviceId: true } },
            },
            orderBy: { displayNameEn: "asc" },
            take: 200,
        }),
        prisma.workingHours.findMany({
            where: { clinicId: clinic.id, doctorId: null },
            select: { weekday: true, startMinute: true, endMinute: true },
            orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
        }),
    ]);

    return {
        clinic: { ...clinic, id: undefined, ...details },
        specialties,
        services: services.map((s) => ({ ...s, price: (s.priceMinor / 100).toFixed(2) })),
        doctors: doctors.map(({ specialties: sp, services: sv, ...doctor }) => ({
            ...doctor,
            specialtyIds: sp.map((x) => x.specialtyId),
            serviceIds: sv.map((x) => x.serviceId),
        })),
        workingHours: {
            timezone: clinic.timezone,
            intervals: hours.map((h) => ({ weekday: h.weekday, start: time.formatHHMM(h.startMinute), end: time.formatHHMM(h.endMinute) })),
        },
    };
}

async function getPublicAvailability(slug, { serviceId, doctorId, from, to }) {
    const clinic = await resolvePublicClinic(slug);
    return getAvailability({ clinic, serviceId, doctorId, fromDate: from, toDate: to, online: true });
}

module.exports = { resolvePublicClinic, listClinics, getPublicClinic, getPublicAvailability };
