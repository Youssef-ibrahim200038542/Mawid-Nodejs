// Tracks work that runs after a response was sent (email delivery after a commit), so a
// graceful shutdown can wait for it instead of cutting a provider call in half.
const logger = require("./logger");

const inFlight = new Set();

function track(promise) {
    const tracked = Promise.resolve(promise)
        .catch((error) => logger.warn({ err: { name: error && error.name, code: error && error.code } }, "Background work failed"))
        .finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
    return tracked;
}

// Runs `work` on the next tick, tracked.
function runAfterResponse(work) {
    return track(new Promise((resolve) => setImmediate(resolve)).then(work));
}

async function drain(timeoutMs) {
    if (inFlight.size === 0) return true;
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref();
    });
    const done = Promise.allSettled([...inFlight]).then(() => true);
    const finished = await Promise.race([done, timeout]);
    clearTimeout(timer);
    return finished;
}

function pendingCount() {
    return inFlight.size;
}

module.exports = { track, runAfterResponse, drain, pendingCount };
