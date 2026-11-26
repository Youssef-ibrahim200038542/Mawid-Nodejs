// JSON auth for the React app. Same session cookie and rules as the EJS pages:
// bcrypt cost 12, session regenerated on login (no fixation), fresh CSRF token per session,
// session_version snapshot (see account.service.confirmLoginSnapshot), generic signup /
// forgot-password answers that never reveal whether an address has an account.
const express = require("express");
const bcrypt = require("bcrypt");
const { z } = require("zod");
const prisma = require("../../config/database");
const { issueCsrfToken } = require("../../middleware/csrf");
const requireApiAuth = require("../../middleware/require-api-auth");
const validate = require("../../middleware/validate");
const { loginLimiter, signupLimiter, createLimiter } = require("../../middleware/rate-limit");
const { AppError, unauthenticated } = require("../../lib/errors");
const { establishSession, dummyPasswordHash, bcryptMaxBytes } = require("../../controllers/auth.controller");
const { listClinicsForUser } = require("../clinics/clinic.service");
const accountService = require("./account.service");

const router = express.Router();
const userSelect = { id: true, name: true, email: true, platformRole: true, locale: true, emailVerifiedAt: true };

const forgotLimiter = createLimiter({ windowMs: 60 * 60 * 1000, limit: 5 });
const tokenAttemptLimiter = createLimiter({ windowMs: 15 * 60 * 1000, limit: 20 });
const resendLimiter = createLimiter({ windowMs: 60 * 60 * 1000, limit: 3, keyByUser: true });

const password = z
    .string()
    .min(8, "Use at least 8 characters.")
    .refine((value) => Buffer.byteLength(value, "utf8") <= bcryptMaxBytes, "Password is too long.");
const email = z.email().max(255).transform((value) => value.trim().toLowerCase());
const locale = z.enum(["en", "ar"]);
const token = z.string().min(1).max(100);

const signupSchema = z.strictObject({ name: z.string().trim().min(2).max(100), email, password, locale: locale.optional() });
const loginSchema = z.strictObject({ email, password: z.string().min(1).max(1024) });
const updateMeSchema = z
    .strictObject({ name: z.string().trim().min(2).max(100).optional(), locale: locale.optional() })
    .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");
const tokenSchema = z.strictObject({ token });
const forgotSchema = z.strictObject({ email });
const resetSchema = z.strictObject({ token, password });
const emptySchema = z.strictObject({});

function presentUser({ emailVerifiedAt, ...user }) {
    return { ...user, emailVerified: emailVerifiedAt !== null };
}

async function currentUserPayload(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) return null;
    return { user: presentUser(user), clinics: await listClinicsForUser(user.id) };
}

const accepted = { status: "check_email", message: "If this address can be used, we've sent a link to it. Check your inbox." };

router.get("/auth/csrf", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ csrfToken: issueCsrfToken(req) });
});

router.post("/auth/signup", signupLimiter, validate(signupSchema), async (req, res) => {
    const { name, email: address, password: plain, locale: chosenLocale } = req.body;
    await accountService.register({ name, email: address, password: plain, locale: chosenLocale || "en", ipAddress: req.ip });
    res.set("Cache-Control", "no-store");
    res.status(202).json(accepted);
});

router.post("/auth/login", loginLimiter, validate(loginSchema), async (req, res) => {
    // Snapshot: hash and session version in one read, before the comparison.
    const user = await prisma.user.findUnique({ where: { email: req.body.email }, select: { ...userSelect, passwordHash: true, sessionVersion: true } });
    // Always run bcrypt so response time doesn't reveal whether the account exists.
    const matches = await bcrypt.compare(req.body.password, user ? user.passwordHash : dummyPasswordHash);
    if (!user || !matches) throw new AppError(401, "INVALID_CREDENTIALS", "Wrong email or password.");

    await establishSession(req, user, { sv: user.sessionVersion });
    await accountService.confirmLoginSnapshot(req, { id: user.id, passwordHash: user.passwordHash, sessionVersion: user.sessionVersion });
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

router.post("/auth/verify-email", tokenAttemptLimiter, validate(tokenSchema), async (req, res) => {
    await accountService.verifyEmail(req.body.token, { ipAddress: req.ip });
    res.set("Cache-Control", "no-store");
    res.json({ verified: true });
});

router.post("/auth/verify-email/resend", requireApiAuth, resendLimiter, validate(emptySchema), async (req, res) => {
    const delivery = await accountService.resendVerification(req.session.user.id, { ipAddress: req.ip });
    res.json({ delivery });
});

router.post("/auth/password/forgot", forgotLimiter, validate(forgotSchema), async (req, res) => {
    await accountService.requestPasswordReset({ email: req.body.email, ipAddress: req.ip });
    res.set("Cache-Control", "no-store");
    res.status(202).json(accepted);
});

router.post("/auth/password/reset", tokenAttemptLimiter, validate(resetSchema), async (req, res) => {
    await accountService.resetPassword(req.body.token, req.body.password, { ipAddress: req.ip });
    res.set("Cache-Control", "no-store");
    res.status(204).end();
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
    res.json({ user: presentUser(user) });
});

module.exports = router;
