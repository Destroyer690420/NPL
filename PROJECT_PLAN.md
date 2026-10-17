# PROJECT_PLAN — College IPL Auction Manager

Authoritative product spec: [`college_ipl_auction_opencode_prompt.md`](./college_ipl_auction_opencode_prompt.md)

This plan is updated after every phase with what was **actually built and verified**.
Nothing is marked done unless it was executed and observed to work.

---

> **2026-10-17 — Platform change COMPLETE in code: Firebase → Supabase.**
> The organizer's Firebase project cannot be upgraded to Blaze (no card), which blocks
> deploying Cloud Functions and secrets. By organizer decision, the backend was ported to
> Supabase (free tier, no card). Current state:
> - **Phase 8 (backend) COMPLETE, committed (`6fd8b38`):** Postgres schema, revoke-all +
>   deny-by-default rules, an atomic write pipeline with preconditions, and a single Edge
>   Function carrying all 19 actions. The tested domain logic and handlers were reused
>   unchanged behind a Firestore-compatible shim.
> - **Phase 9 (web client) COMPLETE (committed alongside this update):** the browser now
>   speaks Supabase — session-token auth for admin and teams, polling reads through the
>   three read RPCs, reworked seed script, tests and docs. Verified offline: web `tsc`,
>   edge `tsc`, 117/117 unit tests, ESLint, production build.
> - **Migration fix-up:** the initial SQL returned read rows without their `id`; a follow-up
>   migration (`20261017000002_read_payload_ids.sql`, written during Phase 9) merges the row
>   id into every read payload. **The user must run it once** in the SQL Editor.
> - **Deployed and live-verified (2026-10-17):** `auction-api` is deployed and answering over
>   HTTPS. Verified against the live project: `adminLogin` with admin/admin returns a session
>   (`role: superAdmin`, `usingDefaultCredentials: true`), session-authenticated and public
>   reads work, and the browser CORS preflight is correct. Two deploy-time bugs were fixed on
>   the way (extensionless imports; `deno.json` location) — details in the verification log.
> - **Still pending:** running migration 002 and the in-app end-to-end run (create event →
>   team → player → purchase → team PIN). Migration 001 was applied by the organizer on
>   2026-10-17.
> - Docs (README, SECURITY, DATA_MODEL, runbook) were rewritten for the Supabase design
>   during Phase 9.

---

## 0. Repository inspection (Phase 0) — COMPLETE

| Item | Finding |
| --- | --- |
| Contents before starting | Only `college_ipl_auction_opencode_prompt.md` (the spec). No application code, no config, no git repo. |
| Existing stack | None — greenfield. Stack chosen per spec §2: React + Vite + TypeScript, Tailwind CSS v4, React Router, Zod, Firebase Auth + Firestore + Cloud Functions (v2, Node 22), Vitest + Testing Library. |
| Tooling available | Node v24.13.0, npm 11.6.2, Java 17 (Firestore/Functions emulators), git 2.52. Firebase CLI installed as a dev dependency (`npx firebase`). |
| External dependency | No Firebase project, credentials or service account exist in the workspace. Nothing was fabricated: the app uses `.env` values, and without them shows an explicit "Firebase not configured" setup screen instead of fake data. |

## 1. Product surface summary

Two surfaces only: **admin console** (full control, records purchases) and **private team panel**
(read-only portfolio for exactly one team, live via Firestore listeners). No bidding UI, no
projector, no cross-team visibility.

---

## Phase 1 — Project scaffold and design system

**Status: COMPLETE (verified: `npm run test`, `npm run build`, `npm run lint`)**

- [x] `package.json` (Vite 8, React 19, TypeScript 5.9, Tailwind 4, React Router 7, Zod 4, Lucide, Firebase 13)
- [x] `vite.config.ts` (aliases `@/` and `@shared/`, Vitest jsdom project)
- [x] `vitest.emulator.config.ts` (node environment, sequential, for emulator suites)
- [x] `tsconfig.json` (strict, `noUnusedLocals`, `verbatimModuleSyntax`)
- [x] `eslint.config.js` (flat config, typescript-eslint, react-hooks)
- [x] `index.html`, `src/index.css` design tokens (iOS/Dream11-inspired light theme, one green accent)
- [x] `.gitignore`, `.env.example` (names only, no secrets)
- [x] `firebase.json`, `.firebaserc.example`, `firestore.rules`, `firestore.indexes.json`

## Phase 2 — Shared domain layer (pure, testable)

**Status: COMPLETE (verified: 86 unit tests pass)**

Lives in `functions/src/shared/` and is imported by **both** the Cloud Functions and the web client
(no duplicated business rules, and the client can never disagree with the server about money).

- [x] `types.ts` — event/team/player/purchase/audit/session/secret models (all with `eventId` scoping)
- [x] `money.ts` — integer-only money/points parsing + formatting, overflow-safe add/subtract
- [x] `text.ts` — name normalisation (uniqueness), URL/request-id validation
- [x] `calculations.ts` — team summary, projections, event totals, **`validateEventConsistency`** (the 12 invariants)
- [x] `purchases.ts` — `planPurchase` / `planReversal` return the *exact* set of writes to apply atomically
- [x] `mutations.ts` — planners for players, teams, event lifecycle, imports (with audit writes)
- [x] `schemas.ts` — Zod schemas for every callable input (server always re-validates)
- [x] `errors.ts` — shared machine-readable error codes + user-facing copy
- [x] Tests: `calculations` / `money` / `purchases` / `mutations` / `lifecycle` suites
      (86 tests, including a full simulated auction: purchase → duplicate rejection → idempotent
      retry → overspend rejection → reversal → double-reversal rejection → re-sale → reconciliation)

## Phase 3 — Privileged backend (Cloud Functions + security rules)

**Status: CODE COMPLETE, TYPECHECKED — emulator verification in Phase 6**

- [x] `firestore.rules` — default deny; admin only via verified custom claims; team reads limited to
      their own team document and their own purchases, re-validated against the server-issued session
      document on every read (revocation/expiry is immediate); `teamSecrets`, `sessions`, `pinIndex`,
      `rateLimits` are never readable by any client; all client writes denied.
- [x] `lib/pin.ts` — HMAC-SHA256 PIN verifier + lookup index, crypto-random PIN generation,
      constant-time comparison, emulator-only dev secret fallback (production fails loudly)
- [x] `lib/rateLimit.ts` — per-IP, per-PIN-value and global fixed-window limits with escalating cooldowns
- [x] `lib/store.ts` — transactional reads, write application (`FieldValue.serverTimestamp()`),
      session revocation helper
- [x] `lib/callables.ts` — centralised admin/team/public callable wrappers (auth + validation + CORS + App Check flag)
- [x] Callables: `verifyTeamPin`, `logoutTeamSession`, `createTeam`, `updateTeam`, `resetTeamPin`,
      `revokeSessions`, `getTeamPinStatus`, `createPlayer`, `updatePlayer`, `setPlayerStatus`,
      `importPlayers`, `recordPurchase`, `reversePurchase`, `createEvent`, `updateEvent`,
      `checkEventConsistency`, `setDefaultEvent`
- [x] `recordPurchase` idempotency: purchase document id **is** the client `requestId`, so retries and
      double submits charge once; concurrent sales of one player are impossible inside the transaction

## Phase 4 — Admin UI

**Status: COMPLETE (typecheck, lint, unit tests and production build verified; emulator end-to-end in Phase 6)**

- [x] Admin login (interim shared ID/password verified server-side by `adminLogin`; show/hide, validation, generic errors, rate-limit copy)
- [x] App shell: header, event/status indicator, connection state, navigation, error boundary
- [x] Dashboard: live summary cards (teams/players/available/sold/spend), recent purchases, actionable warnings
- [x] Teams: list + search, add team (PIN revealed once), team detail, edit/deactivate, reset PIN, revoke sessions
- [x] Players: list + filters/sorting, add/edit, withdraw/reactivate, correct sold player data with reason
- [x] CSV import (preview, per-row errors, duplicate policy) + CSV template download + export
- [x] Record purchase (highest priority): searchable player/team pickers, live validation summary,
      explicit confirm, idempotent submit, success panel, recent purchases, "checking status" reconciliation
- [x] Transactions: filters, details, reversal with consequence preview + reason, CSV export
- [x] Settings: event name/currency/roster limit, lifecycle (start/finalize/reopen), consistency check, readiness

## Phase 5 — Team panel

**Status: COMPLETE (typecheck, lint, unit tests and production build verified; emulator end-to-end in Phase 6)**

- [x] PIN login (4 digits, numeric keypad, cooldown messaging, session expiry handling)
- [x] Private panel: purse card, spent/points/players metrics, roster (name, points, paid price,
      photo placeholder), newest-first, empty state
- [x] Realtime via Firestore listeners (team doc + own purchases query), "Updating…" state,
      permission error → logout, listener cleanup
- [x] Logout (server revocation) and session expiry → login

## Phase 6 — Verification with the Firebase Emulator Suite

**Status: SKIPPED (user decision, 2026-10-17)**

Reason: firebase-tools 15 requires Java 21+; this machine only has Java 8/17 and the user chose not to
install a newer runtime or use a portable JRE. The harness (`vitest.emulator.config.ts`,
`npm run test:emulator`) is ready, but **no emulator suites exist and no rules/function integration
test has been executed**. This is a known limitation — see README → Emulator setup.

Remaining to satisfy the spec on a Java 21 machine: write `tests/emulator/**` (rules isolation +
callable integration: happy purchase, overspend, duplicate, concurrency, idempotent retry, reversal,
PIN lockout/session binding) and run `npm run test:emulator`.

## Phase 7 — Documentation, seed/demo tooling and final acceptance

**Status: COMPLETE (verified except where noted)**

- [x] `README.md` (setup, Firebase, emulators incl. the Java 21 requirement, deploy, admin login,
      import format, troubleshooting, honest limitations)
- [x] `docs/DATA_MODEL.md`, `docs/SECURITY.md`, `docs/EVENT_DAY_RUNBOOK.md`
- [x] `scripts/seed-demo.mjs` (opt-in demo data via the real callables, `demo`/`demo-*` event guard
      verified, labelled teams/players, PINs printed once; signs in through `adminLogin`)
- [x] ~~`scripts/bootstrap-admin.mjs`~~ removed 2026-10-17 with the interim shared admin login — no
      Firebase user accounts are needed any more
- [x] `functions/.env.example` (functions env names + pointer to `PIN_HMAC_SECRET` secret)
- [ ] Manual acceptance run against live Firebase/emulator (impossible here: no Firebase project,
      and the emulator needs Java 21 which the user chose not to install) — procedure is documented
      in `docs/EVENT_DAY_RUNBOOK.md`
- [x] `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` all green (re-run below)

---

## Interim change — shared-credential admin login (2026-10-17, user decision)

Admin email/password sign-in was replaced by a single shared **admin ID + password** (default
`admin`/`admin`; override via `ADMIN_LOGIN_ID` / `ADMIN_LOGIN_PASSWORD` in `functions/.env`).

- New `adminLogin` callable: server-side constant-time comparison (`safeEqual`, digest-based),
  per-IP + global rate limits, mints the admin custom token (`role: superAdmin`, uid `organizer`).
  Rules and every other callable are unchanged — the browser still never decides who is an admin
  (a purely client-side check would leave the whole backend locked out).
- Client: new `src/services/adminAuth.ts`; rewritten `AdminAuthProvider` + `AdminLoginPage`; the
  console shows a warning banner while the default credentials are still in use.
- `scripts/seed-demo.mjs` now signs in through `adminLogin`; `scripts/bootstrap-admin.mjs` deleted.
- New `tests/unit/adminLogin.test.tsx` (5 tests). The new tests exposed a real bug:
  `toFriendlyError` did not recognise `CallError`-shaped errors and showed "Something went wrong."
  — fixed to keep code, message and `retryAfterSeconds`. `SetupScreen`'s test was made independent
  of the local `.env.local` (mocks `@/lib/config`).
- Accepted weaknesses documented in `docs/SECURITY.md`: shared identity, plain env password, no MFA.

---

## Phase 9 — Web client port to Supabase (2026-10-17)

The browser app was ported from the Firebase SDK to Supabase. All UI, business rules and tests were
kept; only the transport and session plumbing changed.

- **Transport (`src/services/callables.ts`):** same `callFunction(name, input)` API, now posts
  `{action, input, token}` to the `auction-api` edge function and unwraps the
  `{ok,data|error}` envelope. Token routing is by action class (`verifyTeamPin`/`adminLogin` need
  none; `getTeamContext`/`logoutTeamSession` use the team token; everything else the admin token).
- **Sessions (`src/services/session.ts`, new):** opaque tokens stored in `localStorage`
  (admin + team), expiry-aware, plus a session-invalid bus so any rejected call (expired/revoked/
  deactivated) signs the affected surface out immediately.
- **Admin login:** `src/services/adminAuth.ts` now calls `adminLogin` and stores the returned
  session; the browser still never checks credentials. The server login response was extended with
  `role` (always `superAdmin` for the interim shared identity).
- **Reads (`src/services/reads.ts`, `src/data/hooks.ts`):** the Firestore `onSnapshot` hooks were
  replaced by polled reads through `api_admin_read` / `api_team_read` / `api_public_config`
  (~4 s, visibility-aware, de-duplicated in-flight). The `{data,loading,error,fromCache}` contract
  is unchanged; `fromCache` now means "last refresh failed, showing the most recent data".
  `fetchPurchaseFromServer` reconciles through the purchases read.
- **Config:** `src/lib/firebase.ts` → `src/lib/supabase.ts`; `src/lib/config.ts` now reads
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (publishable key accepted too);
  `SetupScreen` lists the Supabase keys and setup steps; `main.tsx` gates on Supabase config.
  `src/data/converters.ts` (Firestore converters) deleted; hooks use the shared `@shared/convert`
  mappers directly.
- **Migration fix-up:** during the port it was verified that `api_admin_read`/`api_team_read`
  returned raw `data` without the row `id`, which the shared mappers need. Follow-up migration
  `supabase/migrations/20261017000002_read_payload_ids.sql` merges `id` into every read payload.
- **Tests:** `adminLogin.test.tsx` and `teamLogin.test.tsx` rewritten against the session design
  (no Firebase mocks; new reload-restore test for teams); `ui.test.tsx` SetupScreen copy updated.
  New totals: **117 passed / 10 files**.
- **Seed script:** `scripts/seed-demo.mjs` rewritten to drive the edge function via `fetch` and to
  read existing demo entities through `api_admin_read`; emulator mode removed (no local emulators).
- **Dependency:** `firebase` removed from `package.json`; the production bundle dropped from
  ~978 kB to ~633 kB (pre-minified).
- **Docs:** README, `docs/SECURITY.md`, `docs/DATA_MODEL.md` and `docs/EVENT_DAY_RUNBOOK.md`
  rewritten for the Supabase design.

---

## Verification log

| Date | Check | Command | Result |
| --- | --- | --- | --- |
| 2026-10-17 | Root install | `npm install` | 925 packages, ok |
| 2026-10-17 | Functions install | `npm --prefix functions install` | 247 packages, ok |
| 2026-10-17 | Functions typecheck | `npm --prefix functions run typecheck` | pass (after fixing plan/unwrap types) |
| 2026-10-17 | Domain unit tests | `npx vitest run` | **86 passed / 5 files** |
| 2026-10-17 | Domain bug found by tests | sold-player status handling | fixed in `planUpdatePlayer` (kept `sold`) |
| 2026-10-17 | Client + functions typecheck | `npx tsc --noEmit -p tsconfig.json`, `npm --prefix functions run typecheck` | pass |
| 2026-10-17 | Lint | `npx eslint .` | clean (0 errors, 0 warnings) |
| 2026-10-17 | Production build | `npm run build` | succeeds (only known 978 kB chunk warning) |
| 2026-10-17 | Full unit suite | `npx vitest run` | **111 passed / 9 files** (domain, csv, import, UI, team login) |
| 2026-10-17 | Bugs found by unit tests | jsdom `scrollIntoView`, negative-number import message, combobox keyboard test | fixed (guard in `Combobox.tsx`, sign-aware `toIntegerField`, corrected test expectations) |
| 2026-10-17 | Emulator suite attempt | `npx firebase emulators:exec …` | blocked: firebase-tools 15 requires Java 21+, machine has 17; **user chose to skip** — Phase 6 marked SKIPPED, documented in README |
| 2026-10-17 | Bootstrap script error paths | `node scripts/bootstrap-admin.mjs` (no args / bad project / `--emulator` / `--help`) | usage + exit 1; clear ADC guidance on credential failure; emulator path correctly targets :9099; help exit 0 |
| 2026-10-17 | Seed script guards | `node scripts/seed-demo.mjs …` (no config / non-demo event id) | refuses `--event production`; clear “no web config” message; exit 1 for both |
| 2026-10-17 | Lint / typecheck / build (final) | `npx eslint .`, `npx tsc --noEmit -p tsconfig.json`, `npm --prefix functions run typecheck`, `npm run build` | all pass |
| 2026-10-17 | Dev server smoke test | `npm run dev` + HTTP fetch of `/` and `/src/main.tsx` | HTTP 200, root div + entry module served and transformed by Vite |
| 2026-10-17 | Firebase creds wired | `.env.local` + `.firebaserc` → `attendance-tracker-d08ed`; `npm run build` | build ok, project id found in bundle (env consumed by Vite) |
| 2026-10-17 | Live project probe | Identity Toolkit sign-in attempt (fake email); Firestore REST; hosting URLs | API key valid; Auth `CONFIGURATION_NOT_FOUND` (not initialized); Firestore 404 (no database); hosting sites 404 — project is fresh, nothing deployed |
| 2026-10-17 | Interim admin login — tests | `npx vitest run` | **116 passed / 10 files**; new `adminLogin.test.tsx` (5) covers empty-field validation, generic error + password clear, rate-limit copy, success + default-credential flag, changed-credentials flag |
| 2026-10-17 | Bug found by the new tests | `npx vitest run` (before fix) | `errorMessage(CallError)` returned “Something went wrong.” — `toFriendlyError` now honours app codes and `retryAfterSeconds` carried on the error itself |
| 2026-10-17 | Gates after interim change | `npx tsc --noEmit -p tsconfig.json`, `npm --prefix functions run typecheck`, `npx eslint .`, `npm run build` | all pass |
| 2026-10-17 | Seed script reworked for shared login | `node scripts/seed-demo.mjs --event production` / `--purchases 99` / `--help` / default run vs unconfigured project | guard + range + help paths unchanged (exit 1/1/0); sign-in path reached the live project and failed cleanly (`[not-found] [404]` — functions not deployed) with guidance and exit 1 |
| 2026-10-17 | Phase 8 backend gates | `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.edge.json`, `npx vitest run`, `npx eslint .`, `npm run build` | all pass (**116 tests**); commit `6fd8b38` |
| 2026-10-17 | SQL migration applied (user) | Supabase SQL Editor → `20261017000001_init.sql` | “Success. No rows returned” (reported by the organizer) |
| 2026-10-17 | Read payload gap found in Phase 9 review | source inspection of `api_admin_read` + `_shared/convert.ts` | rows returned without `id`; fixed by `20261017000002_read_payload_ids.sql` (**user must run it once**) |
| 2026-10-17 | Phase 9 gates | `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.edge.json`, `npx vitest run`, `npx eslint .`, `npm run build` | all pass — **117 tests / 10 files**; bundle 632.69 kB (pre 970 kB) |
| 2026-10-17 | Firestore still imported anywhere? | repo-wide grep for `firebase` in `src/`, `tests/`, `scripts/` | none (only historical notes in docs); `npm ls firebase` → not installed |
| 2026-10-17 | Not yet executed | live edge-function deploy + test purchase | resolved in two steps below: function deployed + auth-level smoke tests passed; the in-app test purchase is the last remaining step |
| 2026-10-17 | Edge function deploy (user attempt) | `npx supabase functions deploy auction-api` | failed HTTP 400: only `index.ts` was uploaded; remote bundler could not resolve `./lib/config` — Supabase's Deno bundler requires explicit `.ts` extensions on relative imports (extensionless imports came from the Firebase/esbuild era) |
| 2026-10-17 | Deploy fix | scripted rewrite of 29 edge/shared files to `.ts`-suffixed imports; `allowImportingTsExtensions` in tsconfig; moved `deno.json` import map from `supabase/functions/` into `supabase/functions/auction-api/` (docs: per-function config is required for deployment); removed stale `functions/*` lines from `.gitignore` | redeploy uploaded all 29 assets → `{"message":"Deployed Functions."}` |
| 2026-10-17 | Gates after deploy fix | `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.edge.json`, `npx vitest run`, `npm run build` | all pass — 117 tests; bundle unchanged (632.69 kB) |
| 2026-10-17 | Live smoke tests (deployed function) | REST calls to `/functions/v1/auction-api` + `/rest/v1/rpc/*` with the publishable key | `adminLogin` admin/admin → `{ok:true, token, role:'superAdmin', usingDefaultCredentials:true}`; `api_admin_read` events with that session → `[]` (no auth error); `api_public_config` → `{}`; CORS preflight from `http://localhost:5173` → 204 with `access-control-allow-origin: *` |
| 2026-10-17 | Still pending | migration 002 + in-app E2E | organizer runs `20261017000002_read_payload_ids.sql`, then restart dev server, create event/team/player/purchase and test a team PIN |

## Open risks / notes

- **Supabase project wired in** (`.env.local` → `https://zskbpnzhxntnupdnlecp.supabase.co`, 2026-10-17).
  Migration 001 applied by the organizer; migration 002 (read payload ids) still needs to be run.
  The edge function `auction-api` is **deployed and live-verified at the API level** (admin login,
  authenticated + public reads, CORS). Secrets are not set yet, so login is currently admin/admin.
  The last remaining step is the in-app end-to-end run after migration 002.
- All writes go through the atomic `apply_plan` pipeline (reads first, then writes with
  preconditions); a conflict retries with fresh state. Same contract Firestore transactions gave.
- `finalizeEvent` reads the whole event inside one plan (fine at this event scale: hundreds of rows).
- CSV import is capped at 400 rows per batch so a single apply-plan stays small.
- PIN rate-limit policy mirrors the old Firebase one but the old `ENFORCE_APP_CHECK`/reCAPTCHA path
  is gone (Supabase's equivalent is not required for this threat model — see `docs/SECURITY.md`).
- No Supabase Auth accounts are needed: admin access is a session minted by the `adminLogin`
  action, so `scripts/seed-demo.mjs` works against a fresh project with no bootstrap step.
- Web bundle is one ~633 kB chunk — acceptable at this scale; code splitting remains optional.
- `.gitignore`: `.env.local` is ignored; no service-role key or database password ever enters the
  repo or the frontend.
