# College Auction Manager

A small, dependable web app for running a college cricket auction (IPL-style) and for teams to
watch their own portfolio in real time.

Two surfaces, nothing else:

- **Admin console** — the organizer's purchase desk. Teams, players (manual + CSV import),
  purchase recording with idempotent safety, reversals with reasons, transactions and audit trail,
  event lifecycle, consistency checks.
- **Private team panel** — a team member enters a 4-digit PIN and sees only their own team: purse,
  spend, points, roster, newest purchase first — updated live, no refresh needed.

There is deliberately **no** bidding UI, projector, leaderboard or cross-team visibility.

---

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start (local development)](#quick-start-local-development)
- [Firebase setup (one time)](#firebase-setup-one-time)
- [Admin login (interim shared credentials)](#admin-login-interim-shared-credentials)
- [Deploy](#deploy)
- [Emulator setup](#emulator-setup)
- [Demo data](#demo-data)
- [CSV import format](#csv-import-format)
- [Scripts reference](#scripts-reference)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Project status and known limitations](#project-status-and-known-limitations)

---

## How it works

- **All writes go through Cloud Functions.** Firestore security rules deny every client write. A
  purchase, a reversal, a PIN reset — each is one callable function running one Firestore
  transaction over the exact set of documents involved, so totals, player status, purchase records
  and audit logs can never drift apart.
- **Purchases are idempotent.** The purchase document id *is* the client's `requestId`. If a submit
  times out and is retried, the retry returns the original result instead of charging twice.
  Concurrent attempts to sell the same player resolve inside the transaction: exactly one wins.
- **Team access is a short-lived, revocable session.** `verifyTeamPin` checks the PIN server-side
  (HMAC, constant-time compare, rate limited), then mints a Firebase custom token bound to exactly
  one `{eventId, teamId, sessionId}`. Firestore rules re-validate the session document on every
  read, so revocation and expiry take effect immediately. PINs themselves are never stored or
  readable — only an HMAC verifier and a lookup index live in server-only collections.
- **Admin access is server-verified too.** The interim ID/password is checked by the `adminLogin`
  callable (constant-time, rate limited) which mints the admin custom token — the browser never
  decides who is an admin, and the Firestore rules/callables are unchanged.
- **No fake data, ever.** Without Firebase configuration the app shows a setup screen listing the
  missing keys; it never falls back to an in-memory mock.

Business rules live in `functions/src/shared/` — pure TypeScript imported by both the Cloud
Functions and the web client (via the `@shared` alias), covered by unit tests, so client and server
can never disagree about money.

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 LTS (20.19+ works for the web app; functions target Node 22) | everything |
| npm | 10+ | everything |
| Firebase CLI | installed locally as a dev dependency (`npx firebase`) | deploy, emulators |
| Java | **21+** | Firebase Emulator Suite only |
| Firebase project | Spark is enough to develop; **Blaze** is required to deploy Cloud Functions | production |

## Quick start (local development)

```bash
npm run setup            # installs root + functions dependencies
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
# fill in VITE_FIREBASE_* from Firebase Console -> Project settings -> Web app
npm run dev              # http://localhost:5173
```

Without `.env.local` values the app starts in a clearly-marked setup screen and tells you which
keys are missing. That is intentional: there is no mocking mode.

## Firebase setup (one time)

1. **Create the project** — [console.firebase.google.com](https://console.firebase.google.com).
2. **Web app config** — Project settings → Your apps → Web app. Copy the config values into
   `.env.local` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`).
3. **Authentication** — open **Authentication → Get started**. No sign-in provider needs to be
   enabled: the app uses custom tokens only (admin login and team PIN sessions both mint them).
4. **Firestore** — create the database (production mode). Rules and indexes are deployed from this
   repository.
5. **Cloud Functions** — requires the **Blaze** plan. Functions run in `FUNCTIONS_REGION`
   (default `us-central1`). If you change it, set `VITE_FUNCTIONS_REGION` in `.env.local` to match.
6. **PIN secret** — set the HMAC secret used to verify team PINs:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   npx firebase functions:secrets:set PIN_HMAC_SECRET   # paste the generated value
   ```

   Without it, deployed functions refuse to verify PINs (the development fallback only works in
   the emulator).
7. **Project alias** — `cp .firebaserc.example .firebaserc` and put your project id in it.
8. **Admin credentials** — see [Admin login](#admin-login-interim-shared-credentials). Change the
   default password in `functions/.env` before any real event.
9. **Optional hardening** (see `docs/SECURITY.md`):
   - `functions/.env` (copy from `functions/.env.example`): set `ALLOWED_ORIGINS` to your hosting
     origins, tune session TTL and PIN attempt limits.
   - App Check: register a reCAPTCHA v3 site key, set `ENFORCE_APP_CHECK=true` in `functions/.env`
     and `VITE_APP_CHECK_SITE_KEY` in `.env.local`.

## Admin login (interim shared credentials)

For now the admin console uses a simple **admin ID + password** instead of email sign-in:

- Defaults: ID `admin`, password `admin`.
- The browser **never checks the credentials** — it sends them to the `adminLogin` Cloud Function,
  which verifies them (constant-time, rate limited) and mints a Firebase custom token carrying the
  admin claim. All Firestore rules and callables keep working exactly as before.
- The login response tells the app whether you are still on the defaults; if so, the console shows
  a warning banner until you change them.

**Change the password before any real event.** Edit `functions/.env`:

```ini
ADMIN_LOGIN_ID=admin
ADMIN_LOGIN_PASSWORD=pick-something-long
```

then redeploy the functions (`npx firebase deploy --only functions`).

Honest caveats (temporary by design, see `docs/SECURITY.md`): the credentials are shared between
everyone who operates the console, they live as a plain env value, and there is no per-person
identity. The audit log records all admin actions under one organizer identity. Email sign-in with
per-user claims can be restored later without touching the purchase logic.

## Deploy

```bash
cp functions/.env.example functions/.env   # set ADMIN_LOGIN_PASSWORD etc. first
npm run build                             # typecheck + production build of the web app
npx firebase deploy --only firestore:rules,firestore:indexes,functions
npx firebase deploy --only hosting        # serves dist/ (firebase.json rewrites SPA routes)
```

All deploy targets exist in `firebase.json`; hosting serves `dist/` with an SPA rewrite.

## Emulator setup

The emulator harness is ready (`vitest.emulator.config.ts`, `npm run test:emulator`), but requires
**Java 21+** (firebase-tools 15 requirement) and the emulator jars on first run.

```bash
npm run emulators        # Auth :9099, Firestore :8080, Functions :5001, UI :4000
```

Then set `VITE_USE_FIREBASE_EMULATORS=true` in `.env.local` (any placeholder values work for the
`VITE_FIREBASE_*` keys). Admin login uses the `ADMIN_LOGIN_ID`/`ADMIN_LOGIN_PASSWORD` from
`functions/.env` (default admin/admin) — no user account needs to exist.

> **Status note:** on the machine where this project was built, only Java 17 was available, so the
> emulator was never started and no emulator-based (rules/function integration) test has been
> executed. The unit suites run with plain `npm test`. This is reported again under
> [Project status](#project-status-and-known-limitations) — nothing here claims otherwise.

## Demo data

Opt-in only, always labelled (event `[DEMO] …`, every team and player prefixed “Demo”), and guarded
so it cannot touch a real event: the event id must be `demo` or start with `demo-`.

```bash
# against the emulator (after `npm run emulators`)
node scripts/seed-demo.mjs --emulator --password '…'

# against a real dev project (reads .env.local; prints the project id before writing)
node scripts/seed-demo.mjs --password '…' --purchases 6
```

(Admin ID defaults to `admin`; `--id` overrides. Password defaults to `admin` — matches the interim
login until you change it.)

It drives the real callable functions, so the demo data follows production rules (totals, PIN
hashing, audit logs). It prints each team's PIN once. Remove demo data by deleting the
`events/demo` tree in the Firebase console.

## CSV import format

Players page → **Import CSV**. The whole file is validated first; every invalid row is reported
with its line number and nothing is written until you press Import.

```csv
player_id,name,points,base_price
P001,Rohit Sharma,250,20000
P002,Ishan Kishan,180,15000
```

- Required columns: **name**, **points**, **base_price**. `player_id` is optional but recommended;
  it becomes the duplicate check key for re-imports (`externalReference`).
- Header aliases are tolerated: `id`/`player_id`/`code`, `player`/`name`, `pts`/`points`/`score`,
  `price`/`base_price`/`reference price`. Column order does not matter.
- Currency symbols and thousand separators are tolerated (`₨180`, `"12,000"`).
- Duplicate player ids and duplicate names inside one file are errors; rows report their line
  number. Blank rows are ignored. Missing required columns block the import entirely.
- Caps: 400 rows per import call, points ≤ 1,000,000, whole numbers only. The Players page also
  offers the template download and a CSV export of the current pool.

## Scripts reference

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck (app + functions) and build `dist/` |
| `npm run typecheck` | app + functions typecheck |
| `npm run lint` | ESLint over the repo |
| `npm test` | unit + component tests (Vitest) |
| `npm run test:emulator` | emulator-backed suites — **requires Java 21+ and suites that do not exist yet**, see status note |
| `npm run emulators` | start the emulator suite |
| `npm run seed:demo -- …` | opt-in demo data (see above) |
| `npm run build:functions` | compile `functions/` |
| `npm run setup` | install root + functions dependencies |

## Environment variables

**Web app (`.env.local`, copied from `.env.example`)** — public Firebase web config only, never secrets:

| Key | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Firebase web app config |
| `VITE_USE_FIREBASE_EMULATORS` | `true` connects Auth/Firestore/Functions to localhost emulators |
| `VITE_FUNCTIONS_REGION` | must match `FUNCTIONS_REGION` (default `us-central1`) |
| `VITE_APP_CHECK_SITE_KEY` / `VITE_APP_CHECK_DEBUG_TOKEN` | optional App Check (reCAPTCHA v3) |
| `VITE_DEFAULT_EVENT_ID` | optional override of the default event |

**Cloud Functions (`functions/.env`, from `functions/.env.example`)** — plus the
`PIN_HMAC_SECRET` secret (see [Firebase setup](#firebase-setup-one-time)):

| Key | Default | Purpose |
| --- | --- | --- |
| `ADMIN_LOGIN_ID` | `admin` | interim admin login ID (change with the password) |
| `ADMIN_LOGIN_PASSWORD` | `admin` | **change before any real event**; verified server-side |
| `MAX_ADMIN_LOGIN_ATTEMPTS_PER_WINDOW` | `10` | per-IP admin login attempt limit |
| `ENFORCE_APP_CHECK` | `false` | verify App Check tokens on callables |
| `FUNCTIONS_REGION` | `us-central1` | deploy region |
| `TEAM_SESSION_TTL_HOURS` | `12` | PIN session lifetime |
| `MAX_PIN_ATTEMPTS_PER_WINDOW` / `PIN_ATTEMPT_WINDOW_MINUTES` | `10` / `10` | per-IP and per-PIN rate limit |
| `MAX_PIN_ATTEMPTS_GLOBAL` | `400` | global ceiling against distributed guessing |
| `ALLOWED_ORIGINS` | empty (any) | comma-separated CORS allowlist; set in production |

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| “Firebase is not configured yet” screen | Fill `VITE_FIREBASE_*` in `.env.local` (restart `npm run dev`). |
| “Admin ID or password is incorrect” | Set/check `ADMIN_LOGIN_ID` and `ADMIN_LOGIN_PASSWORD` in `functions/.env`, redeploy functions. |
| Warning banner “Using the default admin credentials” | The deployment still runs with admin/admin. Change `ADMIN_LOGIN_PASSWORD` in `functions/.env` and redeploy. |
| Admin login says “Too many attempts” | Rate limiting is doing its job. Wait for the cooldown; limit via `MAX_ADMIN_LOGIN_ATTEMPTS_PER_WINDOW`. |
| Callable fails with `CORS`/`permission` errors | Set `ALLOWED_ORIGINS` in `functions/.env` to include your hosting origin, redeploy functions. |
| PIN login says “Too many attempts” | Rate limiting is doing its job. Wait for the cooldown; limits are configurable in `functions/.env`. |
| Team panel session ends early | Session TTL (`TEAM_SESSION_TTL_HOURS`) elapsed or the organizer revoked/reset sessions. Enter the current PIN again. |
| `firebase emulators:exec` says “no longer supports Java version before 21” | Install a JDK 21+ or point `JAVA_HOME` at one. The app itself does not need Java. |
| Purchase button stuck on “Checking status” | The request may or may not have been recorded. Use the built-in check; the idempotent `requestId` makes retrying safe — a retry can never double-charge. |

## Project status and known limitations

Verified in this repository: unit/component tests (116 across 10 files) covering all financial and
ownership logic including a full simulated auction, admin/team login flows, app + functions
typecheck, ESLint and the production build all pass.

Honest limitations:

- **The app is configured for a real project** (`attendance-tracker-d08ed` via `.env.local` and
  `.firebaserc`, added 2026-10-17) **but that project is not set up yet**: probing showed Firebase
  Auth not initialized (`CONFIGURATION_NOT_FOUND`), no Firestore database (HTTP 404) and no hosting
  site. In the console: Authentication → Get started (no provider needed), create Firestore,
  upgrade to Blaze; then deploy rules/indexes/functions, set `PIN_HMAC_SECRET` and a non-default
  `ADMIN_LOGIN_PASSWORD` — then the runbook's test purchase. Until then no end-to-end run against
  live services has happened here.
- **Admin auth is an interim shared-credential design** (admin ID/password verified server-side,
  minting the admin custom token): shared identity, plain env password, no per-person accounts, no
  MFA. Change the password before real events; email/claims per-user auth can be restored later.
- **The project name does not match the app** (`attendance-tracker-d08ed`) — cosmetic only; rename
  in the console if you want, the project id itself never changes.
- **Emulator-based rules/functions integration tests were skipped**: firebase-tools requires
  Java 21+, the build machine had Java 17, and the user chose to skip installing one. The harness
  is ready; writing and running `tests/emulator/**` on a Java 21 machine is the remaining
  verification step.
- App Check is implemented but opt-in; enable it for production.
- The web bundle is a single ~1 MB chunk (Firebase SDK dominates); fine for this scale.

See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full phase-by-phase record and
[`docs/EVENT_DAY_RUNBOOK.md`](./docs/EVENT_DAY_RUNBOOK.md) for the operating procedure.
