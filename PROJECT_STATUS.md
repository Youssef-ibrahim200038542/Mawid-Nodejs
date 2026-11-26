# Mawid — Project Status

**Stable reference:** commit `398b1ab` (branch `main`) · **Status date:** 2026-11-26

Mawid (موعد) is a multi-tenant clinic management and appointment booking platform. Each clinic is an isolated tenant with its own doctors, services, schedules, patients and appointments. Patients find a clinic and book a real open time online. Clinic staff run their day from one shared schedule.

---

## 1. Architecture

**Modular monolith**: a REST API and a single-page web app in one repository.

```
/                      Express API (Node.js, CommonJS)
  src/
    config/            database client, database guard
    lib/               logger, errors, permissions, time (timezone), audit
    middleware/        auth, tenant context, CSRF, validation, rate limits, errors
    modules/           auth · clinics · specialties · clinic-services · doctors
                       schedules · appointments · patients · notifications
                       analytics · admin
    views/             legacy server-rendered pages (events feature, kept as is)
  prisma/              schema + ordered migrations
  tests/               unit tests and integration tests (mawid_test only)
  scripts/             test DB migration, dev servers, reminders, admin bootstrap
web/                   React single-page application (Vite)
docs/                  architecture, migration review, design direction, frontend
```

- **Request flow:** route → controller (HTTP only) → service (business rules, transactions) → Prisma.
- **Tenant isolation:** the clinic is resolved from the URL slug *and* the caller's active membership. A `clinicId` sent by the client is never trusted. Every tenant query filters by clinic. Links between tenant rows use composite foreign keys `(clinic_id, id)`, so the database itself rejects cross-clinic data.
- **Booking concurrency:** bookings run in a `READ COMMITTED` transaction and take ordered row locks: doctor(s) first, then the patient. All rules are re-validated inside the lock, and deadlocks are retried. Double booking is impossible even under simultaneous requests (covered by concurrency tests).
- **Time:** instants are stored in UTC. Weekly hours are stored as wall-clock minutes in each clinic's IANA timezone (default `Africa/Cairo`), so they are DST-safe.

## 2. Technology stack

| Layer | Technology |
|---|---|
| API | Node.js 24, Express 5, Prisma ORM 7 (MariaDB adapter), Zod 4, express-session (DB store), Helmet, express-rate-limit, Pino, bcrypt, Luxon |
| Database | MariaDB 10.4 (local XAMPP) |
| Web app | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, React Router 7, TanStack Query 5, React Hook Form + Zod, Recharts 3, FullCalendar 6 (Luxon timezone plugin), Phosphor icons, Alexandria font (self-hosted) |
| Tests | Node.js test runner (unit + real-database integration) |

## 3. User roles

| Role | Scope |
|---|---|
| **Patient** (any account) | Discover clinics, book online, see / reschedule / cancel own appointments (until 2 h before), notifications, profile |
| **Clinic Owner** | Everything in their clinic: setup (services, specialties, doctors, hours, closures, team, settings), appointments, patients, analytics, activity log |
| **Receptionist** | Front desk: today's schedule, calendar, appointments, walk-in bookings, patients; confirm / cancel / move |
| **Doctor** | Own appointments only; confirm, complete, no-show on own appointments; edits own hours and leave |
| **Super Admin** | Platform console: overview, clinics (suspend / reactivate), users (platform role), platform audit log. No implicit access to clinic data |

Permissions are enforced by the API on every request. The web app only mirrors them for display.

## 4. Implemented features

**Backend**
- Session authentication (HttpOnly cookie, session regeneration on login, CSRF synchronizer token, constant-time login, rate limits).
- Clinics and memberships, with guards against self-demotion, losing the last owner, and changing a member who has a doctor profile.
- Specialties and services: bilingual, exact integer pricing, CHECK constraints.
- Doctor profiles and their links to services and specialties.
- Weekly working hours with breaks; holidays, leave and unavailable periods.
- Availability engine: doctor hours ∩ clinic hours − closures − existing bookings.
- Appointments:
  - Staff booking and walk-ins, plus online booking with a hoarding limit.
  - Lifecycle: pending → confirmed → completed / no-show / cancelled, and reschedule.
  - Each booking keeps a snapshot of the price and duration at booking time.
- Clinic-scoped patient records (contact details only, no medical data).
- In-app notifications written inside the booking transaction; idempotent 24-hour reminder job; pluggable email channel (no provider configured).
- Clinic analytics (status totals, rates, completed revenue, daily series in the clinic timezone, per doctor, top services).
- Audit log for every administrative change.
- Super Admin API.
- Legacy events feature preserved unchanged.

**Web app**
- Design direction «دفتر المواعيد» (the appointment ledger), built on a token-based palette that passes WCAG AA contrast.
- English (default) and Arabic with full right-to-left layout.
- Public site, clinic discovery, clinic page with live availability and booking.
- Patient portal: appointments, change time, cancel, notifications, profile.
- Staff workspace with role-aware navigation:
  - Today (time × doctor schedule), calendar, appointments, new booking / walk-in, patients.
  - Doctors, services, specialties, hours & closures, team, settings, analytics, activity log, my schedule.
- Super Admin console.
- Loading, empty and error states; error boundaries; validation with an error summary; keyboard and screen-reader support; responsive down to 375 px; code-split bundles.

## 5. Testing

| Suite | Command | Result |
|---|---|---|
| Unit tests | `npm test` | **66 / 66 passing** |
| Integration tests (real database `mawid_test`) | `npm run test:integration` | **77 / 77 passing** (last run before the frontend stage; the API has not changed since) |
| Web app typecheck + production build | `npm run web:build` | **passing** |

The integration tests cover:
- Authentication and session lifecycle, and CSRF.
- Cross-tenant isolation and role permissions.
- Composite foreign key and CHECK enforcement at the database level.
- Availability and DST handling.
- Concurrent booking races: 10 patients racing for one slot, and overlapping times raced concurrently.
- The appointment lifecycle, the patient portal, notifications and reminders, analytics, and the Super Admin API.

### Browser testing (real UI → real API → `mawid_test`)

Verified manually end to end:
- **Owner:** signup and login, opening a clinic, a service, doctor profiles with services and hours (including a break and overlap validation), team management, analytics, activity log.
- **Patient:** visitor booking through signup with the selection kept, booking, rescheduling, a confirmation notification, cancellation with a reason.
- **Front desk and calendar:** staff confirmation from a notification link, walk-in booking, moving an appointment, the calendar in clinic time.
- **Role scopes:** the receptionist and doctor scopes, including API refusals (403 / 404).
- **Platform and UI:** Arabic RTL, Super Admin suspend / reactivate with audit, no horizontal overflow on all 26 routes at 375 px.

### Bugs found and fixed during browser testing

- A query-cache key collision that crashed the doctor page.
- Grid overflow on narrow screens.
- Full-width time inputs.
- Misleading "closed" opening hours for clinics using doctor hours only.
- The address separator in English.
- Danger button colour.
- Toggle labels that showed a state instead of an action.
- The workspace not refreshing after a doctor profile was created.
- Dialog scroll position.
- Post-booking navigation not opening the booked day.
- The back arrow not mirroring in RTL.
- A route error boundary was added.

Earlier backend fixes:
- Lost session writes that dropped the CSRF token right after login.
- Per-user (instead of per-IP) booking rate limits.
- An incorrect reminder deduplication count.
- `npm start` was changed so it never applies migrations.

## 6. Database safety

The local MariaDB server is **shared with another project**. Its database and the server's global settings are never touched.

| Database | Role | State |
|---|---|---|
| `mawid` | production / development data | Frozen at migration `20261125120000_clinic_tenancy`. **The three pending migrations have NOT been applied.** Contents verified unchanged by row counts and table checksums. |
| `mawid_test` | **current testing database** | All 5 migrations applied; used by the integration tests and the local dev stack (`npm run dev:test-db`, `npm run web:dev`). |

Pending migrations (additive only: new tables, no drops or changes to existing tables):
1. `20261125140000_clinic_operations`
2. `20261125160000_appointments`
3. `20261125180000_notifications`

Safeguards:
- A database guard refuses any database not named `mawid` / `mawid_*`.
- Integration tests are pinned to `mawid_test` and verify the live database name before every operation.
- Prisma CLI commands that write (migrate deploy / dev / reset, db push / execute) are refused against `mawid` unless explicitly allowed for an approved rollout.
- Strict SQL mode and UTC are set per session on Mawid's own connections only. Global server settings are unchanged.

The ordered rollout plan, risks and back-out procedure are in `docs/architecture/05-migration-review.md`.

## 7. Known limitations

- No automated browser (E2E) test suite yet; browser flows were verified manually.
- Rate limits are in memory (single process); a shared store is needed before running multiple instances.
- No email provider configured (in-app notifications work; email is recorded as skipped).
- Staff are added by existing account email; there are no email invitations.
- Booking rules (15-minute slot grid, 60-minute online notice, 90-day horizon, 2-hour change window, 5 upcoming bookings per patient) are global constants, not per-clinic settings.
- The calendar loads up to 100 appointments per visible range; analytics covers past periods only.
- Deleting specialties, services or doctors is not exposed; they are deactivated to keep history.
- No payments, medical records, SMS or WhatsApp (out of scope for v1).

## 8. Pending tasks

1. Review and approve the production rollout of the three pending migrations (`docs/architecture/05-migration-review.md`), optionally rehearsed on a temporary copy first.
2. Add an automated E2E suite for the critical flows (booking, confirmation, role scopes).
3. Configure an email provider and schedule the reminder job (`scripts/send-reminders.js`, hourly).
4. Add a shared rate-limit store before multi-instance deployment.
5. Decide how the legacy events pages and the new web app are served together in production.
6. Enable MariaDB global strict mode later, once it is safe for the other project on the same server.

## 9. Running locally

```bash
npm install && npm --prefix web install
npm test                    # unit tests
npm run test:integration    # integration tests (empties mawid_test)
npm run dev:test-db         # API on :3100 against mawid_test
npm run web:dev             # web app on :5173
```

Configuration is read from `.env` (production / dev) and `.env.test` (tests). Both are local only and never committed; see `.env.example` and `.env.test.example`.

## 10. Further documentation

- `docs/architecture/01-audit.md`: initial audit and stage log
- `docs/architecture/02-clinic-operations.md`: doctors, services, schedules
- `docs/architecture/03-appointments.md`: booking engine
- `docs/architecture/04-platform-backend.md`: auth API, notifications, analytics, Super Admin
- `docs/architecture/05-migration-review.md`: production migration rollout plan
- `docs/architecture/06-frontend.md`: web app pages, API mapping, browser test log
- `docs/design/01-design-direction.md`: visual design direction
