const express = require("express");
const prisma = require("../../config/database");
const { issueCsrfToken } = require("../../middleware/csrf");
const requireApiAuth = require("../../middleware/require-api-auth");
const { unauthenticated } = require("../../lib/errors");
const { listClinicsForUser } = require("../clinics/clinic.service");

const router = express.Router();

router.get("/auth/csrf", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ csrfToken: issueCsrfToken(req) });
});

// Role and memberships are read from the database on every call, never from the client or session cache.
router.get("/auth/me", requireApiAuth, async (req, res, next) => {
    const user = await prisma.user.findUnique({
        where: { id: req.session.user.id },
        select: { id: true, name: true, email: true, platformRole: true, locale: true },
    });
    if (!user) {
        return next(unauthenticated());
    }

    res.set("Cache-Control", "no-store");
    res.json({ user, clinics: await listClinicsForUser(user.id) });
});

module.exports = router;
