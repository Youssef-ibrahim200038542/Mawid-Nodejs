const express = require("express");
const { z } = require("zod");
const notifications = require("./notification.service");
const requireApiAuth = require("../../middleware/require-api-auth");
const validate = require("../../middleware/validate");
const { parseIdParam } = require("../../lib/tenant-data");

const router = express.Router();

const listQuery = z.strictObject({
    unreadOnly: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
const empty = z.strictObject({});

router.get("/me/notifications", requireApiAuth, validate(listQuery, "query"), async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await notifications.listMyNotifications(req.session.user.id, req.validatedQuery));
});

router.post("/me/notifications/read-all", requireApiAuth, validate(empty), async (req, res) => {
    res.json({ updated: await notifications.markAllRead(req.session.user.id) });
});

router.post("/me/notifications/:notificationId/read", requireApiAuth, validate(empty), async (req, res) => {
    await notifications.markRead(req.session.user.id, parseIdParam(req.params.notificationId));
    res.status(204).end();
});

module.exports = router;
