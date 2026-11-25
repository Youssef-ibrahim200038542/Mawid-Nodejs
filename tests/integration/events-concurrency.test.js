const { prisma, resetTestData, createUser, startServer, stopServer, createClient } = require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

let server;
let baseUrl;

test.before(async () => {
    await resetTestData();
    ({ server, baseUrl } = await startServer());
});

test.after(async () => {
    await resetTestData();
    await stopServer(server);
});

// Proves the row-lock pattern (SELECT … FOR UPDATE inside a transaction) that the appointment
// engine will reuse: simultaneous requests can never exceed capacity.
test("concurrent registrations never exceed event capacity", async () => {
    const organizer = await createUser();
    const event = await prisma.event.create({
        data: { organizerId: organizer.id, slug: "race-event", title: "Race", startsAt: new Date("2030-01-01T10:00:00Z"), capacity: 3 },
    });

    const attempts = 15;
    const responses = await Promise.all(
        Array.from({ length: attempts }, (_, index) =>
            createClient(baseUrl).post("/events/race-event/register", {
                form: { name: `Guest ${index}`, email: `guest-${index}@example.test` },
            })
        )
    );

    const statuses = responses.map((res) => res.status);
    assert.equal(statuses.filter((s) => s === 303).length, 3, `statuses: ${statuses}`);
    assert.equal(statuses.filter((s) => s === 409).length, attempts - 3, `statuses: ${statuses}`);
    assert.equal(await prisma.registration.count({ where: { eventId: event.id } }), 3);
});

test("the same email cannot register twice, even concurrently", async () => {
    const organizer = await createUser();
    const event = await prisma.event.create({
        data: { organizerId: organizer.id, slug: "dup-event", title: "Dup", startsAt: new Date("2030-01-01T10:00:00Z"), capacity: 10 },
    });

    const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
            createClient(baseUrl).post("/events/dup-event/register", { form: { name: "Same", email: "same@example.test" } })
        )
    );

    assert.equal(responses.filter((res) => res.status === 303).length, 1);
    assert.equal(await prisma.registration.count({ where: { eventId: event.id } }), 1);
});
