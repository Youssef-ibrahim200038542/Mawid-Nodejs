# Mawid — Repository audit and target architecture

Audit date: 2026-11-25. Branch `main` (up to date with `origin/main`, working tree clean at audit time).
Last commit audited: `000c588 Add events with capacity, public registration and attendee list`.

## 1. Current state

### Runtime and tooling

| Item | Found |
|---|---|
| Node.js | 24.20.0 |
| Express | 5.3.0, CommonJS |
| Views | EJS 7, server-rendered, all styling inline in each view |
| ORM | Prisma 7.10.1, `prisma-client-js` generator, output `generated/prisma` (gitignored) |
| DB driver | `@prisma/adapter-mariadb` + `mariadb`, pool `connectionLimit: 5` |
| Database | MariaDB **10.4.32** (XAMPP), DB `mawid`, `@@time_zone = SYSTEM`, `REPEATABLE-READ` |
| SQL mode | `IGNORE_SPACE,NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION` — **no `STRICT_TRANS_TABLES`** |
| Prisma config | `prisma7.config.js` (picked up automatically by the CLI) |
| Migrations | one: `0_init`. `prisma migrate status` → up to date |
| Tests | `node --test`, 13 unit tests over controllers with stubbed models — all pass |
| Data present | 1 user, 1 event, 0 registrations, 1 session (real local data — must be preserved) |

### Structure

```
src/
  index.js              boot: SELECT 1, then listen
  app.js                helmet, urlencoded, session, res.locals, routes, 404
  session.js            express-session + PrismaSessionStore, secret length check
  config/database.js    single PrismaClient (MariaDB adapter), env checks
  middleware/require-auth.js   redirect to /login when no session
  routes/               auth.routes, event.routes
  controllers/          auth.controller, event.controller (validation lives here, hand-written)
  models/               user.model, event.model (Prisma access)
  views/                9 EJS views + header/footer partials
scripts/race.js         fires 20 concurrent registrations at an event URL
tests/                  controller unit tests
```

### What is good and reusable

- **Single Prisma client** with an explicit generated-client sanity check.
- **Sessions**: stored in DB, `httpOnly`, `sameSite: lax`, `secure` in production, `trust proxy` in production, 7-day expiry, `saveUninitialized: false`.
- **Session fixation handled**: `req.session.regenerate()` on signup and login, then explicit `save()`.
- **Secret hygiene**: `SESSION_SECRET` must be ≥ 32 bytes; `.env` is gitignored and not committed.
- **Password storage**: bcrypt cost 12, 72-byte limit enforced explicitly.
- **Capacity concurrency** is done correctly: `SELECT … FOR UPDATE` on the event row inside a transaction, then count + insert, plus a DB unique key `(event_id, email)`. This is the same pattern the appointment engine will need.
- **Ownership scoping** already exists: attendee list is `findFirst({ slug, organizerId })`, so another organizer gets a 404, not someone else's data.
- `scripts/race.js` is a useful seed for the booking concurrency test.

### Issues found

| # | Severity | Issue | Where |
|---|---|---|---|
| 1 | High | No CSRF protection on state-changing POSTs (SameSite=Lax mitigates cross-site form posts, but it is not a complete defence and the future SPA API needs an explicit scheme) | all POST routes |
| 2 | High | `express-rate-limit` is installed but unused: unlimited login/signup attempts and unlimited public registration spam | `auth.routes`, `event.routes` |
| 3 | High | MariaDB runs without strict mode: oversized/invalid values are silently truncated instead of rejected. App-level validation currently guards the existing fields | DB server config |
| 4 | Medium | No central error handler: errors fall through to Express's default handler (plain-text stack trace when `NODE_ENV` ≠ production) | `app.js` |
| 5 | Medium | `pino` / `pino-http` installed but unused; logging is `console.log` | `index.js` |
| 6 | Medium | Login timing leaks whether an email exists (bcrypt only runs when the user exists) | `auth.controller.login` |
| 7 | Medium | Event `startsAt` is parsed with `new Date()` from a `datetime-local` string, so it is interpreted in the **server's** timezone. Wrong for any clinic not on server time | `event.controller.createEvent` |
| 8 | Low | `requestOrigin` is built from the `Host` header (host-header injection into displayed links); `APP_URL` exists for this | `app.js` |
| 9 | Low | No graceful shutdown (open DB pool and session-store timer on SIGTERM) | `index.js` |
| 10 | Low | No request body size limit set explicitly | `app.js` |
| 11 | Info | Unused dependencies: `mysql2`, `express-mysql-session` (sessions use the Prisma store). `zod` installed but unused | `package.json` |
| 12 | Info | Signup says "That email is already registered" — intentional UX trade-off, but it does reveal account existence. Rate limiting (#2) limits the damage | `auth.controller.signup` |
| 13 | Info | Package name is still `nodejs-learning` | `package.json` |

## 2. Target architecture

**Modular monolith**, two applications in one repository:

```
/                     backend (stays at the repo root — no move, no broken scripts)
  src/
    config/           env (zod-validated), database
    lib/              logger, errors, time
    middleware/       auth, tenant context, csrf, rate limits, error handler
    modules/
      auth/           routes · controller · service · schemas
      clinics/
      members/
      doctors/
      specialties/
      services/
      schedules/      working hours + exceptions
      appointments/   availability + booking engine
      patients/
      notifications/
      analytics/
      audit/
    views/            legacy EJS — kept until the React app replaces each page
web/                  React + TypeScript + Vite + Tailwind (Phase 5, separate package.json)
docs/
```

Rules for every module: **route → controller (HTTP only) → service (business rules, transactions) → Prisma**. Validation with zod at the controller boundary. Services take a `TenantContext` object, never a raw `clinicId` from the request.

### API and auth for the SPA

- REST under `/api/v1`, JSON only.
- Same session cookie. In development Vite proxies `/api` to Express, so the browser sees one origin and `SameSite=Lax` keeps working; in production the API and web app are served under the same site.
- CSRF: synchronizer token kept in the session, fetched from `GET /api/v1/auth/csrf`, required in an `X-CSRF-Token` header on every unsafe method.
- CORS: closed by default; an explicit allowlist from env only if web and API end up on different origins.
- Password hashing: keep bcrypt (cost 12). Argon2id would add a native dependency and a rehash-on-login path with no concrete gain right now.

### Tenant isolation design

1. `requireAuth` → `loadMembership(clinicSlug)` middleware resolves the clinic **from the URL slug plus the session user's `ClinicMember` row**. No membership → 404 (not 403, to avoid confirming the clinic's private resources exist).
2. The resolved `{ clinicId, memberId, role }` is put on `req.tenant`. Services only accept `req.tenant`.
3. Every tenant-owned table has `clinic_id`; every query is `where: { clinicId: tenant.clinicId, … }`. Child rows that reference other tenant rows use **composite foreign keys `(clinic_id, id)`** so the database itself refuses a cross-clinic link (e.g. an appointment pointing at another clinic's doctor).
4. Permissions are a static role → permission map checked in middleware (`can('appointments:cancel')`), and re-checked in services for ownership-dependent rules (a doctor only sees their own appointments).
5. Super admin is a separate `User.platformRole = SUPER_ADMIN`, only honoured on `/api/v1/admin/*` routes, every action written to the audit log.
6. Integration tests create two clinics and assert every endpoint returns 404 for the other clinic's IDs.

### Proposed schema (additive — nothing existing is dropped)

| Table | Key columns | Notes |
|---|---|---|
| `users` (existing) | + `platform_role` enum `USER`/`SUPER_ADMIN` default `USER`, + `phone` nullable | additive, defaults keep the existing row valid |
| `clinics` | `slug` unique, `name`, `timezone` default `Africa/Cairo`, `status` | tenant root |
| `clinic_members` | `clinic_id`, `user_id`, `role` `OWNER`/`DOCTOR`/`RECEPTIONIST`, `status`; unique `(clinic_id, user_id)` | a user may belong to several clinics |
| `specialties` | global catalog, `slug` unique | platform-managed, shared by all clinics |
| `doctor_profiles` | `clinic_id`, `member_id` unique, `display_name`, `specialty_id`, `is_active` | |
| `services` | `clinic_id`, `name`, `duration_minutes`, `price_minor` (int, piasters), `currency` default `EGP`, `is_active` | money as integer minor units |
| `doctor_services` | `(clinic_id, doctor_id, service_id)` | composite FKs keep both sides in one clinic |
| `working_hours` | `clinic_id`, `doctor_id`, `weekday`, `start_minute`, `end_minute` | **local wall-clock minutes** interpreted in the clinic timezone → DST-safe |
| `schedule_exceptions` | `clinic_id`, `doctor_id` nullable (null = whole clinic), `starts_at`/`ends_at` UTC, `kind`, `reason` | |
| `clinic_patients` | `clinic_id`, `user_id` nullable, `name`, `phone`, `email` | patient record per clinic; lets reception book walk-ins with no account. Replaces the proposed global `PatientProfile` — conservative choice so clinics never share patient lists |
| `appointments` | `clinic_id`, `doctor_id`, `service_id`, `patient_id`, `starts_at`/`ends_at` UTC, `status`, `created_by_user_id`, `cancelled_at`; index `(doctor_id, starts_at)`, `(clinic_id, starts_at)` | |
| `notifications` | `user_id`, `clinic_id`, `type`, `payload` JSON, `read_at` | channel-agnostic; email is a delivery adapter |
| `audit_logs` | `actor_user_id`, `clinic_id` nullable, `action`, `target_type`, `target_id`, `metadata` JSON, `ip` | append-only |

`events` and `registrations` stay untouched until a decision is made about the legacy event feature (see open decisions).

### Booking concurrency (MariaDB 10.4 has no exclusion constraints)

Inside one transaction:

1. `SELECT id FROM doctor_profiles WHERE id = ? AND clinic_id = ? FOR UPDATE` — serialises all bookings for one doctor (the same proven pattern as event registration).
2. Re-validate service ↔ doctor link, working hours (in clinic TZ), exceptions.
3. `SELECT … FROM appointments WHERE doctor_id = ? AND status IN (active) AND starts_at < :end AND ends_at > :start` — overlap check.
4. Insert. Commit.

Different doctors never block each other. Covered by a concurrency test that fires N parallel bookings for the same slot and asserts exactly one succeeds.

### Time handling

Store UTC (`DATETIME(3)`, Prisma writes UTC). Each clinic has an IANA timezone. All wall-clock ↔ UTC conversion goes through one `lib/time` module built on a timezone library (Luxon is the candidate — decided in Phase 4). The DB connection should run with `time_zone = '+00:00'` so raw SQL comparisons agree with Prisma.

## 3. Open decisions (need the owner)

1. **Legacy events feature** — keep it running alongside clinics, or retire it once clinics ship? Keeping costs nothing now; tables are not touched either way.
2. **Interface language** — Arabic-first with RTL, English, or both? This drives font choice and layout in the design system.
3. **MariaDB strict mode** — enabling `STRICT_TRANS_TABLES` in XAMPP's `my.ini` is recommended. It is a server setting outside the repo, so it is the owner's call.

## 4. Stage log

- **Stage 1 (this change)** — foundation hardening, no schema change: structured logging, central error handler, rate limits on auth and public registration, login timing fix, `APP_URL`-based origin, body size limit, graceful shutdown. See git history for the exact diff.
