const express = require("express");
const { csrfProtection } = require("./middleware/csrf");
const { notFound } = require("./lib/errors");
const authApiRoutes = require("./modules/auth/auth.api.routes");
const clinicRoutes = require("./modules/clinics/clinic.routes");

// JSON REST API consumed by the React app. Mounted at /api/v1.
const api = express.Router();

api.use(express.json({ limit: "100kb" }));
api.use(csrfProtection);

api.use(authApiRoutes);
api.use(clinicRoutes);

api.use((req, res, next) => next(notFound()));

module.exports = api;
