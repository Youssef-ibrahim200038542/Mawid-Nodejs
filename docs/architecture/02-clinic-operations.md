# Phase 3 — Clinic operations: doctors, specialties, services, schedules

Status: implemented and tested against `mawid_test`. **Not yet applied to `mawid`** (see §6).

## 1. Schema (migration `20261125140000_clinic_operations`)

Additive only: 7 new tables. No existing table is altered or dropped.

| Table | Purpose | Integrity |
|---|---|---|
| `specialties` | Clinic-specific specialties, `name_en` (required) / `name_ar` | unique `(clinic_id, name_en)`, `(clinic_id, name_ar)` — collation is case-insensitive |
| `services` | Bookable offerings: bilingual name/description, `duration_minutes`, `price_minor` (int), `currency` | unique names per clinic; CHECK duration 5–480, price ≥ 0 |
| `doctor_profiles` | Professional profile of an OWNER/DOCTOR membership, bilingual name/title/bio, experience, licence, `is_active` | one per membership; composite FK `(clinic_id, member_id)` → `clinic_members`; CHECK experience 0–80 |
| `doctor_specialties` | doctor ↔ specialty | composite FKs `(clinic_id, doctor_id)` and `(clinic_id, specialty_id)` |
| `doctor_services` | doctor ↔ service | composite FKs `(clinic_id, doctor_id)` and `(clinic_id, service_id)` |
| `working_hours` | Weekly intervals; `doctor_id` NULL = clinic opening hours | CHECK weekday 1–7, 0 ≤ start < end ≤ 1440; composite FK to doctor |
| `schedule_exceptions` | HOLIDAY / LEAVE / UNAVAILABLE periods, clinic-wide or per doctor | UTC `starts_at` / `ends_at`, CHECK start < end |

The composite foreign keys mean **the database itself** rejects a link between a doctor, specialty or service from different clinics, even if application code had a bug (proven by integration tests that insert such rows with raw SQL).

### Time model

- Weekly hours are **wall-clock minutes in the clinic's IANA timezone** (`clinics.timezone`, default `Africa/Cairo`). "09:00" stays 09:00 across Egypt's DST switch.
- Breaks are gaps between intervals on the same weekday (09:00–13:00, 14:00–18:00). Overnight intervals are not supported.
- Exceptions are absolute instants stored in UTC. Input is either clinic-local (`2026-07-15T09:00`), an ISO time with offset, or whole days (`allDay`, `startDate`–`endDate` inclusive → local 00:00 to the next day's 00:00).
- A local time skipped by a DST jump (e.g. `2026-04-24T00:30` in Cairo) is rejected with `LOCAL_TIME_INVALID`, never silently shifted. A repeated hour when DST ends resolves to the later (standard-time) occurrence.
- Conversions use Luxon (new dependency, no transitive deps). Node 24 does not ship Temporal.
- Effective availability (Phase 4) = doctor hours ∩ clinic hours − clinic exceptions − doctor exceptions − existing appointments. Doctor hours are **not** forced inside clinic hours at write time, so changing clinic hours never invalidates doctor schedules.

## 2. API

All routes are under `/api/v1/clinics/:clinicSlug`, after `requireApiAuth` and `loadTenant`. The clinic comes only from the slug plus the caller's active membership. Non-members get 404. Every unsafe method needs the `X-CSRF-Token` header.

| Method | Path | Permission |
|---|---|---|
| GET | `/specialties?includeInactive=` | specialties:read |
| POST | `/specialties` | specialties:manage |
| PATCH | `/specialties/:specialtyId` | specialties:manage |
| GET | `/services?includeInactive=` | services:read |
| POST | `/services` | services:manage |
| GET | `/services/:serviceId` (with doctors) | services:read |
| PATCH | `/services/:serviceId` | services:manage |
| GET | `/doctors?includeInactive=&specialtyId=&serviceId=&page=&pageSize=` | doctors:read |
| POST | `/doctors` | doctors:manage |
| GET | `/doctors/:doctorId` | doctors:read |
| PATCH | `/doctors/:doctorId` | doctors:manage |
| PUT | `/doctors/:doctorId/specialties` `{specialtyIds}` | doctors:manage |
| PUT | `/doctors/:doctorId/services` `{serviceIds}` | doctors:manage |
| GET | `/working-hours` | schedule:read |
| PUT | `/working-hours` `{intervals:[{weekday,start,end}]}` | schedule:manage |
| GET | `/doctors/:doctorId/working-hours` | schedule:read |
| PUT | `/doctors/:doctorId/working-hours` | schedule:manage, or schedule:manage_own for one's own profile |
| GET | `/schedule-exceptions?from=&to=&doctorId=` | schedule:read |
| POST | `/schedule-exceptions` | schedule:manage (clinic-wide or any doctor), or schedule:manage_own (own profile only) |
| DELETE | `/schedule-exceptions/:exceptionId` | same rule as create, based on the exception's doctor |

PUT endpoints replace the whole set inside one transaction. They lock the doctor or clinic row (`SELECT … FOR UPDATE`) so concurrent edits are serialised.

Prices: send `price` as `"350.50"` or `350.5`. It is parsed from the decimal text into `priceMinor` (35050), so floats never round a price. Responses include both `price` (string) and `priceMinor`. Currencies: EGP (default), USD, EUR, SAR, AED.

Stable error codes for translation: `SPECIALTY_NAME_TAKEN`, `SERVICE_NAME_TAKEN`, `DOCTOR_PROFILE_EXISTS`, `INVALID_MEMBER`, `MEMBER_CANNOT_BE_DOCTOR`, `INVALID_SPECIALTY`, `INVALID_SERVICE`, `LOCAL_TIME_INVALID`, `INVALID_PERIOD`, `VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`.

## 3. Authorization

| | OWNER | DOCTOR | RECEPTIONIST |
|---|---|---|---|
| Read specialties, services, doctors, hours, exceptions | ✓ | ✓ | ✓ |
| Manage specialties, services, doctor profiles and links | ✓ | — | — |
| Clinic working hours, clinic-wide exceptions | ✓ | — | — |
| A doctor's working hours and exceptions | any doctor | **own profile only** | — |

- Every query filters by `tenant.clinicId`. Row lookups use the compound key `(clinicId, id)`, so an id from another clinic is simply not found (404).
- Request bodies are strict: `clinicId` or any other unknown field → 400.
- Linked ids (specialties, services, members) are checked to belong to the clinic before writing. The composite FKs are the second line of defence.
- Every write records an `audit_logs` row in the same transaction: `specialty.created/updated`, `service.created/updated`, `doctor.created/updated`, `doctor.specialties_updated`, `doctor.services_updated`, `clinic.working_hours_updated`, `doctor.working_hours_updated`, `schedule_exception.created/deleted`.

## 4. Tests

- Unit (`npm test`): 53 tests. 14 are new: time and DST conversion, price parsing, schemas, overlap rules, ownership rule, permission matrix, id parsing.
- Integration (`npm run test:integration`, `mawid_test` only): 44 tests. 19 are new, covering specialties, services, doctors, links, raw-SQL composite FK and CHECK enforcement, working hours, exceptions with Cairo DST, RBAC, cross-tenant access and audit.

## 5. Limitations / not in this phase

- No appointment booking or availability calculation (Phase 4 builds on this schema).
- No public (patient-facing) read endpoints yet; the public clinic page will need a curated read-only API.
- Deleting specialties, services or doctor profiles is not exposed: they are deactivated (`isActive: false`) so history stays intact.
- Inactive specialties and services can still be linked to a doctor. Booking will ignore inactive items.
- Lists of specialties, services and exceptions are capped at 500 rows. Doctors are paginated.
- Members are still added by DB fixture in tests: there is no invitation / member-management API yet.
- `npm audit` reports 5 pre-existing findings: `effect` (transitive, via Prisma) and `mysql2` inside the unused `express-mysql-session`. None come from Luxon.

## 6. Production database

The migration has been applied to **`mawid_test` only**. `mawid` was verified unchanged: same 8 tables, row counts and `CHECK TABLE` checksums. Applying it to `mawid` is purely additive (`npm run migrate`, which is `prisma migrate deploy`), and it waits for owner approval. Until then, the new endpoints fail against `mawid` because the tables don't exist, while the existing EJS and clinic features keep working.
