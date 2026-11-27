# Production deployment (H2 + H3)

Nothing here has been deployed. These are the prepared configuration and procedures.
Command labels: **[read-only]** safe, **[local]** local and reversible, **[DBA]** needs a database
administrator / owner approval, **[creds]** needs external credentials, **[owner]** production owner
approval, **[destructive]** deletes or overwrites data.

## 1. Architecture

```
Internet ──HTTPS──► nginx (TLS, gzip)  ──HTTP──► Node 24: src/index.js  (SERVE_WEB=1, ONE process)
                                                   ├─ /api/v1/*        JSON API (404 → JSON)
                                                   ├─ /assets/*        hashed build files (immutable, 1 y)
                                                   ├─ SPA fallback     index.html (no-cache) for other GETs
                                                   ├─ /dashboard, /events/*   legacy pages
                                                   └─ /healthz, /readyz
                                             MariaDB ≥ 10.4 on its own server / managed — NOT the shared XAMPP server
                                             SMTP provider (EMAIL_PROVIDER=smtp)
```

- **One origin**: SPA, API and legacy pages share one domain. No CORS is configured (cross-origin
  requests have neither the SameSite=Lax cookie nor the CSRF token). Hosting the SPA on another origin
  is not supported without a reviewed CORS policy.
- With `SERVE_WEB=1` the SPA owns `/`, `/login`, `/signup`; the legacy EJS login/signup forms are not
  mounted (closes audit M2). Legacy `/dashboard` and `/events/*` remain.
- **Run exactly one app process.** The per-IP / per-user limiters are in memory (audit M3/L3). The
  security-relevant limits already live in the database (per-email signup/reset buckets, invitation and
  verification cooldowns), so a second process mainly weakens login brute-force throttling. Adding a
  shared store is required before scaling out; no Redis is introduced now because one process is enough
  for the expected load.
- No file storage. Compression is done by nginx (no extra Node dependency).

## 2. Database accounts (H2)

`deploy/database/create-accounts.sql` **[DBA]** (replace the `{{…}}` placeholders):

| Account | Grants (on the Mawid database only) | Used by |
|---|---|---|
| `mawid_app` | SELECT, INSERT, UPDATE, DELETE | the running app (`DB_*` variables) |
| `mawid_migrator` | + CREATE, ALTER, INDEX, REFERENCES (**no DROP**) | the migration job only (`DATABASE_URL`) |
| `mawid_readonly` (optional) | SELECT | `scripts/review-memberships.js`, reports |

Why exactly these: a unit test parses every committed migration and proves they contain only
`CREATE TABLE`, `CREATE [UNIQUE] INDEX` and `ALTER TABLE … ADD COLUMN / ADD CONSTRAINT` (FKs, CHECKs);
Prisma itself reads/writes `_prisma_migrations`. No migration drops anything, so the migrator gets no
DROP; a future migration that needs it gets a temporary, reviewed grant. REFERENCES is not enforced by
MariaDB for foreign keys but is required by MySQL ≥ 8.0.22. Another unit test checks that the SQL file
and the checker (`src/config/db-privileges.js`) agree.

Enforced by the app in production (fails closed, before listening):
- `DB_USER` not root/admin, `DB_PASSWORD` ≥ 16 chars, **no `DATABASE_URL` in the app process**.
- `SHOW GRANTS FOR CURRENT_USER()` must show **exactly** the four data privileges at database level on
  `DB_NAME`: any global privilege, other or wildcard database, DDL, PROXY, role, unknown grant form or
  GRANT OPTION → exit; a **missing** required privilege → exit too. Error texts name privileges and
  databases only, never credentials.

Verification **[read-only]**:
```powershell
node scripts/verify-db-privileges.js --env <app env file> --db mawid
node scripts/verify-db-privileges.js --env <migration env file> --db mawid --role migrator
```
PASS = exactly the expected privileges and no other database visible. Against the current local root
account it correctly reports FAIL. The checker is covered by a valid/invalid matrix in
`tests/production-config.test.js` (root, global, other/wildcard database, GRANT OPTION, PROXY, roles,
excess, DROP/CREATE DATABASE, missing and table-only privileges).

#### DBA procedure **[DBA — needs owner approval]**
1. Preflight (read-only): `SELECT user, host FROM mysql.user WHERE user LIKE 'mawid\_%';` — expect none.
2. Copy `deploy/database/create-accounts.sql`, replace `{{DB}}`, `{{APP_HOST}}`, `{{APP_PASSWORD}}`,
   `{{MIG_PASSWORD}}` (32+ random characters each; store them only in the secret store), run it once as
   an administrator: `mariadb -u <admin> -p < create-accounts.filled.sql`, then delete the filled copy.
3. `SHOW GRANTS FOR 'mawid_app'@'<host>'; SHOW GRANTS FOR 'mawid_migrator'@'<host>';`
4. Run both verifier commands above → both PASS.
5. Negative checks as `mawid_app` (must fail with "command denied"): `CREATE TABLE x (id INT);`,
   `DROP TABLE users;` (denied before anything happens), `USE car_rental;`.
   As `mawid_migrator`: `CREATE DATABASE x;` and `DROP TABLE users;` must be denied.
Rollback: `DROP USER 'mawid_app'@'<host>'; DROP USER 'mawid_migrator'@'<host>';`

## 3. Environments

| Environment | Env file | Database | Account |
|---|---|---|---|
| Local development | `.env` | `mawid` (frozen) — **don't** point dev at it | local |
| Browser testing | `.env.test` via `npm run dev:test-db` (API :3100) + `npm run web:dev` | `mawid_test` (manual test data — never reset) | local |
| Integration tests | `.env.test-it` (generated) via `npm run test:integration` | `mawid_test_it` (disposable, emptied every run) | local |
| Production runtime | `/etc/mawid/mawid.env` (template: `.env.production.example`) | `mawid` | `mawid_app` |
| Production migrations | separate job env with `DATABASE_URL` | `mawid` | `mawid_migrator` |

### Fixing the current local `.env` mismatch **[local]**
`.env` currently has `DB_NAME=mawid_test` but its `DATABASE_URL` names `mawid`; the db-guard refuses
to start, and the Prisma CLI refuses too (`prisma7.config.js` compares `DB_NAME` with `DATABASE_URL`).
Nothing can silently act on a different database. Choose one, then make both lines agree:
- keep `.env` on the frozen `mawid` (recommended; use `npm run dev:test-db` for testing): set
  `DB_NAME=mawid`; or
- point `.env` at `mawid_test`: change the database at the end of `DATABASE_URL` to `mawid_test` —
  but then Prisma CLI commands from `.env` target `mawid_test`.

## 4. Production environment variables

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` (nginx upstream) |
| `APP_URL`, `WEB_APP_URL` | `https://<domain>` (https required) |
| `SESSION_SECRET` | ≥ 32 random bytes (`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`) |
| `DB_HOST`, `DB_PORT`, `DB_NAME=mawid`, `DB_USER=mawid_app`, `DB_PASSWORD` | runtime account |
| `DB_CONNECTION_LIMIT` (5), `DB_ACQUIRE_TIMEOUT_MS` (10000) | pool |
| `SERVE_WEB=1`, `TRUST_PROXY=1`, `ENFORCE_HTTPS` (default on) | serving |
| `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` for 465), `SMTP_USER`, `SMTP_PASSWORD` | email (TLS ≥ 1.2 required, certificate verified) |
| `LOG_LEVEL` | `info` |

The app refuses to start with: a development email provider, a non-https `WEB_APP_URL` or `APP_URL`,
missing `EMAIL_FROM` / `SMTP_HOST`, root/weak DB credentials, `DATABASE_URL` present, or DB grants that
are broader or narrower than `mawid_app`'s. Precedence: process environment only (systemd
`EnvironmentFile`); `dotenv` never overrides a variable that is already set, and there are no built-in
development fallbacks for any production-required value.

## 5. Security hardening in place (H3, verified by `tests/production-config.test.js` in production mode)
- Helmet: explicit CSP (all `'self'`, inline *styles* only, no inline scripts, `frame-ancestors 'none'`,
  `upgrade-insecure-requests`), HSTS 1 year, `X-Frame-Options: DENY`, no `X-Powered-By`. Browser check on
  the production build (home, calendar, analytics, legacy dashboard): no CSP violations.
- Session cookie `__Host-mawid.sid`: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain.
- HTTPS: GET/HEAD → 308 to `WEB_APP_URL` (never the Host header — no open redirect / host-header
  injection), other methods → 403 `HTTPS_REQUIRED`. `TRUST_PROXY=1` + nginx overwrites `X-Forwarded-For`.
- Body limits 100 kB JSON / 20 kB forms; errors never include stack traces; Pino redacts cookies,
  auth/CSRF headers and passwords; tokens never appear in URLs.
- `/healthz` (no DB, no session) and `/readyz` (DB `SELECT 1`, 2 s limit, 503) return only a status word.
- Node server timeouts: keep-alive 65 s (longer than nginx's upstream keep-alive → no stale-socket 502s),
  headers 66 s, whole request 30 s.

## 6. Build, start, stop (Linux) **[owner]**
```bash
sudo -u mawid git -C /opt/mawid pull
cd /opt/mawid && sudo -u mawid npm ci && sudo -u mawid npm run build:prod   # prisma generate + web build
sudo systemctl restart mawid        # deploy/systemd/mawid.service.example; graceful SIGTERM (≤ 15 s)
curl -fsS https://<domain>/readyz
```
`npm run start:prod` never runs migrations.

## 7. Migrations on `mawid` **[owner] [DBA]**
Per-migration review and the ordered procedure: `docs/architecture/05-migration-review.md`.
Summary: 4 pending (3 add new tables; 1 adds columns with defaults + 3 tables); no DROP/RENAME/MODIFY,
no data rewrite. Run only after a verified backup + restore drill, from a separate job:
```bash
export DATABASE_URL='mysql://mawid_migrator:…@db-host:3306/mawid'   # job only, never in the app env
MAWID_ALLOW_PROD_MIGRATE=1 npx prisma migrate deploy
npx prisma migrate status
```

## 8. Integration tests (local) **[local]**, first run **[owner]**
They empty their database, so they run only against the dedicated `mawid_test_it`
(`tests/integration/helpers.js` refuses to empty any other database).
```powershell
node scripts/setup-integration-db.js            # [read-only] check
node scripts/setup-integration-db.js --create   # [local] CREATE DATABASE mawid_test_it + .env.test-it
npm run test:integration                        # migrates mawid_test_it, runs tests/integration/*.test.js
```
Status 2026-11-27: `mawid_test_it` created; all 6 migrations replayed cleanly on the empty database
(recorded checksums equal the committed files); **91 / 91 passing**. Four layers keep it there:
`MAWID_IT=1` → `.env.test-it`; `MAWID_EXPECT_DB`; `SELECT DATABASE()` before migrating; the reset
refuses any other database.

## 9. Email (H3.4) **[creds]**
`EMAIL_PROVIDER=smtp` (nodemailer 10). STARTTLS required unless `SMTP_SECURE=true`; TLS ≥ 1.2,
certificate verified; 7 s connection/socket timeouts. 5xx → permanent; 4xx / network / auth → retried
(account emails: max 3 real attempts with recovery; invitations: resent by the owner). Bodies, links and
the server's replies are never logged. Development: `outbox` (`var/mail-outbox/`), refused in production.
Test with an inbox you own (sends one plain message, no token):
```bash
node scripts/send-test-email.js --env /etc/mawid/mawid.env --to you@your-domain.example
```
Configure SPF, DKIM and DMARC for the sender domain. **Not yet tested** — no credentials.

## 10. Backups and restore (H3.5) **[owner]**
- `deploy/backup/mawid-backup.sh` (cron, e.g. `15 2 * * *`): `mariadb-dump --single-transaction` of the
  Mawid database only, **without** `CREATE DATABASE`/`USE` (a restore can only go where you point it),
  gzip + `gzip -t` + sha256, refuses non-Mawid names, refuses when free disk < 1 GB, logs success/failure
  to syslog (`mawid-backup`), keeps `RETENTION_DAYS` (14). Copy dumps off the host (versioned object
  storage); keep monthly copies 12 months. Credentials: 0600 option file (never on the command line).
- `deploy/backup/mawid-restore-drill.sh` **[creates and drops its own database — needs approval]**:
  restores into a new `mawid_restore_<suffix>` database and refuses: any other name (`mawid`,
  `mawid_test`, `mawid_test_it`, `car_rental`…), an existing database, target = source, a checksum
  mismatch, or a dump containing `CREATE DATABASE` / `CREATE SCHEMA` / `USE` (also inside `/*!…*/`
  version comments). Then it compares row counts, shows the last applied migrations and drops only that
  database. `.sha256` files name only the dump file, so dumps can be copied elsewhere and still be
  verified. These refusals are covered by `tests/backup-scripts.test.js` (runs the real scripts; no
  database is contacted). Run monthly and before the first migration, on a non-production server.
  **A backup only counts once a drill of it succeeded.** First drill: 2026-11-27 on the local server, passed.
  The drill aborts if any row count cannot be read; it never reports a match it could not check.
  Windows/XAMPP: run from Git Bash with `mariadb` / `mariadb-dump` wrappers around `mysql.exe` /
  `mysqldump.exe` that strip the CR from their output (`… | tr -d '\r'`).

  Drill command **[DBA — needs approval]** and expected output:
  ```bash
  DUMP=/var/backups/mawid/mawid-<stamp>.sql.gz TARGET_DB=mawid_restore_check SOURCE_DB=mawid \
  MYSQL_DEFAULTS=/etc/mawid/restore.cnf ./deploy/backup/mawid-restore-drill.sh
  # mawid-<stamp>.sql.gz: OK
  # Row counts match (…)            ← or "differ" if the source changed after the dump
  # 20261126120000_account_security ← last applied migrations
  # Restore drill finished; mawid_restore_check dropped.
  ```
- Encryption: store dumps on encrypted volumes / encrypted object storage (server-side encryption) with
  access limited to the operators; dumps contain personal data (patients, users, password hashes).

## 11. Monitoring
- Uptime: `https://<domain>/healthz` every minute, `/readyz` every 5 minutes; alert on 2 failures.
- Logs: Pino JSON → journald → log service. Alert on `level >= 50` (errors / crashes), on bursts of
  `"Request rejected"` with `code` `INVALID_CREDENTIALS` or `RATE_LIMITED` (brute force), and on
  "Account email delivery failed" / "Invitation email delivery failed".
- Process crashes: systemd restarts (5 per 5 min, then stops — alert on unit failure).
- Database: `auth_tokens` rows in `FAILED`/`RETRYABLE` (email outage), connection errors in logs.
- Backups: alert when `mawid-backup` logs FAILED or no new dump for 26 h; disk usage of `BACKUP_DIR`.
- Error tracking (e.g. Sentry) is not wired in; optional later.

## 11a. Incident response (short)
- **App down:** `systemctl status mawid`, `journalctl -u mawid -n 200`; `/readyz` 503 → database
  reachability / credentials; restart only after reading the fatal log line (startup refusals name the
  failed rule).
- **Suspected account compromise:** password reset on the account (signs out every session); a clinic
  owner can disable members; the Super Admin can suspend a clinic. Review `audit_logs`.
- **Email outage:** account emails retry automatically (max 3 real attempts); owners resend invitations.
  Check `auth_tokens` in `FAILED` / `RETRYABLE` and provider status.
- **Data loss / bad migration:** stop the app, restore the newest verified dump into a new database,
  compare, then switch only with the owner's approval. Never `migrate reset`.
- **Secrets leaked:** rotate `SESSION_SECRET` (signs everyone out), DB and SMTP passwords; redeploy.

## 12. Production smoke test (after every deployment)
1. `/healthz` 200, `/readyz` 200, `http://` → 308 https.
2. Headers: CSP, HSTS, `__Host-mawid.sid` (Secure, HttpOnly, SameSite=Lax).
3. `node scripts/verify-db-privileges.js --env /etc/mawid/mawid.env --db mawid` → PASS.
4. Sign up with an owned inbox → generic "check your email" → link works once.
5. Log in; wrong password → generic error.
6. Forgot password for that and an unknown address → identical answers; reset works; old sessions signed out (`SESSION_REVOKED`).
7. Open a clinic (verified account).
8. Invite a second owned inbox as Doctor → accept → workspace opens; resend cooldown; withdraw.
9. Doctor profile, hours, service → book online as a patient → confirm as staff.
10. Tenant isolation: staff of clinic A → 404 on clinic B's API paths.
11. Unauthorized: logged out → 401; receptionist → 403 on analytics.
12. Logout → UI logged out; API 401.
13. Unknown API route → JSON 404, no stack trace.
14. `node scripts/review-memberships.js --env /etc/mawid/mawid.env --db mawid` → review legacy memberships.
15. Backup ran tonight and the drill of it passed.
