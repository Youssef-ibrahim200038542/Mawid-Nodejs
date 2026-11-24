const prisma = require("../config/database");

async function findForOrganizer(organizerId) {
    return prisma.event.findMany({
        where: { organizerId },
        include: {
            _count: {
                select: { registrations: true },
            },
        },
        orderBy: { startsAt: "asc" },
    });
}

async function create(data) {
    return prisma.event.create({ data });
}

async function findPublicBySlug(slug) {
    return prisma.event.findUnique({
        where: { slug },
        include: {
            organizer: {
                select: { name: true },
            },
            _count: {
                select: { registrations: true },
            },
        },
    });
}

async function findWithAttendees(slug, organizerId) {
    return prisma.event.findFirst({
        where: { slug, organizerId },
        include: {
            registrations: {
                orderBy: { createdAt: "asc" },
            },
        },
    });
}

async function register(slug, name, email) {
    try {
        return await prisma.$transaction(async (tx) => {
            const lockedEvents = await tx.$queryRaw`
                SELECT id FROM events WHERE slug = ${slug} FOR UPDATE
            `;

            if (lockedEvents.length === 0) {
                return { status: "not-found" };
            }

            const event = await tx.event.findUnique({ where: { slug } });
            const registrationCount = await tx.registration.count({
                where: { eventId: event.id },
            });

            if (registrationCount >= event.capacity) {
                return { status: "full" };
            }

            await tx.registration.create({
                data: { eventId: event.id, name, email },
            });

            return { status: "registered" };
        });
    } catch (error) {
        if (error.code === "P2002") {
            return { status: "duplicate" };
        }
        throw error;
    }
}

module.exports = {
    findForOrganizer,
    create,
    findPublicBySlug,
    findWithAttendees,
    register,
};
