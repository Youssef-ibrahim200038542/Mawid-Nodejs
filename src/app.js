const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const logger = require("./lib/logger");
const prisma = require("./config/database");
const sessionMiddleware = require("./session");
const { sessionGuard } = require("./middleware/session-guard");
const errorHandler = require("./middleware/error-handler");
const { webAppUrl } = require("./config/startup-checks");
const api = require("./api");
const authRoutes = require("./routes/auth.routes");
const eventRoutes = require("./routes/event.routes");

const app = express();
const production = process.env.NODE_ENV === "production";
const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");

// Production runs behind a TLS-terminating reverse proxy. TRUST_PROXY = number of proxy hops
// (default 1) so req.ip / req.secure come from X-Forwarded-* of that proxy only.
if (production) {
    app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));
}

// SERVE_WEB=1: this process also serves the built React app (web/dist) — the recommended
// production layout (one origin: no CORS, the session cookie and CSRF work unchanged).
const serveWeb = process.env.SERVE_WEB === "1";
const webDist = path.resolve(__dirname, "..", "web", "dist");
if (serveWeb && !fs.existsSync(path.join(webDist, "index.html"))) {
    throw new Error("SERVE_WEB=1 but web/dist/index.html is missing. Run `npm run web:build` first.");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Health checks: before HTTPS redirects, logging and sessions (load balancers call them over plain
// HTTP and must never create sessions). They reveal nothing but up/down.
app.get("/healthz", (req, res) => {
    res.set("Cache-Control", "no-store").json({ status: "ok" });
});
app.get("/readyz", async (req, res) => {
    let timer;
    try {
        // Fail fast: a readiness probe must answer within its own timeout even if the DB hangs.
        await Promise.race([
            prisma.$queryRaw`SELECT 1`,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("timeout")), 2000);
            }),
        ]);
        clearTimeout(timer);
        res.set("Cache-Control", "no-store").json({ status: "ready" });
    } catch {
        clearTimeout(timer);
        res.status(503).set("Cache-Control", "no-store").json({ status: "unavailable" });
    }
});

// HTTPS only in production (disable with ENFORCE_HTTPS=0 only if the proxy already enforces it).
// Redirects go to the configured origin, never to the client-supplied Host header.
if (production && process.env.ENFORCE_HTTPS !== "0") {
    app.use((req, res, next) => {
        if (req.secure) return next();
        if (req.method === "GET" || req.method === "HEAD") return res.redirect(308, `${webAppUrl()}${req.originalUrl}`);
        res.status(403).json({ error: { status: 403, code: "HTTPS_REQUIRED", message: "Use HTTPS." } });
    });
}

// Explicit Content-Security-Policy, verified against the built SPA and the EJS pages: everything is
// same-origin (scripts, styles, self-hosted fonts, API). Inline style attributes are needed by the
// legacy pages and by charting/calendar libraries; no inline scripts exist anywhere.
app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                scriptSrc: ["'self'"],
                scriptSrcAttr: ["'none'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                fontSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                formAction: ["'self'"],
                manifestSrc: ["'self'"],
                ...(production ? { upgradeInsecureRequests: [] } : {}),
            },
        },
        frameguard: { action: "deny" },
        strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    })
);
app.use(pinoHttp({ logger }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

if (serveWeb) {
    // Hashed build assets are immutable; index.html is served below with no-cache.
    app.use("/assets", express.static(path.join(webDist, "assets"), { immutable: true, maxAge: "1y", index: false, fallthrough: false }));
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
}

app.use(sessionMiddleware);
// Session version check for every request (API and legacy pages); see middleware/session-guard.js.
app.use(sessionGuard);

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    // Prefer the configured origin over the Host header, which the client controls.
    res.locals.requestOrigin = appUrl || `${req.protocol}://${req.get("host")}`;
    res.locals.error = null;
    res.locals.values = {};
    next();
});

app.use("/api/v1", api);

if (serveWeb) {
    // The SPA owns "/", "/login", "/signup" and its own routes. The legacy EJS auth forms are not
    // mounted (the SPA's CSRF-protected API replaces them); the legacy events pages remain.
    app.use(eventRoutes);
    app.use((req, res, next) => {
        if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api/")) return next();
        res.set("Cache-Control", "no-cache");
        res.sendFile(path.join(webDist, "index.html"));
    });
} else {
    app.get("/", (req, res) => {
        res.render("home");
    });
    app.use(eventRoutes);
    app.use(authRoutes);
}

app.use((req, res) => {
    res.status(404).render("not-found");
});

app.use(errorHandler);

module.exports = app;
