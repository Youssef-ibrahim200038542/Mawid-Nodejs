# Phase 4 — Appointment booking engine

Status: implemented and tested against `mawid_test`. Not applied to `mawid` (rollout held, see `05-migration-review.md`).

## 1. Schema (migration `20261125160000_appointments`)

Additive only: 2 new tables.

| Table | Purpose | Integrity |
|---|---|---|
| `patients` | Clinic-scoped patient record: `full_name`, `phone`, `email`, optional `user_id` (online account). **No medical data.** | unique `(clinic_id, user_id)` (one record per account per clinic); `(clinic_id, id)` target for composite FKs |
| `appointments` | Doctor + service + patient + UTC `starts_at`/`ends_at`, `status`, `source`, snapshot of duration/price/currency, admin `note`, confirm/cancel metadata, `reschedule_count` | composite FKs `(clinic_id, doctor_id)`, `(clinic_id, service_id)`, `(clinic_id, patient_id)`; CHECK start < end, duration 5–480, price ≥ 0; indexes `(doctor_id, starts_at)`, `(clinic_id, starts_at)`, `(patient_id, starts_at)`, `(clinic_id, status, starts_at)` |

Statuses: `PENDING → CONFIRMED → COMPLETED | NO_SHOW`, plus `PENDING/CONFIRMED → CANCELLED`. Only PENDING and CONFIRMED occupy the doctor's time.

## 2. How a booking is validated

`src/modules/appointments/booking-engine.js`, used by staff booking, online booking and both reschedule paths:

1. **READ COMMITTED** interactive transaction.
2. **Lock** the doctor row(s) with `SELECT … FOR UPDATE`, in ascending id order. Then lock the patient row. All bookings for one doctor are serialised; different doctors never wait for each other. Ordered locking prevents deadlocks, and deadlocks or lock timeouts are retried up to 3 times anyway.
3. Inside the lock, re-validate everything:
   - The doctor is active and their membership is active.
   - The service is in the clinic and active, and the doctor offers it.
   - The start is on a 5-minute boundary.
   - The start is inside the booking window: online needs at least 60 min notice, staff needs a future time, and no booking more than 90 days ahead.
   - The slot fits within doctor hours ∩ clinic hours (wall-clock, clinic timezone) and doesn't overlap any clinic-wide or doctor exception.
   - It doesn't overlap the doctor's active appointments.
   - The patient has no overlapping appointment with any doctor.
   - Online only: the patient holds no more than 5 upcoming appointments.
4. Insert or update, write the audit row, commit.

The pure engine (`availability.js`) is shared by the slot listing and the booking check, so "shown as free" and "accepted" use one definition.

MariaDB 10.4 has no exclusion constraints, and a generated "active slot" column was deliberately avoided. Prisma doesn't model generated columns, so future `migrate diff` runs would try to drop it. The row lock is the guarantee, proven by the concurrency tests.

## 3. API

Staff routes (`/api/v1/clinics/:clinicSlug`, tenant-scoped, CSRF on writes):

| Method | Path | Permission |
|---|---|---|
| GET | `/availability?serviceId&doctorId&from&to` (≤ 31 days) | schedule:read |
| GET | `/appointments?from&to&doctorId&status&patientId&page&pageSize` | appointments:read (all), or appointments:read_own (doctor: own only) |
| POST | `/appointments` `{doctorId, serviceId, startsAt, patientId \| patient{…}, note, status}` | appointments:create |
| GET | `/appointments/:id` | read / read_own |
| POST | `/appointments/:id/confirm`, `/complete`, `/no-show` | appointments:manage, or update_own for one's own appointments |
| POST | `/appointments/:id/cancel` `{reason}` | appointments:manage |
| POST | `/appointments/:id/reschedule` `{startsAt, doctorId?}` | appointments:manage |
| GET/POST | `/patients`, GET/PATCH `/patients/:id` | patients:read / patients:manage |

Patient routes:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/public/clinics?q&city&page` | discovery, ACTIVE clinics only |
| GET | `/api/v1/public/clinics/:slug` | public clinic page: active specialties, services, doctors, clinic hours. No member ids, licence numbers, staff emails or audit data |
| GET | `/api/v1/public/clinics/:slug/availability?serviceId&doctorId&from&to` | ≤ 14 days |
| POST | `/api/v1/public/clinics/:slug/appointments` | logged in; creates a PENDING ONLINE booking; rate-limited per user |
| GET | `/api/v1/me/appointments?scope=upcoming\|past` | the caller's appointments across clinics |
| POST | `/api/v1/me/appointments/:id/cancel`, `/reschedule` | own appointments only; closes 2 h before start; a reschedule goes back to PENDING |

Someone else's appointment always looks missing (404), never forbidden.

Times: input is `YYYY-MM-DDTHH:mm` in the clinic's timezone, or ISO with an offset. Output has UTC `startsAt`/`endsAt` plus `startsAtLocal`/`endsAtLocal` and `timezone`.

New error codes: `SLOT_TAKEN`, `OUTSIDE_WORKING_HOURS`, `DOCTOR_UNAVAILABLE`, `BOOKING_TOO_SOON`, `BOOKING_TOO_FAR`, `INVALID_START_TIME`, `INVALID_DOCTOR`, `INVALID_PATIENT`, `DOCTOR_NOT_BOOKABLE`, `DOCTOR_DOES_NOT_OFFER_SERVICE`, `PATIENT_DOUBLE_BOOKED`, `PATIENT_BOOKING_LIMIT`, `INVALID_STATUS_TRANSITION`, `APPOINTMENT_NOT_STARTED`, `CHANGE_TOO_LATE`.

## 4. Authorization summary

| | OWNER | RECEPTIONIST | DOCTOR | Patient (any user) |
|---|---|---|---|---|
| See appointments | all in clinic | all in clinic | own only | own only (`/me`) |
| Book | any patient | any patient | — | for themselves, online |
| Confirm / complete / no-show | ✓ | ✓ | own appointments | — |
| Cancel / reschedule | ✓ | ✓ | — | own, until 2 h before |
| Patients list / edit | ✓ | ✓ | — (sees contact details only through own appointments) | — |

## 5. Tests

- Unit: 66 tests. 13 are new: slot computation, intersection, breaks, exceptions, booking window, summer time, the DST-gap day, multi-day ranges, `checkSlot` reasons, the lifecycle matrix, booking schemas, and the production migration guard.
- Integration (`mawid_test`): 66 tests. 22 are new booking tests, which passed 3 more times in a row:
  - 10 patients race for one slot and exactly one wins.
  - Overlapping (not identical) times raced concurrently: only one wins, and no overlapping rows exist in the DB.
  - Different doctors at the same time both succeed.
  - Also covered: validation of every rule, exceptions, patient double-booking, the hoarding limit, walk-ins, lifecycle, doctor-own scope, staff and patient reschedule, the 2-hour cancellation window, cross-clinic isolation, DB-level FK and CHECK rejection, and audit.

## 6. Limitations

- Notifications for booking events are added in the notifications stage. The engine does not send anything itself.
- Rate limits are in-memory (single process).
- Slot step (15 min), notice (60 min), horizon (90 days), change window (2 h) and hoarding limit (5) are global constants in `booking-policy.js`, not per-clinic settings yet.
- A repeated local hour at the end of DST resolves to one occurrence (Luxon's choice). Egypt switches at midnight, outside normal clinic hours.
