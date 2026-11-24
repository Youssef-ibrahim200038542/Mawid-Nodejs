const eventUrl = process.argv[2] || process.env.RACE_URL;

if (!eventUrl) {
    console.error("Usage: node scripts/race.js <public-event-url>");
    process.exit(1);
}

const registrationUrl = new URL(eventUrl);
registrationUrl.pathname = `${registrationUrl.pathname.replace(/\/$/, "")}/register`;

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const requests = Array.from({ length: 20 }, (_, index) => {
    const form = new URLSearchParams({
        name: `Race Attendee ${index + 1}`,
        email: `race-${runId}-${index + 1}@example.com`,
    });

    return fetch(registrationUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        redirect: "manual",
    });
});

Promise.all(requests)
    .then((responses) => {
        const registered = responses.filter((response) => response.status === 303).length;
        const full = responses.filter((response) => response.status === 409).length;
        const unexpected = responses.filter(
            (response) => response.status !== 303 && response.status !== 409,
        );

        console.log(`Sent 20 concurrent registrations: ${registered} registered, ${full} rejected as full.`);
        if (unexpected.length > 0) {
            console.error(`Unexpected response status(es): ${unexpected.map((response) => response.status).join(", ")}`);
            process.exitCode = 1;
        }
    })
    .catch((error) => {
        console.error(`Could not complete the registration race: ${error.message}`);
        process.exitCode = 1;
    });
