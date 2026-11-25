const express = require("express");
const eventController = require("../controllers/event.controller");
const requireAuth = require("../middleware/require-auth");
const { publicRegistrationLimiter } = require("../middleware/rate-limit");

const router = express.Router();

router.get("/dashboard", requireAuth, eventController.showDashboard);
router.get("/events/new", requireAuth, eventController.showCreateForm);
router.post("/events", requireAuth, eventController.createEvent);
router.get("/events/:slug/attendees", requireAuth, eventController.showAttendees);
router.get("/events/:slug", eventController.showPublicEvent);
router.post("/events/:slug/register", publicRegistrationLimiter, eventController.register);

module.exports = router;
