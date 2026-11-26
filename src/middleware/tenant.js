const prisma = require("../config/database");
const { AppError, notFound, forbidden } = require("../lib/errors");
const { hasPermission } = require("../lib/permissions");

// Resolves the clinic from the URL slug AND the logged-in user's active membership.
// Any clinicId in the body or query is ignored. A user who is not a member gets 404,
// so the response does not confirm that the clinic's private resources exist.
// Account security (H1): the member's email must be verified and the membership itself TRUSTED
// (created by a verified clinic creator, or accepted through an invitation / re-confirmation).
// Memberships from before account security are LEGACY_UNREVIEWED and stay closed — for every
// role — until the member accepts a re-confirmation; a verified email alone is not enough.
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
            trustState: true,
            user: { select: { emailVerifiedAt: true } },
            clinic: { select: { id: true, slug: true, timezone: true } },
        },
    });

    if (!membership) {
        return next(notFound());
    }
    if (!membership.user.emailVerifiedAt) {
        return next(new AppError(403, "EMAIL_NOT_VERIFIED", "Confirm your email address to open this clinic."));
    }
    if (membership.trustState !== "TRUSTED") {
        return next(new AppError(403, "MEMBERSHIP_RECONFIRMATION_REQUIRED", "Your access to this clinic must be re-confirmed. The clinic will send you a confirmation link."));
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

// Passes if the member has at least one of the permissions. Used where the service then applies
// an ownership rule (e.g. "schedule:manage" or "schedule:manage_own" for the doctor's own profile).
function requireAnyPermission(...permissions) {
    return function checkAnyPermission(req, res, next) {
        if (!req.tenant || !permissions.some((permission) => hasPermission(req.tenant.role, permission))) {
            return next(forbidden());
        }
        next();
    };
}

module.exports = { loadTenant, requirePermission, requireAnyPermission };
