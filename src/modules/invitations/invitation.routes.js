// Invitation endpoints.
//   tenantRouter  — mounted under /api/v1/clinics/:clinicSlug (after requireApiAuth + loadTenant):
//                   owners (members:manage) create / list / resend / revoke invitations and ask a
//                   legacy member to re-confirm.
//   publicRouter  — /api/v1/invitations/{preview,accept,decline}: the invitee, identified by the
//                   token in the request body plus (for accept / decline) a verified login.
const express = require("express");
const service = require("./invitation.service");
const schemas = require("./invitation.schemas");
const validate = require("../../middleware/validate");
const requireApiAuth = require("../../middleware/require-api-auth");
const { requirePermission } = require("../../middleware/tenant");
const { createLimiter } = require("../../middleware/rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { parseIdParam } = require("../../lib/tenant-data");

const HOUR = 60 * 60 * 1000;
const ownerClinicCreateLimiter = createLimiter({
    windowMs: HOUR,
    limit: 20,
    keyGenerator: (req) => `inv-create:u:${req.tenant.userId}:c:${req.tenant.clinicId}`,
});
const clinicCreateLimiter = createLimiter({ windowMs: 24 * HOUR, limit: 100, keyGenerator: (req) => `inv-create:c:${req.tenant.clinicId}` });
const inviteeIpLimiter = createLimiter({ windowMs: 15 * 60 * 1000, limit: 20, keyGenerator: (req) => `inv-ip:${ipKeyGenerator(req.ip)}` });
const inviteeUserLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => `inv-user:${req.session.user.id}`,
});

const tenantRouter = express.Router();
const canManage = requirePermission("members:manage");

tenantRouter.get("/invitations", canManage, async (req, res) => {
    res.json(await service.listInvitations(req.tenant));
});

tenantRouter.post("/invitations", canManage, ownerClinicCreateLimiter, clinicCreateLimiter, validate(schemas.createInvitationSchema), async (req, res) => {
    res.status(201).json(await service.createInvitation(req.tenant, { input: req.body, ipAddress: req.ip }));
});

tenantRouter.post("/invitations/:invitationId/resend", canManage, validate(schemas.emptySchema), async (req, res) => {
    res.json(await service.resendInvitation(req.tenant, parseIdParam(req.params.invitationId), { ipAddress: req.ip }));
});

tenantRouter.post("/invitations/:invitationId/revoke", canManage, validate(schemas.emptySchema), async (req, res) => {
    res.json(await service.revokeInvitation(req.tenant, parseIdParam(req.params.invitationId), { ipAddress: req.ip }));
});

tenantRouter.post("/members/:memberId/reconfirmations", canManage, validate(schemas.emptySchema), async (req, res) => {
    const result = await service.requestReconfirmation({
        clinicId: req.tenant.clinicId,
        memberId: parseIdParam(req.params.memberId),
        actorUserId: req.tenant.userId,
        ipAddress: req.ip,
    });
    res.status(201).json(result);
});

const publicRouter = express.Router();

publicRouter.post("/invitations/preview", inviteeIpLimiter, validate(schemas.tokenSchema), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const viewer = req.session && req.session.user ? req.session.user.id : null;
    res.json(await service.previewInvitation(req.body.token, viewer));
});

publicRouter.post("/invitations/accept", inviteeIpLimiter, requireApiAuth, inviteeUserLimiter, validate(schemas.tokenSchema), async (req, res) => {
    res.json(await service.respondToInvitation(req.session.user.id, req.body.token, "accept", { ipAddress: req.ip }));
});

publicRouter.post("/invitations/decline", inviteeIpLimiter, requireApiAuth, inviteeUserLimiter, validate(schemas.tokenSchema), async (req, res) => {
    await service.respondToInvitation(req.session.user.id, req.body.token, "decline", { ipAddress: req.ip });
    res.status(204).end();
});

module.exports = { tenantRouter, publicRouter };
