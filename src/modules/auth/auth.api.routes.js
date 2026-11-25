// JSON auth for the React app. Same session cookie and rules as the EJS pages:
// bcrypt cost 12, session regenerated on login/signup (no fixation), fresh CSRF token per session.
const express = require("express");
const bcrypt = require("bcrypt");
const { z } = require("zod");
const prisma = require("../../config/database");
const { issueCsrfToken } = require("../../middleware/csrf");
const requireApiAuth = require("../../middleware/require-api-auth");
const validate = require("../../middleware/validate");
const { loginLimiter, signupLimiter } = require("../../middleware/rate-limit");
const { AppError, unauthenticated } = require("../../lib/errors");
const { isUniqueViolation } = require("../../lib/tenant-data");
const { establishSession, dummyPasswordHash, bcryptMaxBytes } = require("../../controllers/auth.controller");
const { listClinicsForUser } = require("../clinics/clinic.service");

const router = express.Router();
const userSelect = { id: true, name: true, email: true, platformRole: true, locale: true };

const password = z
    .string()
    .min(8, "Use at least 8 characters.")
    .refine((value) => Buffer.byteLength(value, "utf8") <= bcryptMaxBytes, "Password is too long.");
const email = z.email().max(255).transform((value) => value.trim().toLowerCase());
const locale = z.enum(["en", "ar"]);

const signupSchema = z.strictObject({ name: z.string().trim().min(2).max(100), email, password, locale: locale.optional() });
const loginSchema = z.strictObject({ email, password: z.string().min(1).max(1024) });
const updateMeSchema = z
    .strictObject({ name: z.string().trim().min(2).max(100).optional(), locale: locale.optional() })
    .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");

async function currentUserPayload(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) return null;
    return { user, clinics: await listClinicsForUser(user.id) };
}

router.get("/auth/csrf", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ csrfToken: issueCsrfToken(req) });
});

router.post("/auth/signup", signupLimiter, validate(signupSchema), async (req, res) => {
    const { name, email: address, password: plain, locale: chosenLocale } = req.body;
    let user;
    try {
        user = await prisma.user.create({
            data: { name, email: address, passwordHash: await bcrypt.hash(plain, 12), locale: chosenLocale || "en" },
            select: userSelect,
        });
    } catch (error) {
        if (isUniqueViolation(error)) throw new AppError(409, "EMAIL_TAKEN", "That email is already registered.");
        throw error;
    }
    await establishSession(req, user);
    res.set("Cache-Control", "no-store");
    res.status(201).json({ user, clinics: [], csrfToken: req.session.csrfToken });
});

router.post("/auth/login", loginLimiter, validate(loginSchema), async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email }, select: { ...userSelect, passwordHash: true } });
    // Always run bcrypt so response time doesn't reveal whether the account exists.
    const matches = await bcrypt.compare(req.body.password, user ? user.passwordHash : dummyPasswordHash);
    if (!user || !matches) throw new AppError(401, "INVALID_CREDENTIALS", "Wrong email or password.");

    await establishSession(req, user);
    res.set("Cache-Control", "no-store");
    res.json({ ...(await currentUserPayload(user.id)), csrfToken: req.session.csrfToken });
});

router.post("/auth/logout", (req, res, next) => {
    req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie("connect.sid");
        res.status(204).end();
    });
});

// Role and memberships are read from the database on every call, never from the client or session cache.
router.get("/auth/me", requireApiAuth, async (req, res, next) => {
    const payload = await currentUserPayload(req.session.user.id);
    if (!payload) return next(unauthenticated());
    res.set("Cache-Control", "no-store");
    res.json(payload);
});

router.patch("/auth/me", requireApiAuth, validate(updateMeSchema), async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.session.user.id }, data: req.body, select: userSelect });
    if (req.body.name) req.session.user = { ...req.session.user, name: user.name };
    res.json({ user });
});

module.exports = router;
