const { randomBytes } = require("node:crypto");
const Event = require("../models/event.model");

async function showDashboard(req, res) {
    const events = await Event.findForOrganizer(req.session.user.id);
    res.render("dashboard", { events });
}

function showCreateForm(req, res) {
    res.render("event-new", { error: null, values: {} });
}

async function createEvent(req, res) {
    const body = req.body || {};
    const title = (body.title || "").trim();
    const location = (body.location || "").trim();
    const startsAt = new Date(body.startsAt);
    const capacity = Number(body.capacity);
    const values = {
        title,
        location,
        startsAt: typeof body.startsAt === "string" ? body.startsAt : "",
        capacity: typeof body.capacity === "string" ? body.capacity : "",
    };

    if (!title || title.length > 200) {
        return res.status(400).render("event-new", {
            error: "Enter an event title with no more than 200 characters.",
            values,
        });
    }

    if (location.length > 255) {
        return res.status(400).render("event-new", {
            error: "Location must be no more than 255 characters.",
            values,
        });
    }

    if (!body.startsAt || Number.isNaN(startsAt.getTime())) {
        return res.status(400).render("event-new", {
            error: "Enter a valid event date and time.",
            values,
        });
    }

    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 2147483647) {
        return res.status(400).render("event-new", {
            error: "Capacity must be a positive whole number.",
            values,
        });
    }

    const slugBase = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 90) || "event";
    const slug = `${slugBase}-${randomBytes(6).toString("hex")}`;

    await Event.create({
        organizerId: req.session.user.id,
        slug,
        title,
        location: location || null,
        startsAt,
        capacity,
    });

    res.redirect("/dashboard");
}

async function showPublicEvent(req, res) {
    const event = await Event.findPublicBySlug(req.params.slug);
    if (!event) {
        return res.status(404).render("not-found");
    }

    res.render("event-public", {
        event,
        success: req.query.registered === "1",
        error: null,
    });
}

async function register(req, res) {
    const event = await Event.findPublicBySlug(req.params.slug);
    if (!event) {
        return res.status(404).render("not-found");
    }

    const body = req.body || {};
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();

    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
        return res.status(400).render("event-public", {
            event,
            success: false,
            error: "Enter a name and a valid email address.",
        });
    }

    const result = await Event.register(req.params.slug, name, email);
    if (result.status === "not-found") {
        return res.status(404).render("not-found");
    }
    if (result.status === "full") {
        event._count.registrations = event.capacity;
        return res.status(409).render("event-public", {
            event,
            success: false,
            error: "Sorry, this event has reached capacity.",
        });
    }

    if (result.status === "duplicate") {
        return res.status(409).render("event-public", {
            event,
            success: false,
            error: "This email address is already registered for the event.",
        });
    }

    res.redirect(303, `${req.baseUrl}/events/${req.params.slug}?registered=1`);
}

async function showAttendees(req, res) {
    const event = await Event.findWithAttendees(req.params.slug, req.session.user.id);
    if (!event) {
        return res.status(404).render("not-found");
    }

    res.render("event-attendees", { event });
}

module.exports = {
    showDashboard,
    showCreateForm,
    createEvent,
    showPublicEvent,
    register,
    showAttendees,
};
