// Email is a pluggable channel. v1 ships no SMTP/API provider (none is configured and none was
// approved), so the default provider records the email as SKIPPED. To enable email, implement
// `send({ to, subject, text })` (e.g. with nodemailer or an email API) and select it with
// EMAIL_PROVIDER. In-app notifications work regardless.
const logger = require("../../lib/logger");

const providers = {
    none: {
        name: "none",
        enabled: false,
        async send() {
            return { status: "SKIPPED" };
        },
    },
    // Development aid: logs the message (without the body) instead of sending it.
    log: {
        name: "log",
        enabled: true,
        async send({ to, subject }) {
            logger.info({ to: to.replace(/(^.).*(@.*$)/, "$1***$2"), subject }, "Email (log provider)");
            return { status: "SENT" };
        },
    },
};

function getEmailProvider() {
    return providers[process.env.EMAIL_PROVIDER] || providers.none;
}

module.exports = { getEmailProvider, providers };
