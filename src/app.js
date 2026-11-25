const path = require("path");
const express = require("express");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const logger = require("./lib/logger");
const sessionMiddleware = require("./session");
const errorHandler = require("./middleware/error-handler");
const authRoutes = require("./routes/auth.routes");
const eventRoutes = require("./routes/event.routes");

const app = express();
const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(helmet());
app.use(pinoHttp({ logger }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(sessionMiddleware);

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    // Prefer the configured origin over the Host header, which the client controls.
    res.locals.requestOrigin = appUrl || `${req.protocol}://${req.get("host")}`;
    res.locals.error = null;
    res.locals.values = {};
    next();
});

app.get("/", (req, res) => {
    res.render("home");
});

app.use(eventRoutes);
app.use(authRoutes);

app.use((req, res) => {
    res.status(404).render("not-found");
});

app.use(errorHandler);

module.exports = app;
