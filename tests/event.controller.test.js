const test = require("node:test");
const assert = require("node:assert/strict");
const Event = require("../src/models/event.model");
const eventController = require("../src/controllers/event.controller");

function stubEvent(t, overrides) {
    const originals = { ...Event };
    Object.assign(Event, overrides);
    t.after(() => Object.assign(Event, originals));
}

function makeRequest({ body = {}, params = {}, query = {} } = {}) {
    return {
        body,
        params,
        query,
        baseUrl: "",
        session: { user: { id: 7, name: "Organizer" } },
    };
}

function makeResponse() {
    return {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        render(view, locals) {
            this.view = view;
            this.locals = locals;
            return this;
        },
        redirect(statusOrPath, path) {
            if (path === undefined) {
                this.redirectedTo = statusOrPath;
            } else {
                this.redirectStatus = statusOrPath;
                this.redirectedTo = path;
            }
            return this;
        },
    };
}

const publicEvent = {
    id: 1,
    slug: "launch-abc123",
    title: "Launch",
    capacity: 3,
    startsAt: new Date("2026-12-01T18:00:00Z"),
    organizer: { name: "Organizer" },
    _count: { registrations: 1 },
};

test("createEvent rejects invalid capacity and keeps the entered values", async (t) => {
    let created = false;
    stubEvent(t, { create: async () => { created = true; } });

    const res = makeResponse();
    await eventController.createEvent(
        makeRequest({ body: { title: "Launch", startsAt: "2026-12-01T18:00", capacity: "0" } }),
        res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.view, "event-new");
    assert.match(res.locals.error, /Capacity/);
    assert.equal(res.locals.values.title, "Launch");
    assert.equal(created, false);
});

test("createEvent stores the event for the organizer with a unique slug", async (t) => {
    let data;
    stubEvent(t, { create: async (input) => { data = input; } });

    const res = makeResponse();
    await eventController.createEvent(
        makeRequest({ body: { title: "Big Launch!", startsAt: "2026-12-01T18:00", capacity: "20" } }),
        res,
    );

    assert.equal(res.redirectedTo, "/dashboard");
    assert.equal(data.organizerId, 7);
    assert.equal(data.capacity, 20);
    assert.match(data.slug, /^big-launch-[0-9a-f]{12}$/);
});

test("register rejects missing name or invalid email without writing", async (t) => {
    let registered = false;
    stubEvent(t, {
        findPublicBySlug: async () => ({ ...publicEvent }),
        register: async () => { registered = true; },
    });

    const res = makeResponse();
    await eventController.register(
        makeRequest({ params: { slug: publicEvent.slug }, body: { name: "", email: "nope" } }),
        res,
    );

    assert.equal(res.statusCode, 400);
    assert.equal(registered, false);
});

test("register redirects with 303 on success", async (t) => {
    stubEvent(t, {
        findPublicBySlug: async () => ({ ...publicEvent }),
        register: async () => ({ status: "registered" }),
    });

    const res = makeResponse();
    await eventController.register(
        makeRequest({ params: { slug: publicEvent.slug }, body: { name: "Sara", email: "Sara@Example.com" } }),
        res,
    );

    assert.equal(res.redirectStatus, 303);
    assert.equal(res.redirectedTo, `/events/${publicEvent.slug}?registered=1`);
});

test("register returns 409 when the event is full or the email is taken", async (t) => {
    for (const status of ["full", "duplicate"]) {
        stubEvent(t, {
            findPublicBySlug: async () => ({ ...publicEvent, _count: { registrations: 1 } }),
            register: async () => ({ status }),
        });

        const res = makeResponse();
        await eventController.register(
            makeRequest({ params: { slug: publicEvent.slug }, body: { name: "Sara", email: "sara@example.com" } }),
            res,
        );

        assert.equal(res.statusCode, 409, status);
        assert.equal(res.view, "event-public");
    }
});

test("showAttendees only finds events owned by the logged-in organizer", async (t) => {
    let args;
    stubEvent(t, { findWithAttendees: async (...input) => { args = input; return null; } });

    const res = makeResponse();
    await eventController.showAttendees(makeRequest({ params: { slug: "someone-elses" } }), res);

    assert.deepEqual(args, ["someone-elses", 7]);
    assert.equal(res.statusCode, 404);
});
