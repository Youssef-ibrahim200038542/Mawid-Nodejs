const express = require("express");
const { csrfProtection } = require("./middleware/csrf");
const requireApiAuth = require("./middleware/require-api-auth");
const { loadTenant } = require("./middleware/tenant");
const { notFound } = require("./lib/errors");
const authApiRoutes = require("./modules/auth/auth.api.routes");
const clinicRoutes = require("./modules/clinics/clinic.routes");
const specialtyRoutes = require("./modules/specialties/specialty.routes");
const clinicServiceRoutes = require("./modules/clinic-services/clinic-service.routes");
const doctorRoutes = require("./modules/doctors/doctor.routes");
const scheduleRoutes = require("./modules/schedules/schedule.routes");

// JSON REST API consumed by the React app. Mounted at /api/v1.
const api = express.Router();

api.use(express.json({ limit: "100kb" }));
api.use(csrfProtection);

api.use(authApiRoutes);
api.use(clinicRoutes);

// Everything under /clinics/:clinicSlug/… runs inside the caller's tenant: the clinic is
// resolved once from the slug + the user's active membership, and modules only see req.tenant.
const tenantRouter = express.Router();
tenantRouter.use(specialtyRoutes, clinicServiceRoutes, doctorRoutes, scheduleRoutes);
api.use("/clinics/:clinicSlug", requireApiAuth, loadTenant, tenantRouter);

api.use((req, res, next) => next(notFound()));

module.exports = api;
