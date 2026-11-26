# Frontend — Mawid web app (`web/`)

Status: implemented and browser-tested end to end against the real API on `mawid_test`. Design direction A «دفتر المواعيد» (`docs/design/01-design-direction.md`).

## Stack

Vite 7, React 19, TypeScript 5.9, Tailwind 4, React Router 7, TanStack Query 5, React Hook Form + Zod, Recharts 3, FullCalendar 6 (with the Luxon plugin so times render in the clinic's IANA timezone), Luxon, Phosphor icons, and Alexandria (self-hosted through Fontsource; nothing is fetched from Google). Versions are pinned to stable majors.

## Running it

```powershell
npm run dev:test-db    # API on :3100, pinned to mawid_test (same guard as the integration tests)
npm run web:dev        # Vite on :5173, proxying /api → :3100 (same origin, so session cookie + CSRF just work)
npm run web:build      # typecheck + production build
```

`mawid` stays frozen: the new tables exist only in `mawid_test` until the reviewed rollout (`05-migration-review.md`).

## Pages and the APIs they use

| Area | Route | API |
|---|---|---|
| Public | `/` home (ledger motif, real clinic list) | `GET /public/clinics` |
| | `/clinics` discovery | `GET /public/clinics?q&city&page` |
| | `/clinics/:slug` clinic page + booking | `GET /public/clinics/:slug`, `GET …/availability`, `POST …/appointments` |
| Auth | `/login`, `/signup` (safe `next=` redirect) | `GET /auth/csrf`, `POST /auth/login`, `POST /auth/signup`, `POST /auth/logout`, `GET/PATCH /auth/me` |
| Patient | `/me/appointments` (upcoming / past, cancel, change time) | `GET /me/appointments`, `POST /me/appointments/:id/cancel`, `/reschedule`, public availability |
| | `/notifications` | `GET /me/notifications`, `POST …/:id/read`, `POST …/read-all` |
| | `/profile` (name, language) | `PATCH /auth/me` |
| Workspace | `/workspace`, `/workspace/new` | `GET /auth/me`, `POST /clinics` |
| Staff (all roles) | `/c/:slug/today` (time × doctor ledger + side panel) | `GET /clinics/:slug/appointments`, `GET …/doctors`, appointment actions |
| | `/c/:slug/calendar` (FullCalendar, clinic timezone, business hours) | `GET …/appointments`, `GET …/working-hours`, `GET …/doctors` |
| | `/c/:slug/appointments` (filters, `?focus=` from notifications) | `GET …/appointments`, `GET …/appointments/:id` |
| | Appointment panel: confirm / complete / no-show / cancel / move | `POST …/appointments/:id/{confirm,complete,no-show,cancel,reschedule}`, `GET …/availability` |
| Front desk | `/c/:slug/appointments/new` (search patient or walk-in, live slots) | `GET …/patients?q`, `GET …/services`, `GET …/doctors?serviceId`, `GET …/availability`, `POST …/appointments` |
| | `/c/:slug/patients`, `/c/:slug/patients/:id` | `GET/POST …/patients`, `GET/PATCH …/patients/:id` |
| Owner | `/c/:slug/doctors`, `/c/:slug/doctors/:id` (profile, services, specialties, hours, leave) | `GET/POST …/doctors`, `PATCH …/doctors/:id`, `PUT …/doctors/:id/{services,specialties,working-hours}`, `GET …/members`, exceptions |
| | `/c/:slug/services`, `/c/:slug/specialties` | `GET/POST/PATCH …/services`, `…/specialties` |
| | `/c/:slug/hours` (clinic hours + closures) | `GET/PUT …/working-hours`, `GET/POST/DELETE …/schedule-exceptions` |
| | `/c/:slug/team` | `GET/POST …/members`, `PATCH …/members/:id` |
| | `/c/:slug/settings` | `GET/PATCH /clinics/:slug` |
| | `/c/:slug/analytics` (KPIs, revenue, daily chart + table view, by doctor, top services) | `GET …/analytics/overview` |
| | `/c/:slug/audit` | `GET …/audit-logs` |
| Doctor | `/c/:slug/my-schedule` (own hours and leave) | `GET/PUT …/doctors/:ownId/working-hours`, exceptions |
| Super admin | `/admin`, `/admin/clinics`, `/admin/users`, `/admin/audit` | `GET /admin/overview`, `GET/PATCH /admin/clinics`, `GET/PATCH /admin/users`, `GET /admin/audit-logs` |

Backend change made for the UI: `/auth/me` clinics now include the caller's own `memberId` and `doctorProfileId`, so a doctor can open their own schedule. The server still enforces ownership.

## Cross-cutting

- **Roles:** the navigation and pages adapt to the role. A forbidden page shows "Your role doesn't allow this action", and the API independently returns 403/404 (verified).
- **i18n:** English by default, Arabic with full RTL (`dir`/`lang` on `<html>`, logical CSS only, mirrored arrows). The two dictionaries are type-checked against each other. The account's saved language is applied on login. API `error.code` values are translated. Dates and times are always shown in the clinic's timezone, with Western digits.
- **Accessibility:**
  - Visible labels, with errors placed under the field and linked via `aria-describedby`.
  - A focused error summary after a failed submit.
  - Native `<dialog>` (focus trap, Esc).
  - A skip link, focus moves to `<main>` on navigation, and visible focus rings.
  - Statuses always shown as icon + text + color.
  - Touch targets of at least 44px, reduced motion respected, and AA contrast verified for the palette.
- **States:** skeletons while loading, an error panel with retry, purposeful empty states, a route error boundary, toasts in a polite live region.
- **Security in the client:** no tokens in storage, CSRF token held in memory only and refreshed on rotation, safe post-login redirects, query cache cleared on login and logout.
- **Performance:**
  - Everything except the home page is code-split.
  - A patient's first load is about 143 KB gzipped (entry + React) plus 9 KB of CSS.
  - The calendar (77 KB) and charts (122 KB) load only on the staff pages that use them.

## Browser test log (real UI → real API → `mawid_test`)

| Flow | Result |
|---|---|
| Owner signup (validation errors, then success) | ✓ |
| Login: wrong password → "Wrong email or password."; correct → back to `next` | ✓ |
| Open clinic (slug generated from the name) → owner workspace | ✓ |
| Add service (bilingual, exact price 350.50) | ✓ |
| Doctor profile for the owner, link service, weekly hours with a lunch break; overlap validation | ✓ (fixed a crash found here) |
| Public discovery → clinic page → real slots in Cairo time, break shown as a ruled gap | ✓ |
| Visitor picks 10:30 → "Log in to book" → sign up → back with the same selection → phone validation → booked (PENDING) | ✓ |
| Booked slot and the overlapping ones disappear for everyone; touching slots stay | ✓ |
| Patient "Change time" from real availability → PENDING again | ✓ |
| Owner notified (booked + new time) → opens the exact appointment → confirms | ✓ |
| Walk-in booking (patient search; new walk-in) → Today ledger → Move to another time | ✓ |
| Calendar week view shows both appointments at the correct Cairo times | ✓ |
| Team: unknown email error; add receptionist and doctor; doctor profile for the new doctor | ✓ |
| Receptionist: front-desk nav only; analytics page and API refused (403); books with the second doctor | ✓ |
| Doctor: sees only own appointments; another doctor's appointment 404; patients 403; edits own hours (Arabic UI); editing another doctor's hours 403 | ✓ |
| Arabic RTL across the workspace; account language restored on login | ✓ |
| Super admin: overview, users, suspend clinic (public 404, staff 404, audited with reason), reactivate | ✓ |
| Analytics and empty states | ✓ |
| Patient receives "Confirmed", opens it, cancels with a reason → shown under Past & cancelled | ✓ |
| No horizontal overflow on all 26 routes at 375px (after fixing two grids) | ✓ |

Bugs found and fixed during browser testing: a query-cache key collision (crashed the doctor page); grids overflowing on narrow screens; time inputs stretching full width; misleading "Closed" opening hours for clinics that only use doctor hours; Arabic comma in English addresses; danger buttons losing their color; toggle buttons labelled with a state instead of an action; the workspace not learning a new doctor profile until reload; dialogs opening scrolled; staff booking not opening the booked day; the back arrow not mirroring in RTL.

## Limitations

- There are no automated browser (E2E) tests in the repo. The flows above were verified manually in the browser. Playwright would need a browser download, which was not requested.
- The calendar loads at most 100 appointments per visible range and shows a count when there are more.
- Analytics covers past periods only (no forecast of upcoming bookings).
- Members are added by existing account email. There are no email invitations, and no email provider is configured.
- Not yet run on the production `mawid` database (rollout held).
