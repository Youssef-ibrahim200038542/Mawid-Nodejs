# Account security (H1)

Fixes audit finding **H1**: an account could be registered with someone else's email and then be
given clinic access by email alone. Email ownership is now proven, staff join only by accepting an
invitation, and every membership that existed before this change must be re-confirmed.

Migration: `prisma/migrations/20261126120000_account_security` (additive). Applied to `mawid_test`
only; **not** applied to `mawid` (see `05-migration-review.md`).

## Accounts

| Flow | Behaviour |
|---|---|
| Signup (`POST /auth/signup`, legacy `POST /signup`) | Same `accountService.register()`. Always `202` with one generic body. Never logs in. All DB work happens before the answer (per-email rate bucket, `INSERT … ON DUPLICATE KEY UPDATE id = id` — an existing account is never modified, user row lock, token row), commits in every branch, email after commit, answer no sooner than 400 ms. New → verification link; existing unverified → new verification link; existing verified → "you already have an account" notice. |
| Verify (`POST /auth/verify-email {token}`) | Token in the body only. Consumed atomically (`updateMany … consumed_at IS NULL AND expires_at > now`, count must be 1), bound to the account's current email. Does not log in. |
| Resend (`POST /auth/verify-email/resend`) | Logged in, 60 s DB cooldown, supersedes older links, reports the real delivery result. |
| Forgot (`POST /auth/password/forgot`) | Always `202`, same body; per-email bucket written for every request (commit in both branches) + 400 ms floor. |
| Reset (`POST /auth/password/reset`) | One transaction: consume token, new bcrypt hash, `session_version + 1`, email marked verified, all open tokens superseded, audit. No auto-login. |
| Login | Hash + `session_version` read together **before** `bcrypt.compare`; the session stores that version (`sv`); after saving, both are re-read — if either changed (a reset raced the login) the new session is destroyed and the answer is `401 INVALID_CREDENTIALS`. |

Tokens: 256-bit random, base64url, only SHA-256 stored, expiry 24 h (verify) / 60 min (reset) / 7 days
(invitation). Links carry the token in the URL **fragment** (`#token=`), which never reaches a server
or a Referer; the SPA reads it once and removes it from the address bar.

### Session versions (`middleware/session-guard.js`)
Mounted after the session middleware for the API **and** the legacy pages. Guest → no lookup.
Logged in → `users.session_version` must equal the session's `sv` (missing `sv` = 0 = column
default, so pre-existing sessions keep working). Mismatch or deleted user → the session is
regenerated (old row deleted, new empty session, no CSRF token) **before** the request continues as a
guest: API → `401 SESSION_REVOKED`, EJS → redirect to `/login`. A database error → `500` (fail closed,
session untouched).

## Email delivery and recovery (`modules/auth/auth-delivery.js`)

Each `auth_tokens` row is one delivery generation.

| State | Meaning |
|---|---|
| `QUEUED` | stored, provider not called (`next_retry_at` = +60 s grace) |
| `SENDING` | a provider attempt started — the same UPDATE incremented `send_attempts` (`next_retry_at` = +120 s lease) |
| `SENT` / `SKIPPED` / `FAILED` | final provider outcome (`FAILED` = permanent, or 3 real attempts used) |
| `RETRYABLE` | transient failure, `next_retry_at` = backoff (1 min, 5 min) |
| `REPLACED` | superseded / recovered / no longer needed (an actionable token in this state is consumed) |

- `send_attempts` counts **real provider calls** for the whole chain (copied to replacements), max 3.
  A generation created but never sent is never counted and never marked `FAILED`.
- Recovery (on startup and every 60 s): due open rows; per row one transaction locks the user row,
  then the token row, re-checks, closes the old row and inserts the replacement (new raw token, old
  one invalid). Only after COMMIT is it sent. A crash before the commit leaves the old row due; after
  it, the `QUEUED` replacement is due. Chains stop at the purpose TTL (closed as `EXPIRED`, not failed).
- Every callback update is conditional on `(id, token_hash, delivery_status = 'SENDING')`; a late
  callback from a replaced generation changes nothing.
- `ACCOUNT_NOTICE` rows are notifications, not tokens: born consumed (`NOTICE`) with a hash that matches
  no raw value; their `consumed_at` never makes them look obsolete; they are retried the same way.
- **At-least-once:** if the provider accepted a message and the process died before the callback, the
  lease expires and a replacement is sent — the person may get two emails; only the newest link works.
- Shutdown: stop claiming, wait for the row in progress and for after-commit sends (8 s provider
  timeout) within the 10 s shutdown window; anything cut off is recovered on the next start.

### Per-email rate limit (`modules/auth/rate-buckets.js`)
`auth_rate_buckets (kind, key_hash, window_start)` — one-hour windows, `key_hash` = HMAC(SESSION_SECRET,
normalised email); no email or IP is stored. `INSERT … VALUES (…, 1) ON DUPLICATE KEY UPDATE
request_count = request_count + 1` takes the primary-key row lock and holds it until COMMIT, so N
concurrent requests on any number of app instances see 1…N and at most 3 per hour are allowed. Over
the limit the request still answers `202` (silent). In-memory limiters (per IP / per user) stay in
front and are single-process only.

## Membership trust

`clinic_members.trust_state`: `LEGACY_UNREVIEWED` (default — every pre-existing row) or `TRUSTED`
(`trust_source` = `CLINIC_CREATOR` | `INVITATION` | `RECONFIRMATION`, `trusted_at`,
`trusted_via_invitation_id`).

- **Only `modules/membership/membership-trust.service.js` writes these columns** (a unit test fails if
  anything else does). It asserts the proof inside the caller's transaction: verified creator; or an
  ACCEPTED invitation of this clinic, accepted by this user, for this email (and, for re-confirmation,
  this exact member with an unchanged role). The database adds a CHECK (fields consistent with the
  source) and a composite FK `(clinic_id, trusted_via_invitation_id)` (same clinic). MariaDB cannot
  express the cross-table facts as CHECKs and triggers would need server-wide privileges, so those are
  asserted in the service.
- `loadTenant` requires: active membership + active clinic + **verified email + TRUSTED** (all roles);
  otherwise `403 EMAIL_NOT_VERIFIED` / `403 MEMBERSHIP_RECONFIRMATION_REQUIRED`. A verified email alone
  never makes a legacy membership trusted.
- Only TRUSTED members get staff notifications, count as "the last owner", or can get a doctor profile.
- **Doctors on a non-TRUSTED membership take no bookings**: hidden from the public page and from
  availability, and refused under the doctor + membership row lock in `booking-engine.validateBooking`
  (`409 DOCTOR_NOT_BOOKABLE`). Existing appointments remain manageable; moving them to a trusted doctor
  is allowed.

## Invitations (`modules/invitations/`)

`clinic_invitations`: kind `NEW_MEMBER` | `RECONFIRM` (+ `member_id`, composite FK to the same clinic),
email, role, status `PENDING` → `ACCEPTED` | `DECLINED` | `REVOKED` (expiry computed), `token_hash`
(rotates on every send), `active_key` (sha256 of the open-invitation identity; NULL once final — the
UNIQUE index allows one open invitation per clinic+email / per member), `last_sent_at`, `send_count`,
delivery status, and timestamp + actor for each terminal state (actors `ON DELETE SET NULL`; CHECKs
require the timestamps, not the actors).

- Lock order everywhere: clinic row → invitation row → membership rows. Bookings never lock clinics
  or invitations.
- Every send (create, create-that-finds-an-open-one, resend, re-confirm, admin bootstrap) goes through
  one `rotate()`: 60 s DB cooldown (waived after a failed delivery), new token, old link dead.
- Create answers the same way whether or not the address has an account. Existing member → `409
  MEMBER_EXISTS`; legacy member → `409 MEMBER_NEEDS_RECONFIRMATION`. `POST /clinics/:slug/members`
  (direct add) now answers `410 ENDPOINT_REPLACED`.
- Accept / decline: logged in, **verified**, same email; re-checked under the locks (token hash still
  current, pending, unexpired, member/role unchanged → else `INVITATION_STALE`). The invitee cannot
  choose the role.
- Owner / Super Admin delivery results are reported honestly (`sent`, `skipped`, `failed`, `unknown`
  after 10 min without a result); invitations are re-sent by the owner, not automatically.

### Legacy re-confirmation
- A trusted owner: `POST /clinics/:slug/members/:memberId/reconfirmations` → RECONFIRM email to the
  member's current address → the member accepts → the **same row** becomes TRUSTED (`RECONFIRMATION`);
  doctor profile, appointments and history are untouched. Declining leaves it legacy; the owner may
  disable it (`member.legacy_disabled`).
- Clinics with no trusted owner: a **verified** Super Admin calls
  `POST /admin/clinics/:clinicId/owner-reconfirmations {memberId}` (owners only, refused if a trusted
  owner exists). The admin only starts it; the owner must accept with the matching verified email.
  There is no bypass: a clinic whose owner cannot reach the inbox stays closed (data kept; the admin may
  suspend it). `make-super-admin.js` refuses unverified accounts; the admin API requires a verified email.

## Audit events
`auth.signup_requested`, `auth.signup_existing_email`, `auth.email_verification_sent`, `auth.email_verified`,
`auth.password_reset_requested`, `auth.password_reset_completed`, `invitation.created|resent|revoked|accepted|declined|delivery_failed`,
`member.added` (`via: invitation`), `member.reconfirmed`, `member.legacy_disabled`,
`admin.owner_reconfirmation_requested`. Metadata never contains tokens, passwords or links; emails are masked.
The audit log is evidence, not the source of truth (state lives in the rows above).

## Email providers
`none` / `log` (SKIPPED, never "sent"), `outbox` (local `var/mail-outbox/*.json`, git-ignored, outside
every served directory, denied in Vite, refused in production), `memory` (integration tests only),
`smtp` (production). Production refuses to start with anything but a real provider. Raw tokens exist
only in memory while a message is built and handed to the provider.

## Tests
- Unit (run): `tests/account-security.test.js`, `tests/production-config.test.js`, updated
  `tests/auth.controller.test.js`, `tests/tenancy.test.js`.
- Integration (written, **not run** — the harness empties its database): `tests/integration/account-security.test.js`
  plus updated `auth.test.js` / `platform.test.js`. Run only with approval, preferably on the dedicated
  `mawid_test_it` database: `MAWID_IT=1 npm run test:integration` (needs `.env.test-it`).
