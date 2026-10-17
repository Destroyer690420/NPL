# College Auction Manager

A small, dependable web app for running a college cricket auction (IPL-style) and for teams to
watch their own portfolio live.

Two surfaces, nothing else:

- **Admin console** — the organizer's purchase desk. Teams, players (manual + CSV import),
  purchase recording with idempotent safety, reversals with reasons, transactions and audit trail,
  event lifecycle, consistency checks.
- **Private team panel** — a team member enters a 4-digit PIN and sees only their own team: purse,
  spend, points, roster, newest purchase first — refreshed automatically, no manual reloads.

There is deliberately **no** bidding UI, projector, leaderboard or cross-team visibility.

---

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start (local development)](#quick-start-local-development)
- [Supabase setup (one time)](#supabase-setup-one-time)
- [Admin login (interim shared credentials)](#admin-login-interim-shared-credentials)
- [Hosting the app](#hosting-the-app)
- [Demo data](#demo-data)
- [CSV import format](#csv-import-format)
- [Scripts reference](#scripts-reference)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Project status and known limitations](#project-status-and-known-limitations)

---

## How it works

- **All writes go through one Supabase Edge Function** (`auction-api`, Deno). The browser has no
  database write permission at all. Each action (a purchase, a reversal, a PIN reset, …) is planned
  from freshly-read state by pure, unit-tested TypeScript and applied atomically by a single
  Postgres function (`apply_plan`) with preconditions — totals, player status, purchase records and
  audit logs can never drift apart.
- **Purchases are idempotent.** The purchase document id *is* the client's `requestId`. If a submit
  times out and is retried, the retry returns the original result instead of charging twice.
  Concurrent attempts to sell the same player resolve inside the atomic write: exactly one wins.
- **Reads go through three self-validating database functions.** `api_public_config` (public),
  `api_admin_read` and `api_team_read` (token-checked). The `anon` database role may execute these
  three functions and nothing else; every other table has RLS enabled and all privileges revoked
  from client roles.
- **Team access is a short-lived, revocable session.** `verifyTeamPin` checks the PIN server-side
  (HMAC, constant-time compare, 3-layer rate limiting), then issues an opaque 256-bit session token
  bound to exactly one `{eventId, teamId, sessionId}`. Only the token *hash* is stored; every read
  and action re-validates the session row, so revocation and expiry take effect immediately. PINs
  themselves are never stored or readable — only an HMAC verifier and a lookup index.
- **Admin access is server-verified too.** The interim ID/password is checked by the `adminLogin`
  action (constant-time, rate limited) which creates a database session — the browser never decides
  who is an admin and stores only the opaque token.
- **No fake data, ever.** Without Supabase configuration the app shows a setup screen listing the
  missing keys; it never falls back to an in-memory mock.
- **Live updates by polling.** The free tier has no Realtime here; pages re-fetch every 4 seconds
  and on tab focus. Paused/offline states are visible in the header badge, stale data is labelled.

Business rules live in `supabase/functions/_shared/` — pure TypeScript imported by both the edge
function and the web client (via the `@shared` alias), covered by unit tests, so client and server
can never disagree about money.

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 LTS+ (20.19+ works) | everything |
| npm | 10+ | everything |
| Supabase project | free tier, **no credit card** | database + edge function |
| Supabase CLI | via `npx supabase` (no install needed) | deploying the edge function (one time) |
| Docker | **not required** | only for local `supabase start`, which this project does not use |

## Quick start (local development)

```bash
npm run setup                     # npm install
Copy-Item .env.example .env.local # bash: cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see below)
npm run dev                       # http://localhost:5173
```

Without `.env.local` values the app starts in a clearly-marked setup screen and tells you which
keys are missing. That is intentional: there is no mocking mode.

## Supabase setup (one time)

1. **Create the project** — [supabase.com](https://supabase.com) → New project (free plan, no card).
   Pick a region close to you; remember the database password it asks for (it stays in the
   dashboard, the app never needs it).
2. **Web config** — Project Settings → API: copy the *Project URL* and the *publishable* (or legacy
   *anon*) key into `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
3. **Database schema** — SQL Editor → New query → paste the whole contents of
   `supabase/migrations/20261017000001_init.sql` → Run (expect “Success. No rows returned”), then
   do the same with `supabase/migrations/20261017000002_read_payload_ids.sql`. Run them **in
   order**; both are safe to re-run.
   This creates the tables, the atomic `apply_plan` function, the session/rate-limit functions, the
   three read APIs and all privileges. RLS is deny-all and the `anon` role cannot touch any table
   directly.
4. **Edge function** — one shared dispatcher that carries every action. Deploy it with the CLI
   (one interactive login; deploys from your machine, no Docker):

   ```bash
   npx supabase login                          # opens the browser once
   npx supabase link --project-ref <your-ref>  # ref is in the dashboard URL / settings
   npx supabase functions deploy auction-api   # verify_jwt=false comes from config.toml
   ```

   Alternatively: Dashboard → Edge Functions → **Deploy a new function** and upload the
   `supabase/functions/auction-api` folder (must be a **single** function named `auction-api`).
   In the function's settings, turn **Enforce JWT verification** OFF.
5. **Function secrets** — Dashboard → Edge Functions → auction-api → **Manage secrets** (or
   `npx supabase secrets set ADMIN_LOGIN_ID=... ADMIN_LOGIN_PASSWORD=...`):

   | Secret | Default | Purpose |
   | --- | --- | --- |
   | `ADMIN_LOGIN_ID` | `admin` | admin login ID |
   | `ADMIN_LOGIN_PASSWORD` | `admin` | **change before any real event** |
   | `PIN_HMAC_SECRET` | auto | optional: pin the PIN HMAC secret; when unset the database generates one and stores it server-side (fine for a single project) |

   These are the *only* server-side values to configure. Never put the **service_role key** or the
   **database password** in `.env.local` or any frontend file — the app never needs them.

## Admin login (interim shared credentials)

For now the admin console uses a simple **admin ID + password** instead of email sign-in:

- Defaults: ID `admin`, password `admin`.
- The browser **never checks the credentials** — it sends them to the `adminLogin` action of the
  edge function, which verifies them (constant-time, rate limited) and creates a database session.
  The client stores only the opaque session token.
- The login response tells the app whether you are still on the defaults; if so, the console shows
  a warning banner until you change them.

**Change the password before any real event**: Dashboard → Edge Functions → auction-api → Manage
secrets → edit `ADMIN_LOGIN_PASSWORD` (or `npx supabase secrets set ADMIN_LOGIN_PASSWORD=...`).
Takes effect immediately; no redeploy needed.

Honest caveats (temporary by design, see `docs/SECURITY.md`): the credentials are shared between
everyone who operates the console, they live as one secret value, and there is no per-person
identity. The audit log records all admin actions under one organizer identity (`organizer`).

## Hosting the app

The web app is a static bundle (`npm run build` → `dist/`). Any free static host works — none of
these require a card: **Netlify**, **Vercel**, **Cloudflare Pages**, **GitHub Pages**.

1. `npm run build`
2. Upload/publish `dist/`.
3. Add a SPA fallback so client routes resolve (`/admin`, `/team`): a `_redirects` file with
   `/* /index.html 200` (Netlify/Cloudflare) or a rewrite rule (Vercel).
4. In the Hosting settings, set the build command `npm run build` and publish directory `dist`.

The team panel URL to share is simply `https://<your-site>/team`.

## Demo data

Opt-in only, always labelled (event `[DEMO] …`, every team and player prefixed “Demo”), and guarded
so it cannot touch a real event: the event id must be `demo` or start with `demo-`.

```bash
# reads .env.local; signs in through the real edge function and prints the project URL first
node scripts/seed-demo.mjs --password '…' --purchases 6
```

(Admin ID defaults to `admin`; `--id` overrides. Password defaults to `admin` — matches the interim
login until you change it.)

It drives the real `auction-api` actions, so the demo data follows production rules (totals, PIN
hashing, audit logs). It prints each team's PIN once. Remove demo data from the Supabase Table
Editor: delete rows with `event_id = 'demo'` in `teams`, `players`, `purchases`, `audit_logs`,
`team_secrets`, then the `demo` row in `events`.

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
| `npm run build` | typecheck (app + edge) and build `dist/` |
| `npm run typecheck` | app + edge function typecheck |
| `npm run lint` | ESLint over the repo |
| `npm test` | unit + component tests (Vitest) |
| `npm run seed:demo -- …` | opt-in demo data (see above) |
| `npm run setup` | install dependencies |

## Environment variables

**Web app (`.env.local`, copied from `.env.example`)** — public identifiers only, never secrets:

| Key | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | project URL (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | publishable key (`sb_publishable_…`) or legacy anon key |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | alternative name, accepted if the anon key is empty |
| `VITE_AUCTION_FUNCTION_NAME` | edge function name, default `auction-api` |
| `VITE_DEFAULT_EVENT_ID` | optional override of the default event id |

**Server-side (Supabase secrets)** — see
[Supabase setup](#supabase-setup-one-time): `ADMIN_LOGIN_ID`, `ADMIN_LOGIN_PASSWORD`,
`PIN_HMAC_SECRET` (optional). Tunable non-secret values (session TTLs, retry budgets) have sane
defaults in `supabase/functions/auction-api/lib/config.ts`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| “Supabase is not configured yet” screen | Fill `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `.env.local`, restart `npm run dev`. |
| Reads fail with “The server is unavailable right now” right after setup | The SQL migrations have not run (or run partially). Run both files from `supabase/migrations/` in order in the SQL Editor. |
| Everything fails with 404 after deploy | The edge function name does not match — deploy `auction-api` (or set `VITE_AUCTION_FUNCTION_NAME`). |
| “Admin ID or password is incorrect” | Set/check the `ADMIN_LOGIN_ID` / `ADMIN_LOGIN_PASSWORD` secrets of `auction-api`. |
| Warning banner “Using the default admin credentials” | The deployment still runs with admin/admin. Change the `ADMIN_LOGIN_PASSWORD` secret. |
| Login says “Too many attempts” | Rate limiting is doing its job. Wait for the cooldown. |
| PIN login says “Too many attempts” | Same; windows and lockouts are in `lib/config.ts` (edge function). |
| Team panel session ends early | Session TTL elapsed or the organizer revoked/reset sessions. Enter the current PIN again. |
| Header badge says “Offline — showing cached data” | A refresh failed; the last good data stays visible and polling keeps retrying. |
| Purchase button stuck on “Check status” | The request may or may not have been recorded. Use the built-in check; the idempotent `requestId` makes retrying safe — a retry can never double-charge. |

## Project status and known limitations

Verified in this repository: 117 unit/component tests across 10 files covering all financial and
ownership logic including a full simulated auction, admin/team login flows and edge-function
internals; app + edge typecheck, ESLint and the production build (`~633 kB`, no more Firebase SDK)
all pass.

Honest limitations — read this before a real event:

- **Live end-to-end verification is the remaining step.** The code is fully ported, and the
  deployed edge function passed live smoke tests on 2026-10-17 (admin login with sessions,
  authenticated + public reads, CORS preflight). Two remaining items: run
  `supabase/migrations/20261017000002_read_payload_ids.sql` in the SQL Editor (read payloads need
  row ids for the client), then do the one-minute test purchase from
  `docs/EVENT_DAY_RUNBOOK.md` §2 before trusting the system with real sales.
- **Admin auth is an interim shared-credential design** (admin ID/password verified server-side,
  minting an opaque session): shared identity, one secret value, no per-person accounts, no MFA.
  Change the password before real events; per-user auth can be restored later.
- **No local emulator path** (Docker was deliberately avoided): verification runs against the free
  Supabase project, plus the offline test suite.
- **The free tier** comfortably covers an event of this size (a few hundred rows, a handful of
  operators, polling reads). No paid feature is used.
- **Orphaned database rows**: demo data is removed via the Table Editor (see above); there is no
  in-app delete-event action.

See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full phase-by-phase record and
[`docs/EVENT_DAY_RUNBOOK.md`](./docs/EVENT_DAY_RUNBOOK.md) for the operating procedure.
