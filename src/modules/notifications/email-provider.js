// Email is a pluggable channel. No SMTP/API provider ships yet, so production refuses to start
// (src/config/startup-checks.js) until a real provider is added here and selected with
// EMAIL_PROVIDER. Development providers:
//   none    — records nothing, reports SKIPPED.
//   log     — logs the masked recipient + subject only (never the body or links), reports SKIPPED.
//   outbox  — writes the message as a JSON file to var/mail-outbox/ (git-ignored, outside every
//             served directory). Refused when NODE_ENV=production.
// A provider's send() resolves { status: "SENT" } once its transport accepted the message, or
// throws EmailDeliveryError (permanent or not). Any other error counts as retryable.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const logger = require("../../lib/logger");
const { maskEmail } = require("../../lib/tokens");

class EmailDeliveryError extends Error {
    constructor(code, { permanent = false } = {}) {
        super(`Email delivery failed: ${code}`);
        this.name = "EmailDeliveryError";
        this.code = code;
        this.permanent = permanent;
    }
}

const outboxDir = path.resolve(__dirname, "..", "..", "..", "var", "mail-outbox");

const providers = {
    none: {
        name: "none",
        enabled: false,
        async send() {
            return { status: "SKIPPED" };
        },
    },
    log: {
        name: "log",
        enabled: true,
        async send({ to, subject }) {
            logger.info({ to: maskEmail(to), subject }, "Email (log provider, not delivered)");
            return { status: "SKIPPED" };
        },
    },
    outbox: {
        name: "outbox",
        enabled: true,
        async send({ to, subject, text, purpose }) {
            if (process.env.NODE_ENV === "production") throw new EmailDeliveryError("OUTBOX_DISABLED", { permanent: true });
            const id = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
            try {
                await fs.mkdir(outboxDir, { recursive: true });
                await fs.writeFile(path.join(outboxDir, `${id}.json`), JSON.stringify({ id, to, subject, purpose: purpose ?? null, text, createdAt: new Date().toISOString() }, null, 2), { flag: "wx" });
            } catch {
                throw new EmailDeliveryError("OUTBOX_WRITE_FAILED");
            }
            logger.info({ to: maskEmail(to), subject, outboxId: id }, "Email written to local outbox");
            return { status: "SENT" };
        },
    },
};

// Integration tests only: keeps messages in memory so a test can follow the emailed link.
// Refused unless NODE_ENV=test.
const memorySent = [];
providers.memory = {
    name: "memory",
    enabled: true,
    sent: memorySent,
    async send(message) {
        if (process.env.NODE_ENV !== "test") throw new EmailDeliveryError("MEMORY_PROVIDER_TEST_ONLY", { permanent: true });
        memorySent.push({ ...message, at: new Date() });
        return { status: "SENT" };
    },
};

// SMTP (production). Settings come only from the environment:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE ("true" = implicit TLS, e.g. port 465),
//   SMTP_USER, SMTP_PASSWORD, EMAIL_FROM. STARTTLS is required on non-implicit-TLS ports.
// Classification: SMTP 5xx replies are permanent (bad recipient / rejected); 4xx replies, network
// errors, timeouts and authentication/config errors are retryable (bounded by the attempt limit).
let smtpTransport = null;
function smtpTransporter() {
    if (!smtpTransport) {
        const nodemailer = require("nodemailer");
        smtpTransport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === "true",
            requireTLS: process.env.SMTP_SECURE !== "true",
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
            connectionTimeout: 7000,
            greetingTimeout: 7000,
            socketTimeout: 7000,
            logger: false,
            debug: false,
        });
    }
    return smtpTransport;
}

function classifySmtpError(error) {
    const code = Number(error && error.responseCode);
    if (code >= 500 && code < 600) return new EmailDeliveryError(`SMTP_${code}`, { permanent: true });
    if (code >= 400 && code < 500) return new EmailDeliveryError(`SMTP_${code}`);
    const name = String((error && error.code) || "SMTP_ERROR").replace(/[^A-Z0-9_]/gi, "").slice(0, 40) || "SMTP_ERROR";
    return new EmailDeliveryError(name);
}

providers.smtp = {
    name: "smtp",
    enabled: true,
    async send({ to, subject, text }, { transporter = smtpTransporter() } = {}) {
        try {
            const info = await transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, text });
            if (info && Array.isArray(info.rejected) && info.rejected.length > 0) throw new EmailDeliveryError("RECIPIENT_REJECTED", { permanent: true });
            return { status: "SENT" };
        } catch (error) {
            // Never log the message or the server's full reply (it can echo addresses or content).
            throw error instanceof EmailDeliveryError ? error : classifySmtpError(error);
        }
    },
};

const productionProviders = ["smtp"];

function getEmailProvider() {
    const name = (process.env.EMAIL_PROVIDER || "none").trim();
    if (name === "outbox" && process.env.NODE_ENV === "production") {
        throw new Error("The outbox email provider is for local development only and cannot run in production.");
    }
    return providers[name] || providers.none;
}

// Sends one message with a hard timeout and classifies the result. Never throws, never logs the body.
//   { status: "SENT" | "SKIPPED" }  or  { status: "RETRYABLE" | "FAILED", code }
async function deliver(message, { timeoutMs = 8000 } = {}) {
    let timer;
    try {
        const provider = getEmailProvider();
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new EmailDeliveryError("TIMEOUT")), timeoutMs);
        });
        const result = await Promise.race([provider.send(message), timeout]);
        return result && result.status === "SENT" ? { status: "SENT" } : { status: "SKIPPED" };
    } catch (error) {
        if (error instanceof EmailDeliveryError) {
            return { status: error.permanent ? "FAILED" : "RETRYABLE", code: String(error.code).slice(0, 64) };
        }
        return { status: "RETRYABLE", code: "PROVIDER_ERROR" };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { getEmailProvider, deliver, providers, productionProviders, EmailDeliveryError, outboxDir, classifySmtpError };
