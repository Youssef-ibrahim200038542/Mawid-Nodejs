# Mawid — Design direction (for approval)

Status: **proposal, nothing implemented.** Frontend work starts only after one direction is approved.
Prepared with both project skills: **Frontend Design** set the identity, and **UI/UX Pro Max** set the rules and checks.

## 0. The brief, restated

- **Subject:** موعد, "appointment". A booking and operations platform for Egyptian clinics.
- **Primary jobs:**
  1. A patient finds a clinic, picks a doctor and service, and books a time in under a minute, on a phone, in Arabic or English.
  2. Clinic staff run their day: today's schedule, confirmations, walk-ins.
- **Audiences:** patients (mobile, mixed literacy, Arabic first in practice); receptionists (desktop, all day, speed); owners (overview, money); doctors (their own day); the super admin.
- **Hard constraints:** English default plus full Arabic RTL; WCAG AA; no generic SaaS kit; no blue medical template.

## 1. What UI/UX Pro Max said, and what we keep

`--design-system "clinic appointment booking healthcare SaaS"` recommended Neumorphism with calm cyan (#0891B2), health green and Atkinson Hyperlegible.

- **Rejected look.** That is the typical medical template you ruled out. Neumorphism is flagged *accessibility risk: high* (low-contrast embossed edges), and Atkinson Hyperlegible has **no Arabic glyphs**.
- **Kept rules**, applied to whichever direction is approved:
  - Text contrast ≥ 4.5:1, visible 2–3 px focus rings, `prefers-reduced-motion`.
  - Touch targets ≥ 44 px, 16 px minimum body text on mobile, 8 px spacing rhythm.
  - Labels on every input, errors next to the field, plus an error summary on submit.
  - Skeletons for loads over 1 s; one primary action per screen.
  - SVG icons only (Phosphor), never emoji.
  - Tables become horizontal scroll or card lists on mobile.
  - Breakpoints 375 / 768 / 1024 / 1440.
- **Fonts with Arabic and Latin** from its font search: Alexandria, Fustat, Vazirmatn, Noto Kufi Arabic, Reem Kufi, Mada.

## 2. Three directions

### A. «دفتر المواعيد» Daftar — the appointment ledger · **recommended**

Every Egyptian clinic runs on the receptionist's appointment book: ruled time rows, names written in, crossed out, stamped. Mawid is that book, made live. **Time is the visual system.** The hero, the booking flow and the dashboards are all built on one ruled time axis, and the times themselves are the typography.

| Token | Hex | Role |
|---|---|---|
| Paper | `#F7F8F6` | page background (cool neutral, not cream) |
| Ink | `#17201D` | text, primary UI (green-black, not #111) |
| Graphite | `#56615C` | secondary text (6.05:1 on Paper) |
| Malachite | `#0B6E4F` | brand, available, primary action (6.25:1 on white; white text on it 6.25:1) |
| Saffron | `#E0A526` | pending / needs attention (fill only, Ink text on it: 7.6:1) |
| Carmine | `#B42335` | cancelled / destructive (always with an icon and text; 6.1:1 on Paper) |

- **Type:** **Alexandria** (variable 100–900, Arabic + Latin, named for an Egyptian city) for everything. Times are set large at weight 600 with tabular figures, e.g. **10:30** with "Dr. Mona · Consultation" small beneath. Headings use weight to carry the hierarchy, and nothing is ALL CAPS. Arabic gets +0.1 line-height.
- **Layout:** left-aligned (right-aligned in Arabic, through logical properties). Pages are a **time column** plus a details panel, never a grid of identical cards. Hairline rules appear only where they carry meaning: the ruled time grid. Radius is 6 px on controls and 0 on ledger rows. Shadows exist only for things that float (menus, the booking sheet).
- **The one memorable thing:** booking a slot "inks" it into the ledger. That's a single 400 ms stamp animation on confirm, removed under reduced motion.
- **Risk:** it needs real schedule data in the hero (we have it: the public availability API).

### B. «لافتة» Lafta — wayfinding signage

Hospital and metro wayfinding: bold zone colors per area (patient = Malachite, clinic = Indigo `#2F3A8F`, admin = Graphite), oversized bilingual signage headings set in Reem Kufi with Mada for body, and pictograms for specialties.

- Very legible and very "Egyptian street".
- Louder and more playful, and the many colors are harder to keep calm on dense staff screens.

### C. «تذكرة» Tadhkira — the queue ticket

Built around the waiting-room ticket ("رقم دورك"): confirmations as perforated tickets, large ticket numbers, a printable or saveable appointment pass. Fonts: Fustat with Vazirmatn, on a warm-grey palette with one signal color.

- Charming for patients.
- The ticket metaphor doesn't carry staff dashboards well, so it would end up being two design languages.

**Why A:** it's the only one where a single idea, the ruled time axis, serves *every* audience. The patient picks a time on it, reception runs the day on it, the doctor sees their column, and the owner sees it aggregated. The reasoning comes straight from the product.

## 3. Direction A in practice

Public clinic page and booking (mobile-first; desktop shown):

```
┌──────────────────────────────────────────────────────────────┐
│ Mawid                          Clinics   EN | ع   Log in      │
├──────────────────────────────────────────────────────────────┤
│ Nile Dental Clinic                       Zamalek, Cairo       │
│ Dentistry · Orthodontics                 Sun–Thu 09:00–17:00  │
│                                                               │
│ Service  [ Consultation · 30 min · 300 EGP ▾ ]                │
│ Doctor   ( Any )  ( Dr. Mona Adel )  ( Dr. Karim )            │
│                                                               │
│ Tue 14  Wed 15  Thu 16  Sun 19  Mon 20   →                    │
│ ─────────────────────────────────────────────────────────    │
│ 09:00  ░░░░░░░░░ booked                                       │
│ 09:30  10:00  10:15  10:30            ← free times, large    │
│ ───── break 13:00–14:00 ──────────────────────────────────   │
│ 14:00  14:15  15:00                                           │
│                                                               │
│ ┌ Your appointment ──────────────────────────────────────┐   │
│ │ 10:30  Tuesday 14 January · Dr. Mona Adel            │   │
│ │ Consultation · 30 min · 300 EGP     [ Book 10:30 ]   │   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

Reception "today" (desktop):

```
┌ Today · Tue 14 Jan ───────────── [ + Book walk-in ] ┐┌ Selected ─────────────┐
│        Dr. Mona        Dr. Karim        Dr. Owner     ││ 10:30 → 11:00          │
│ 09:00  ▌Sara A. ✓      ·                ▌Omar ◷        ││ Sara Ahmed             │
│ 09:30  ·               ▌Walk-in ✓       ·              ││ +20 100 …              │
│ 10:00  ▌Ali M. ◷ ←needs confirm         ·              ││ Consultation · 300 EGP │
│ 10:30  ▌Sara A.        ·                ·              ││ [ Confirm ] [ Move ]   │
│ ─ break ─────────────────────────────────────────────  ││ Cancel…                │
└────────────────────────────────────────────────────────┘└───────────────────────┘
✓ confirmed  ◷ pending  ✕ cancelled. Each status = icon + label + color, never color alone.
```

## 4. System rules (any direction)

- **Bilingual:**
  - `lang` and `dir` on `<html>`; Tailwind logical utilities only (`ms-`/`me-`, `ps-`/`pe-`, `start`/`end`).
  - Icons that imply direction are mirrored in RTL.
  - All copy goes through translation keys, and API `error.code` values map to translated messages.
  - Numerals: Western digits by default, with Arabic-Indic digits as a user setting.
  - Dates are formatted with `Intl` in the clinic's timezone.
- **Tokens:** CSS variables for color, space, radius and type, mapped into Tailwind, so there are no raw hex values in components.
- **Components:** button, input, select, combobox, date strip, time grid, slot chip, status badge, sheet/dialog, toast, table → card list, empty state, skeleton, error panel with retry.
- **Calendar:** FullCalendar resource/time-grid views for staff, themed with the tokens. It supports RTL and an `ar` locale. The patient booking time grid is custom (lighter, mobile-first).
- **Charts (owner):** Recharts in a two-color palette (Malachite and Graphite) with direct labels and a table fallback.

## 5. After approval: frontend phases

1. `web/`: Vite + React + TS + Tailwind + Router + TanStack Query + RHF + Zod, with an i18n setup (en/ar, RTL) and tokens. A dev proxy sends `/api` to Express, so it's one origin and the CSRF/session flow works unchanged.
2. Public site, clinic discovery, clinic page and booking flow, plus auth and the patient portal (`/me`).
3. Staff app with role-aware navigation: reception today and calendar, appointments, patients; owner settings (services, specialties, doctors, hours, exceptions, members), analytics and audit; doctor's own day and schedule.
4. Super admin console.
5. Accessibility and responsive review against the UI/UX Pro Max checklist, screenshots in both languages, and a k6 load test of booking.
