# Production deployment (H2 + H3)

Nothing here has been deployed. These are the prepared configuration and procedures.

## Architecture

```
Internet ──HTTPS──► reverse proxy (nginx / Caddy, TLS)  ──HTTP──► Node 24: src/index.js (SERVE_WEB=1)
                                                                    ├─ /api/v1/*   JSON API
                                                                    ├─ /assets, SPA (web/dist)
                                                                    ├─ /dashboard, /events/*  (legacy pages)
                                                                    └─ /healthz, /readyz
                                                       MariaDB ≥ 10.4 — its own server or a managed
                                                       instance, NOT the shared XAMPP server
                                                       SMTP provider (EMAIL_PROVIDER=smtp)
```

- **One origin.** The SPA, API and legacy pages are served by the same process behind one domain: no
  CORS (none is configured; cross-origin requests have neither the SameSite=Lax cookie nor the CSRF
  token), the session cookie and CSRF work unchanged. Hosting the SPA elsewhere is not supported
  without adding a reviewed CORS policy.
- In `SERVE_WEB=1` mode the SPA owns `/`, `/login`, `/signup`; the legacy EJS login/signup forms are not
  mounted (closes audit M2 in production). Legacy `/dashboard` and `/events/*` remain.
- Start with one app process (the in-memory IP/user rate limiters are per process — audit M3/L3; the
  database-backed limits and cooldowns are cross-instance). Before scaling out, add a shared rate-limit store.
- No file storage is used.

## Database accounts (H2)

`deploy/database/create-accounts.sql` (run by a DBA; replace the placeholders):

| Account | Grants | Used by |
|---|---|---|
| `mawid_app` | SELECT, INSERT, UPDATE, DELETE on `<db>`.* | the running app (`DB_*` variables) |
| `mawid_migrator` | + CREATE, ALTER, DROP, INDEX, REFERENCES on `<db>`.* | the migration job only (`DATABASE_URL`) |
| `mawid_readonly` (optional) | SELECT on `<db>`.* | `scripts/review-memberships.js`, reports |

No account has global rights, GRANT OPTION, or access to any other database.

Enforced by the app (production):
- `DB_USER` must not be root/admin, `DB_PASSWORD` ≥ 16 chars, and `DATABASE_URL` must **not** be set in
  the app process (`src/config/db-privileges.js`).
- At startup `SHOW GRANTS FOR CURRENT_USER()` must show only the four data privileges on `DB_NAME`;
  anything more (any global privilege, another database, DDL, GRANT OPTION) → the process exits.

Verify (read-only): `node scripts/verify-db-privileges.js --env <env file> --db <db>` → PASS only if the
grants are data-only and no other database is visible. Run against the current local `.env.test`
(root) it correctly reports **FAIL** (global ALL PRIVILEGES; other databases visible).

## Environment (production)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | e.g. `3000` (proxy target) |
| `APP_URL`, `WEB_APP_URL` | `https://<domain>` (https required) |
| `SESSION_SECRET` | ≥ 32 random bytes |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER=mawid_app`, `DB_PASSWORD` | runtime account |
| `DB_CONNECTION_LIMIT`, `DB_ACQUIRE_TIMEOUT_MS` | pool (defaults 5, 10000) |
| `SERVE_WEB` | `1` |
| `TRUST_PROXY` | `1` (one proxy hop) |
| `ENFORCE_HTTPS` | default on (308 redirect to `WEB_APP_URL`, `403 HTTPS_REQUIRED` for writes) |
| `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | email |
| `LOG_LEVEL` | `info` |

Secrets live in the host's secret store / a 0600 env file (see `deploy/systemd/mawid.service.example`),
never in the repository. The app refuses to start with: a development email provider, a non-https
`WEB_APP_URL`, missing `EMAIL_FROM` / `SMTP_HOST`, root / weak DB credentials, `DATABASE_URL` present,
or broader DB grants than above.

## Security hardening in place (H3)
- Helmet with an explicit CSP (all `'self'`; inline *styles* only; no inline scripts anywhere;
  `frame-ancestors 'none'`, `upgrade-insecure-requests`), HSTS (1 year, production), `X-Frame-Options: DENY`,
  no `X-Powered-By`. Verified in the browser against the production build (home, calendar, analytics,
  legacy dashboard): no CSP violations.
- Session cookie `__Host-mawid.sid`: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain.
- HTTPS enforced; redirects use the configured origin, never the Host header.
- Body limits: JSON 100 kB, forms 20 kB. Error responses never contain stack traces. Logs redact
  cookies, auth/CSRF headers and password fields; tokens never appear in URLs.
- `/healthz` (liveness, no DB, no session) and `/readyz` (DB `SELECT 1`, 2 s limit, 503 when down).

## Build and start
```
npm ci && npm run build:prod          # prisma generate + web build (web/dist)
npm run start:prod                     # node src/index.js — does not run migrations
```

## Migrations (database `mawid`)
Pending on `mawid` (read-only `npx prisma migrate status`, 2026-11-27): `20261125140000_clinic_operations`,
`20261125160000_appointments`, `20261125180000_notifications`, `20261126120000_account_security`.
All additive (new tables/columns/constraints; no DROP/TRUNCATE, no data rewrite). The procedure, risks
and back-out are in `docs/architecture/05-migration-review.md`. Run them only as an approved, separate
job with `mawid_migrator` credentials (`MAWID_ALLOW_PROD_MIGRATE=1 npx prisma migrate deploy`), after a
fresh verified backup, never from the app process.

## Email (H3.4)
`EMAIL_PROVIDER=smtp` (nodemailer). STARTTLS required unless `SMTP_SECURE=true`. 5xx → permanent
failure; 4xx / network / auth errors → retried (max 3 real attempts for account emails, owner resends
invitations). The message body and the server's reply are never logged. **Not tested against a real
provider** — awaiting SMTP credentials; send a test verification email to an owned inbox as the first
smoke test. Configure SPF, DKIM and DMARC for the sender domain.

## Backups and restore (H3.5)
- `deploy/backup/mawid-backup.sh` — nightly `mariadb-dump --single-transaction` of the Mawid database
  only, gzip + sha256, `RETENTION_DAYS` (default 14), credentials from a 0600 option file. Copy dumps
  off the host (object storage with versioning). Keep monthly copies for 12 months.
- **Restore drill (monthly, and before the first migration):** restore the newest dump into a
  disposable database on a non-production server (e.g. `mawid_restore_check`), run
  `npx prisma migrate status` against it, compare table row counts with production, then drop it. A
  backup only counts as valid once a restore drill of it succeeded.

## Monitoring
- Uptime monitor on `https://<domain>/healthz` (1 min) and `/readyz` (5 min).
- Ship the JSON logs (stdout, Pino) to a log service; alert on `level >= 50` and on
  "Account email delivery failed" / "Invitation email delivery failed" bursts.
- Error monitoring (e.g. Sentry) can be added later; no external service is wired in this version.
- Watch `auth_tokens` with `delivery_status IN ('FAILED','RETRYABLE')` (email outage indicator).

## Production smoke test (run after every deployment)
1. `GET /healthz` → 200; `GET /readyz` → 200; `http://` → 308 to https.
2. Response headers: CSP, HSTS, `__Host-mawid.sid` cookie (Secure, HttpOnly).
3. Sign up with an owned inbox → generic "check your email" → verification email arrives → link works once.
4. Log in; wrong password → generic error.
5. Forgot password for the same and for an unknown address → identical answers; reset email works; old
   sessions signed out.
6. Open a clinic (verified account).
7. Invite a second owned inbox as Doctor → accept → workspace opens; resend/withdraw works.
8. Create the doctor profile, hours, a service → book online as a patient → confirm as staff.
9. Tenant isolation: the doctor/receptionist of clinic A gets 404 on clinic B's API paths.
10. Unauthorized access: logged out → 401 on `/api/v1/clinics`; receptionist → 403 on analytics.
11. Session expiry: after a password reset, the other browser gets 401 `SESSION_REVOKED`.
12. Logout → header shows logged-out state; API 401.
13. Error handling: unknown API route → JSON 404 without stack trace.
14. `node scripts/verify-db-privileges.js --env <prod env> --db mawid` → PASS.
15. `node scripts/review-memberships.js --env <prod env> --db mawid` → review legacy memberships.
