const app = require("./app");
const prisma = require("./config/database");
const logger = require("./lib/logger");

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
            await prisma.$disconnect().catch((err) => logger.error({ err }, "Prisma disconnect failed"));
            process.exit(0);
        });
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
