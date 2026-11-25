const pino = require("pino");

const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    redact: {
        paths: [
            "req.headers.cookie",
            "req.headers.authorization",
            "req.headers['x-csrf-token']",
            "res.headers['set-cookie']",
            "*.password",
            "*.passwordHash",
        ],
        censor: "[redacted]",
    },
});

module.exports = logger;
