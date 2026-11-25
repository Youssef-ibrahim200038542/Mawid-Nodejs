const prisma = require("../config/database");
const { notFound, forbidden } = require("../lib/errors");
const { hasPermission } = require("../lib/permissions");

// Resolves the clinic from the URL slug AND the logged-in user's active membership.
// Any clinicId in the body or query is ignored. A user who is not a member gets 404,
// so the response does not confirm that the clinic's private resources exist.
async function loadTenant(req, res, next) {
    const slug = req.params.clinicSlug;
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 80) {
        return next(notFound());
    }

    const membership = await prisma.clinicMember.findFirst({
        where: {
            userId: req.session.user.id,
            status: "ACTIVE",
            clinic: { slug, status: "ACTIVE" },
        },
        select: {
            id: true,
            role: true,
            clinic: { select: { id: true, slug: true, timezone: true } },
        },
    });

    if (!membership) {
        return next(notFound());
    }

    req.tenant = Object.freeze({
        clinicId: membership.clinic.id,
        clinicSlug: membership.clinic.slug,
        timezone: membership.clinic.timezone,
        memberId: membership.id,
        role: membership.role,
        userId: req.session.user.id,
    });
    next();
}

function requirePermission(permission) {
    return function checkPermission(req, res, next) {
        if (!req.tenant || !hasPermission(req.tenant.role, permission)) {
            return next(forbidden());
        }
        next();
    };
}

module.exports = { loadTenant, requirePermission };
