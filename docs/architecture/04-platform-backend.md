# Platform backend: SPA auth, staff, notifications, analytics, Super Admin

Status: implemented and tested against `mawid_test` (77 integration tests in total). Not applied to `mawid`.

## JSON auth (`/api/v1/auth`)

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/csrf` | creates or reads the session's CSRF token; call before any write |
| POST | `/auth/signup` `{name, email, password, locale}` | rate-limited; regenerates the session; returns `user`, `clinics`, new `csrfToken` |
| POST | `/auth/login` `{email, password}` | failures only count toward the limit; constant-time for unknown emails; `INVALID_CREDENTIALS` |
| POST | `/auth/logout` | destroys the session |
| GET/PATCH | `/auth/me` | profile (`name`, `locale` only — strict schema blocks `platformRole`) |

Same session cookie, bcrypt cost and fixation protection as the EJS pages. The helpers are shared from `auth.controller.js`.

## Staff membership (`/clinics/:slug/members`)

- POST `{email, role}` adds an **existing** Mawid user. There are no email invitations in v1: `USER_NOT_FOUND`, `MEMBER_EXISTS`.
- PATCH `/:memberId` `{role, status}`:
  - Nobody changes themselves (`CANNOT_CHANGE_SELF`).
  - The last active owner is protected (`LAST_OWNER`). Changes are serialised by a clinic row lock, so this is defence in depth against two owners demoting each other at the same time.
  - A member with a doctor profile must stay OWNER or DOCTOR (`MEMBER_HAS_DOCTOR_PROFILE`).
- Permission `members:manage` (OWNER). Audited as `member.added` / `member.updated`. Disabling takes effect on the next request.

## Notifications (migration `20261125180000_notifications`)

- Table `notifications`: `user_id`, `clinic_id`, `appointment_id`, `type`, JSON `payload` (ids and en/ar names; the frontend renders localized text), `read_at`, `email_status`, unique `dedupe_key`.
- Written **inside the booking transaction**, so a rolled-back booking leaves no notification behind.
- Recipients:
  - A patient action notifies the owners, the receptionists and the appointment's doctor.
  - A staff action notifies the patient, if they have an account.
  - The actor is never notified about their own action.
- Events: booked, confirmed, cancelled, rescheduled, plus the 24 h reminder (`node scripts/send-reminders.js`, idempotent via `dedupe_key`; run hourly).
- Email: pluggable provider (`EMAIL_PROVIDER`). No real provider is configured, so emails are recorded as `SKIPPED`. `log` is a development provider. Adding SMTP or an API provider is one `send()` implementation.
- API: GET `/me/notifications?unreadOnly`, POST `/me/notifications/:id/read`, POST `/me/notifications/read-all`. Own notifications only; anyone else's id returns 404.

## Analytics and audit (OWNER)

- GET `/clinics/:slug/analytics/overview?from&to` (≤ 366 days, default last 30) returns:
  - totals by status, no-show and cancellation rates, new patients, pending upcoming;
  - completed revenue per currency;
  - today's count;
  - per-day series in the clinic timezone;
  - per-doctor stats and the top services.

  Daily buckets are computed in JS because MariaDB timezone tables may not be loaded. The query is capped at 50k rows and flagged `truncated` if hit.
- GET `/clinics/:slug/audit-logs?action&page`: this clinic's trail only.

## Super Admin (`/api/v1/admin`)

- `platform_role` is read from the DB on every request. Non-admins get **404**, so the area isn't revealed.
- Super admins get **no implicit tenant access**: clinic routes still require membership.
- Endpoints:
  - GET `/admin/overview`
  - GET `/admin/clinics?q&status`
  - PATCH `/admin/clinics/:id` `{status, reason}`: suspending hides the public page and closes the clinic to its staff
  - GET `/admin/users?q`
  - PATCH `/admin/users/:id` `{platformRole}`: not on oneself
  - GET `/admin/audit-logs?clinicId&action`
- Every change is audited (`admin.clinic_status_changed`, `admin.user_role_changed`).
- The first super admin is granted from the command line only: `node scripts/make-super-admin.js <email>`. There is no API path to the first admin.
