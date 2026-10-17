# Security model

How identities, authorization, PINs and secrets work in this app, and which threats the design
does — and does not — defend against. For the data layout see `docs/DATA_MODEL.md`; for the actual
rule source see `firestore.rules`.

## Identities and roles

| Role | How you get it | What you can do |
| --- | --- | --- |
| Anonymous | no sign-in | call `verifyTeamPin` and public callables only; read `config/app` |
| **Team session** | correct 4-digit PIN via `verifyTeamPin` | read **only** its own team document and its own purchase records inside the default event |
| **admin** | interim shared ID/password verified server-side by the `adminLogin` callable, which mints a `role: superAdmin` custom claim | everything in the admin console: manage teams/players, record/reverse purchases, read audit logs, reopen a finalized event |

There is no registration, no self-service role and no way to escalate from the app. Because the
interim login replaces per-user accounts, it mints `superAdmin` so event reopening stays available
to the one shared identity; the `admin`/`superAdmin` split remains in the code for when per-user
auth returns.

## Admin authentication (interim shared credentials)

Deliberate temporary simplification (user decision, 2026-10-17): per-user email sign-in was
replaced with a single shared admin ID + password. The defaults are `admin`/`admin`; override with
`ADMIN_LOGIN_ID` / `ADMIN_LOGIN_PASSWORD` in `functions/.env` and **change the password before any
real event**.

- **The browser never checks credentials.** It sends them to the `adminLogin` callable, which:
  - compares both fields in constant time (`safeEqual`, digest comparison — neither the content nor
    the length leaks, and the error never says which field was wrong);
  - rate limits per client IP (default 10 failures / 10 min → 15 min cooldown, doubling up to 4 h)
    plus a global circuit breaker against distributed guessing;
  - mints a Firebase Auth custom token (`role: superAdmin`, uid `organizer`) — the same mechanism
    the team PIN flow uses.
- **Authorization stays claim-based** (`role: admin | superAdmin`), never client-side checks. The
  Cloud Functions and the Firestore rules both read the claim from the signed token, exactly as
  with the previous email flow — no rule or callable changed.
- The login response reports whether the built-in defaults are still in use; the console shows a
  warning banner until `ADMIN_LOGIN_PASSWORD` is set.
- The admin UI hides what an identity cannot do, but hiding is cosmetic: every callable re-checks
  the claim server-side and every Firestore read is re-checked by the rules.
- **Accepted weaknesses of this mode**: one shared password (trivially guessable if left at the
  default), one audit identity for every operator (`actorEmail` is null; actions are logged under
  uid `organizer`), no MFA, no reset flow (change the env value and redeploy instead). Restoring
  per-user email auth later only touches `src/services/adminAuth.ts` and the auth provider.

## PIN handling (team access)

A four-digit PIN has only 10,000 possibilities. It is therefore treated as a **shared event access
code**, not as strong authentication — the design goal is to make guessing impractical and a
database leak useless, not to withstand a targeted brute force offline.

- **Verification is server-side only.** The PIN never reaches Firestore from a client and is never
  compared in the browser.
- **Nothing reversible is stored.** Two HMAC-SHA256 values (keyed by the `PIN_HMAC_SECRET` secret)
  live in server-only collections:
  `pinVerifier = HMAC(secret, pin-verifier:eventId:teamId:pin)` and
  `pinLookupHash = HMAC(secret, pin-index:eventId:pin)`. The raw PIN is not stored, logged, or
  recoverable — only returned once to the signed-in admin at create/reset time.
- **Constant-time comparison** (`timingSafeEqual`) for the verifier.
- **Rate limiting, three layers** (fixed window + escalating cooldowns, counters in a server-only
  `rateLimits` collection):
  - per client IP: default 10 failures / 10 min → 15 min cooldown, doubling up to 4 h;
  - per **PIN value** (across teams): 5 failures / 60 min → 30 min cooldown, doubling up to 12 h —
    this kills “try 0000 everywhere” scanning;
  - global circuit breaker: 400 failures / window → short global cooldown.
  All limits are configurable via `functions/.env`; failures are registered together and the
  response carries `retryAfterSeconds` so the UI can show a real countdown.
- **Enumeration resistance.** A wrong PIN and an unknown PIN end in the same generic failure path
  (the rate-limit bookkeeping runs in both cases). An inactive team reports its own explicit state
  only *after* a correct PIN, which the guesser does not have.
- **PINs are generated, not chosen** (server-side, crypto random, 1000–9999) so operators cannot
  pick 1111 by accident.
- **Reset is a hard reset**: new PIN + `pinVersion` bump + all existing sessions for that team
  revoked. Deactivating a team blocks PIN login entirely (`team-inactive`).

## Team sessions

`verifyTeamPin` mints a Firebase Auth **custom token** whose claims are exactly:

```json
{ "kind": "team", "eventId": "…", "teamId": "…", "sessionId": "…" }
```

- The client cannot alter claims; they are signed by the server.
- The backing `events/{eventId}/sessions/{sessionId}` document records `teamId`, `revoked`,
  `expiresAt`. **Firestore rules re-read this document on every attempt to read team data**, so:
  - organizer revokes sessions (team editor button) → team reads fail immediately;
  - PIN reset → sessions revoked → same;
  - TTL passes (default 12 h, `TEAM_SESSION_TTL_HOURS`) → reads fail, the panel returns to login.
- A team token is useless outside its own event/team: rules compare both the claim and the
  document’s `teamId` field, and purchases are filtered by `resource.data.teamId == claim('teamId')`.
- Signing out calls `logoutTeamSession`, which marks the session revoked server-side — it is not
  merely a client-side token discard.

## Firestore rules summary

Default: **deny everything**. Rules never allow a client write anywhere.

| Path | Anonymous | Team session | Admin |
| --- | --- | --- | --- |
| `config/{doc}` | read | read | read |
| `events/{id}` | — | — | read |
| `events/{id}/teams/{teamId}` | — | read **own team only**, session re-validated | read all |
| `events/{id}/players/*` | — | — (the pool is not a team’s business) | read |
| `events/{id}/purchases/{purchaseId}` | — | read only where `teamId` matches the claim, session re-validated | read |
| `events/{id}/auditLogs/*` | — | — | read |
| `events/{id}/teamSecrets/*`, `sessions/*`, `rateLimits/*` | — | — | **—** (never client-readable) |
| `pinIndex/*`, `rateLimits/*` (top-level) | — | — | **—** |
| any write, anywhere | denied | denied | denied |

Admin reads rely on `role: admin|superAdmin`; anonymised Auth users are explicitly rejected even if
they somehow carry claims (`sign_in_provider != anonymous` check in the callable layer).

## Cloud Functions hardening

- Every privileged callable goes through one wrapper (`functions/src/lib/callables.ts`) that
  enforces: authentication → role check → Zod validation of the input → typed error mapping. A new
  endpoint cannot accidentally skip the auth check without failing typecheck.
- Inputs are validated with the **shared** Zod schemas (`functions/src/shared/schemas.ts`) — the
  same schemas the client uses — and the server is the authority; client validation is only UX.
- Typed error codes (`invalid-pin`, `rate-limited`, `team-insufficient-purse`, …) travel in
  `HttpsError.details`; the UI reacts to codes, never to message text. Internal errors are logged
  with context but returned generically.
- **App Check** is supported (`ENFORCE_APP_CHECK=true` + `VITE_APP_CHECK_SITE_KEY`) as an extra
  layer against scripted abuse; it is opt-in because it needs a reCAPTCHA key.
- **CORS allowlist** (`ALLOWED_ORIGINS` in `functions/.env`) can pin callables to your hosting
  origins; empty means “any origin” (development default).
- **Secrets**: `PIN_HMAC_SECRET` is a Functions secret (`firebase functions:secrets:set`). If it is
  missing, deployed functions **refuse to verify PINs**; the built-in development fallback only
  activates inside the emulator and logs a warning.
- Rate-limit keys are hashed before storage (`HMAC(secret, ip)` for PIN flows, SHA-256 for the
  admin login) — raw IPs and raw PINs never touch the database.
- Audit logs intentionally record the acting admin and reasons, but no secrets, no tokens, no raw
  PINs.

## Threat assumptions (what we defend against, and what we accept)

**Defended:**

- A stolen database dump: PINs are irrecoverable (HMAC + server secret), no credentials, no
  service-account material in Firestore.
- Scripted PIN guessing: multi-layer rate limits with real cooldowns, plus generated PINs.
- One team trying to read another team’s data or the player pool: rules + claims + session
  re-validation. Team panels physically cannot query other teams; there is no code path for it.
- A revoked/expired session lingering on a phone: every read re-checks the session document.
- Double-charging / double-selling from flaky phones, retries or two operators: idempotent
  `requestId` + transactional planners. Exactly one write per intent.
- Accidental or malicious client writes: clients have no write permission at all.
- Reacting to a lost device: organizer revokes sessions; nothing secret is on the device.

**Accepted risks / assumptions:**

- **Shared PIN within a team**: teammates who know the PIN see the team panel. The PIN is an access
  code for the event, not per-person identity. Distribution is the organizer’s job (screenshot,
  slip of paper, WhatsApp) — treat it accordingly.
- **Campus threat model**: an attacker with both the PIN *and* network access still only sees that
  one team’s updates; they cannot buy, sell, edit or see other teams.
- **Interim shared admin password**: it lives as a plain env value and everyone who knows it is
  effectively an operator. Change it before real events, keep it out of group chats/screenshots,
  enable App Check, and consider restoring per-user sign-in when the risk profile grows. There is
  no MFA in this mode.
- **Operators see everything**: admins can read all team data by design; the audit log records who
  changed what and why.
- **Service-account / deploy credentials**: whoever holds them is effectively an operator; keep
  them off shared laptops. Nothing in the app requires them at runtime.
- **Project owners**: anyone with Firebase console access can bypass all of this. The rules protect
  the API surface, not the project.
- **Traffic analysis / metadata**: not defended (standard Firebase usage).

## Secret and credential hygiene

- `.env.example` (web) and `functions/.env.example` (functions) contain **variable names only**.
- Never commit: `.env`, `.env.local`, `functions/.env`, service-account JSON files,
  `.firebaserc` with real ids. `.gitignore` already covers them — verify before your first push.
- The only place a raw PIN appears: the one-time response of `createTeam`/`resetTeamPin` to the
  signed-in admin, and the script that prints it. Nothing else logs or returns it.
- Documentation in this repo never contains real PINs, event data or credentials.
