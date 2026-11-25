# Migration review — rollout plan for the production `mawid` database

Prepared 2026-11-25. **Nothing in this document has been executed against `mawid`.** Rolling out is a separate step that needs explicit approval.

## 1. Inventory

| # | Migration | Status on `mawid` | Status on `mawid_test` | Touches existing tables? | Destructive statements |
|---|---|---|---|---|---|
| 1 | `0_init` | applied | applied | creates the original 4 tables | none |
| 2 | `20261125120000_clinic_tenancy` | **applied** (Stage 2) | applied | `users`: ADD `locale`, ADD `platform_role` (NOT NULL with defaults) | none |
| 3 | `20261125140000_clinic_operations` | **pending** | applied | **no**: 7 new tables + their FKs/CHECKs | none |
| 4 | `20261125160000_appointments` | **pending** | applied | **no**: 2 new tables + their FKs/CHECKs | none |
| 5 | `20261125180000_notifications` | **pending** | applied | **no**: 1 new table + its FKs | none |

Checked automatically across all five files:
- 0 occurrences of DROP, TRUNCATE, DELETE or UPDATE.
- Checksums recorded in `mawid_test._prisma_migrations` equal the SHA-256 of the committed files (`3eb6bc…`, `33dcff…`, `7d6ca6…`, `5e7281…`, `969431…`).
- After applying all five, `migrate diff` (live `mawid_test` → `schema.prisma`) is empty, so the migrations fully describe the schema.
- `mawid_test` was created empty and migrated 1 → 5 in order, so a clean replay of the whole chain is proven.

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

### Backing out

The pending migrations only add empty tables, so backing out means dropping those 10 new tables in reverse dependency order and deleting their 3 rows from `_prisma_migrations`, or restoring the step-1 backup. Both are destructive operations on `mawid` and need explicit approval at that time. They are not scripted here on purpose.

## 5. Not yet migration-related, but needed before production

- A shared rate-limit store (rate limits are in-memory, single process).
- An email provider, if email notifications are wanted.
- Global strict mode for MariaDB, postponed. Mawid doesn't depend on it because it uses session-level strict mode.
