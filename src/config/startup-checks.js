// Refuses to start a production process with settings that would silently break account
// security: without a real email provider nobody can verify an email, accept an invitation or
// reset a password, so production must not run on the development providers.
const developmentProviders = new Set(["none", "log", "outbox", "memory"]);

function webAppUrl(env = process.env) {
    const configured = (env.WEB_APP_URL || "").trim().replace(/\/+$/, "");
    if (configured) return configured;
    // Development default: the Vite dev server.
    return "http://localhost:5173";
}

function assertProductionConfig(env = process.env, { knownProviders = [] } = {}) {
    if (env.NODE_ENV !== "production") return;
    const provider = (env.EMAIL_PROVIDER || "").trim();
    if (!provider || developmentProviders.has(provider)) {
        throw new Error(`EMAIL_PROVIDER "${provider || "(unset)"}" cannot be used in production. Configure a real email provider.`);
    }
    if (!knownProviders.includes(provider)) {
        throw new Error(`Unknown EMAIL_PROVIDER "${provider}".`);
    }
    const url = (env.WEB_APP_URL || "").trim();
    if (!/^https:\/\/[^/]+/.test(url)) {
        throw new Error("WEB_APP_URL must be set to the https:// origin of the web app in production.");
    }
    if (!(env.EMAIL_FROM || "").trim()) {
        throw new Error("EMAIL_FROM must be set in production.");
    }
    if (provider === "smtp") {
        if (!(env.SMTP_HOST || "").trim()) throw new Error("SMTP_HOST must be set when EMAIL_PROVIDER=smtp.");
        if (env.SMTP_USER && !env.SMTP_PASSWORD) throw new Error("SMTP_PASSWORD must be set when SMTP_USER is set.");
    }
}

module.exports = { assertProductionConfig, webAppUrl, developmentProviders };
