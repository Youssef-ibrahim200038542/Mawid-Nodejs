# Migration review — rollout plan for the production `mawid` database

Prepared 2026-11-25, updated 2026-11-27 (account security). **Nothing in this document has been executed against `mawid`.** Rolling out is a separate step that needs explicit approval.

## 1. Inventory

| # | Migration | Status on `mawid` | Status on `mawid_test` | Touches existing tables? | Destructive statements |
|---|---|---|---|---|---|
| 1 | `0_init` | applied | applied | creates the original 4 tables | none |
| 2 | `20261125120000_clinic_tenancy` | **applied** (Stage 2) | applied | `users`: ADD `locale`, ADD `platform_role` (NOT NULL with defaults) | none |
| 3 | `20261125140000_clinic_operations` | **pending** | applied | **no**: 7 new tables + their FKs/CHECKs | none |
| 4 | `20261125160000_appointments` | **pending** | applied | **no**: 2 new tables + their FKs/CHECKs | none |
| 5 | `20261125180000_notifications` | **pending** | applied | **no**: 1 new table + its FKs | none |
| 6 | `20261126120000_account_security` | **pending** | applied 2026-11-27 (row counts of all existing tables identical before/after) | **adds columns**: `users` (+`email_verified_at` NULL, +`session_version` DEFAULT 0), `clinic_members` (+4 trust columns, default `LEGACY_UNREVIEWED`); 3 new tables (`auth_tokens`, `clinic_invitations`, `auth_rate_buckets`) + FKs/CHECKs | none |

Checked automatically across all five files:
- 0 occurrences of DROP, TRUNCATE, DELETE or UPDATE.
- Checksums recorded in `mawid_test._prisma_migrations` equal the SHA-256 of the committed files (`3eb6bc…`, `33dcff…`, `7d6ca6…`, `5e7281…`, `969431…`).
- After applying all five, `migrate diff` (live `mawid_test` → `schema.prisma`) is empty, so the migrations fully describe the schema.
- `mawid_test` was created empty and migrated 1 → 5 in order, so a clean replay of the whole chain is proven.
- 2026-11-27: a brand-new empty `mawid_test_it` was migrated 1 → 6 in one `migrate deploy` run without errors, then passed the full integration suite (90/90) — the complete chain including `account_security` replays cleanly. (Run as the local development account; the reduced `mawid_migrator` grant set is derived from the statements and still has to be exercised once the account exists.)

Migration 6 (H1, see `07-account-security.md`): `ADD COLUMN` only, with defaults that keep every existing row valid (no backfill needed). Every existing membership becomes `LEGACY_UNREVIEWED` — by design, it must be re-confirmed (§4a). The CHECK constraints avoid columns that carry a CASCADE / SET NULL foreign-key action. Read-only status on `mawid` (2026-11-27): migrations 3–6 pending; `mawid` has 1 user, 0 clinics, 0 memberships.

### 1a. Risk per pending migration (checked 2026-11-27; a unit test asserts every committed migration contains only CREATE TABLE / CREATE INDEX / ALTER TABLE … ADD)

| Migration | Schema changes | Modifies existing rows? | Drops / renames? | Reversible | Downtime | Backup first | Locking on `mawid` |
|---|---|---|---|---|---|---|---|
| `…140000_clinic_operations` | 7 new tables, FKs to `clinics` / `clinic_members`, CHECKs | no | no | yes — drop the 7 new (empty) tables | none needed; run with the app stopped or on the old code (it doesn't use the tables) | yes | metadata locks on `clinics`, `clinic_members` while FKs are added (both empty on `mawid`) — milliseconds |
| `…160000_appointments` | `patients`, `appointments` + FKs (incl. `users`), CHECKs | no | no | yes — drop the 2 new tables | none | yes | short metadata lock on `users` (1 row) |
| `…180000_notifications` | `notifications` + FKs | no | no | yes — drop the table | none | yes | short metadata lock on `users`, `clinics` |
| `…120000_account_security` (H1) | `users` +2 columns, `clinic_members` +4 columns, +1 unique index, 3 new tables, FKs, CHECKs | **no data rewrite**; existing rows take the column defaults (`email_verified_at` NULL, `session_version` 0, `trust_state` LEGACY_UNREVIEWED) | no | app rollback needs no schema change (old code ignores the new columns); schema removal = drop 3 tables + 6 columns (destructive, approval) | **deploy app + migration together**: the new code needs the columns, the old code tolerates them. MariaDB 10.4 adds columns with defaults in place (INSTANT for trailing nullable/defaulted columns); with CHECK constraints the `ALTER TABLE` on `users` / `clinic_members` may copy the table — tiny tables on `mawid` (1 / 0 rows), so seconds at most | **yes (mandatory)** | `ALTER TABLE users` / `clinic_members` take a metadata lock for the copy; sessions/logins pause briefly. Run in a quiet window. |

Because MariaDB DDL is not transactional, a failure part-way leaves a partly applied migration that
Prisma marks failed; inspect it, finish or roll back from the backup — never `migrate reset`.

## 2. What the pending migrations do to `mawid`

New tables only: `specialties`, `services`, `doctor_profiles`, `doctor_specialties`, `doctor_services`, `working_hours`, `schedule_exceptions`, `patients`, `appointments`, `notifications`.

- **Existing data is untouched.** No column is added, changed or removed on `users`, `events`, `registrations`, `sessions`, `clinics`, `clinic_members` or `audit_logs`.
- New foreign keys point *from* the new tables *to* existing ones (`clinics`, `users`, `clinic_members`). The required unique keys already exist on `mawid` from migration 2 (`clinic_members (clinic_id, id)`). `mawid` has 0 clinics today, so no FK can fail on existing rows.
- CHECK constraints are enforced by MariaDB 10.4 (supported since 10.2). Prisma doesn't model them, so later `migrate diff` runs ignore them. Verified: the diff stays empty.
- Locking: `CREATE TABLE` and `ALTER TABLE` on brand-new, empty tables are near-instant. The FK additions take short metadata locks on the referenced tables (`clinics`, `users`, `clinic_members`), which are tiny. **No other database is involved.** Everything is inside `mawid`, and DriveX (`car_rental`) and the global settings are not touched.

## 3. Risks and how they're handled

| Risk | Mitigation |
|---|---|
| Running against the wrong database | `db-guard` refuses any database not named `mawid`/`mawid_*`, and DB_NAME and DATABASE_URL must agree. `prisma7.config.js` refuses writing Prisma commands against `mawid` unless `MAWID_ALLOW_PROD_MIGRATE=1` is set for that single command. |
| Accidental early rollout (e.g. `npm start`) | `npm start` no longer runs migrations. `npm run migrate` against `mawid` is refused by the guard (verified live). |
| DDL is not transactional in MariaDB: a failure midway leaves a partly applied migration | Take a backup first (step 1 below). Every statement is a CREATE on a new table, so a partial state can be inspected and finished, or the new empty tables can be removed (only with approval). Prisma records the failed migration and refuses to continue until it's resolved. |
| Strict mode | The app sets strict `sql_mode` per session. The migrations contain no data writes, so strict vs non-strict doesn't change their result. The global setting stays untouched. |
| Prisma CLI upgrades changing generated SQL | The SQL is committed and checksummed. Prisma applies the files as they are and never regenerates them. |

## 4. Rollout procedure (to be run only after approval)

**Gates — all must be met first:** a real email provider configured and tested (verification / reset / invitations depend on it); the least-privilege database accounts created and `scripts/verify-db-privileges.js` passing for the app account (H2); the existing memberships reviewed (§4a); this plan approved; a verified backup + restore drill (`docs/operations/deployment.md`). Use the `mawid_migrator` account for step 4, never the app account.

1. **Back up `mawid`** with the same read-only JSON export used in Stage 2 (into `backups/`, gitignored), or `mysqldump --single-transaction mawid` with the XAMPP client tools. Record row counts and `CHECKSUM TABLE` for every table.
2. **Recommended rehearsal:** restore that backup into a throwaway `mawid_rehearsal` database, apply the pending migrations there, run the integration suite against it, then drop it. This needs approval because it creates and drops a database on the shared server; it never touches `car_rental`.
3. Check the status (read-only): `npx prisma migrate status`. Expected: the three pending migrations listed in §1.
4. Apply (one explicit command):
   ```powershell
   $env:MAWID_ALLOW_PROD_MIGRATE = "1"; npx prisma migrate deploy; Remove-Item Env:MAWID_ALLOW_PROD_MIGRATE
   ```
5. Verify:
   - `npx prisma migrate status` reports "Database schema is up to date".
   - Row counts and checksums of the pre-existing tables are unchanged from step 1.
   - The 10 new tables exist and are empty.
   - The app starts, and the EJS pages and `/api/v1/auth/me` work.
6. Grant the first super admin if wanted: `node scripts/make-super-admin.js <email>`.

### 4a. Legacy membership review (mandatory)

1. Before migrating: `node scripts/review-memberships.js --env <env> --db mawid` (read-only: `START TRANSACTION READ ONLY`, ROLLBACK). On 2026-11-27 `mawid` has 0 memberships.
2. After migrating, every existing membership is `LEGACY_UNREVIEWED` and its workspace is closed.
3. A verified Super Admin requests the owner re-confirmation for each clinic without a trusted owner (`POST /admin/clinics/:id/owner-reconfirmations`); the owner accepts from their own verified inbox.
4. Owners re-confirm the legitimate members (Team page → "Request re-confirmation") and disable unknown ones.
5. Re-run the report; the owner approves the result.

### Backing out

Migrations 3–5 only add empty tables, so backing out means dropping those 10 new tables in reverse dependency order and deleting their 3 rows from `_prisma_migrations`, or restoring the step-1 backup. Both are destructive operations on `mawid` and need explicit approval at that time. They are not scripted here on purpose. Migration 6 adds nullable/defaulted columns that the previous code ignores, so the application can be rolled back without touching the schema; removing the columns and the 3 new tables is a separate, destructive step needing approval.

## 5. Not yet migration-related, but needed before production

- A shared rate-limit store (in-memory limiters are per process; the per-email buckets and cooldowns are already in the database).
- An SMTP provider (required: account security depends on email).
- Global strict mode for MariaDB, postponed. Mawid doesn't depend on it because it uses session-level strict mode.
