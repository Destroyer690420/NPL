# PROJECT_PLAN — College IPL Auction Manager

Authoritative product spec: [`college_ipl_auction_opencode_prompt.md`](./college_ipl_auction_opencode_prompt.md)

This plan is updated after every phase with what was **actually built and verified**.
Nothing is marked done unless it was executed and observed to work.

---

> **2026-10-17 — Platform change in progress: Firebase → Supabase.**
> The organizer's Firebase project cannot be upgraded to Blaze (no card), which blocks
> deploying Cloud Functions and secrets. By organizer decision, the backend is ported to
> Supabase (free tier, no card). Current state:
> - **Phase 8 (backend) COMPLETE, committed (`6fd8b38`):** Postgres schema, deny-all
>   security rules, an atomic write pipeline with preconditions, and a single Edge
>   Function carrying all 19 actions. The tested domain logic and handlers were reused
>   unchanged behind a Firestore-compatible shim. Verified: web `tsc`, edge `tsc`,
>   116/116 unit tests, ESLint, production build.
> - **Not yet executed against the live project:** applying the SQL migration and
>   deploying the Edge Function (next step), then end-to-end verification.
> - **Phase 9 (web client) NEXT:** the browser app still speaks Firebase until the
>   client port lands (session tokens + polling reads).
> - Firebase-specific docs (setup, rules, runbook) are rewritten when the port completes.

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

## Open risks / notes

- **A live project is now wired in** (`.env.local` + `.firebaserc` → `attendance-tracker-d08ed`,
  2026-10-17) but was probed and found unconfigured: Auth not initialized
  (`CONFIGURATION_NOT_FOUND`), no Firestore database (404), no hosting site. Initializing Auth
  (Get started — no provider needed), creating Firestore, deploying rules/functions/hosting, and
  setting `PIN_HMAC_SECRET` + a non-default `ADMIN_LOGIN_PASSWORD` remain user steps; after that, do
  the Event-day runbook's one-minute test purchase. No end-to-end run has happened yet.
- Firestore transaction read-then-write ordering is respected everywhere (all reads precede all writes).
- `finalizeEvent` reads the whole event inside the transaction (fine at this event scale: hundreds of docs).
- CSV import is capped at 400 rows per batch so a single transaction stays atomic (Firestore 500-write limit).
- App Check is opt-in (`ENFORCE_APP_CHECK=true` + `VITE_APP_CHECK_SITE_KEY`) because it requires a reCAPTCHA key.
- No Firebase user accounts are needed any more: admin access is minted by the `adminLogin`
  callable, so `scripts/seed-demo.mjs` works against a fresh project with no bootstrap step.
- Web bundle is one ~978 kB chunk (Firebase SDK dominates) — acceptable at this scale; code
  splitting remains an optional polish item.
- `.gitignore`: verify `functions/.env` and service-account files are never committed (patterns exist;
  no git repo was initialised in this workspace).
