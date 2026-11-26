const { assertProductionConfig } = require("./config/startup-checks");
const { productionProviders } = require("./modules/notifications/email-provider");

// Fail fast, before anything listens: production needs a real email provider and an https web URL.
assertProductionConfig(process.env, { knownProviders: productionProviders });

const app = require("./app");
const prisma = require("./config/database");
const logger = require("./lib/logger");
const background = require("./lib/background-work");
const { startDeliveryRecovery, stopDeliveryRecovery } = require("./modules/auth/auth-delivery");

const port = process.env.PORT || 3000;
const shutdownTimeoutMs = 10_000;

async function start() {
    try {
        await prisma.$queryRaw`SELECT 1`;
        logger.info("Connected to MySQL");
    } catch (err) {
        logger.fatal({ err }, "Could not connect to MySQL");
        process.exit(1);
    }

    const server = app.listen(port, () => {
        logger.info({ port }, "Mawid is running");
    });

    server.on("error", (err) => {
        logger.fatal({ err }, "HTTP server failed");
        process.exit(1);
    });

    // Re-sends account emails interrupted by a crash or a transient provider failure.
    startDeliveryRecovery();

    let shuttingDown = false;
    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal }, "Shutting down");

        setTimeout(() => {
            logger.error("Shutdown timed out, forcing exit");
            process.exit(1);
        }, shutdownTimeoutMs).unref();

        server.close(async () => {
            // Stop claiming new deliveries, then let in-flight sends finish (provider timeout is 8 s).
            // Anything cut off stays QUEUED/SENDING in the database and is recovered on the next start.
            await stopDeliveryRecovery().catch((err) => logger.error({ err }, "Stopping delivery recovery failed"));
            const drained = await background.drain(8_500);
            if (!drained) logger.warn({ pending: background.pendingCount() }, "Shutdown left background work unfinished");
            await prisma.$disconnect().catch((err) => logger.error({ err }, "Prisma disconnect failed"));
            process.exit(0);
        });
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
