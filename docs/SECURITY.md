# Security model

How identities, authorization, PINs and secrets work in this app, and which threats the design
does — and does not — defend against. For the data layout see `docs/DATA_MODEL.md`; for the actual
enforcement see `supabase/migrations/*.sql` and `supabase/functions/auction-api/`.

## Identities and roles

| Role | How you get it | What you can do |
| --- | --- | --- |
| Anonymous | no token | execute `api_public_config` only (event name/currency before login) |
| **Team session** | correct 4-digit PIN via the `verifyTeamPin` action | read **only** its own team document and its own purchase records inside its event |
| **Admin** | interim shared ID/password verified server-side by the `adminLogin` action | everything in the admin console: manage teams/players, record/reverse purchases, read audit logs, reopen a finalized event |

There is no registration, no self-service role and no way to escalate from the app. The interim
login mints `role: superAdmin` so event reopening stays available to the one shared identity; the
`admin`/`superAdmin` split remains in the code for when per-user auth returns.

## Why the database itself is the boundary

- Every table is `(id, event_id, data jsonb)` with **RLS enabled and all privileges revoked** from
  the `anon` and `authenticated` roles. A client holding the publishable key cannot read or write
  a single row directly — the REST endpoints return permission errors.
- The only client-executable database functions are `api_public_config`, `api_admin_read` and
  `api_team_read`. They are `security definer` but **re-validate the caller's session token on
  every call** (`require_session`), and a team read derives `{eventId, teamId}` from the session
  row — never from the request — so a team physically cannot ask for another team's data.
- All writes happen inside one edge function running with the `service_role` key (a Supabase
  platform secret, never shipped to browsers), through the single atomic `apply_plan` function.
- `service_role` and the database password are **never** needed by, or exposed to, the frontend.

## Admin authentication (interim shared credentials)

Deliberate temporary simplification (organizer decision, 2026-10-17): per-user email sign-in was
replaced with a single shared admin ID + password. The defaults are `admin`/`admin`; override with
the `ADMIN_LOGIN_ID` / `ADMIN_LOGIN_PASSWORD` secrets of the `auction-api` edge function and
**change the password before any real event**.

- **The browser never checks credentials.** It sends them to the `adminLogin` action, which:
  - compares both fields in constant time (`safeEqual`, digest comparison — neither the content nor
    the length leaks, and the error never says which field was wrong);
  - rate limits per client IP (default 10 failures / 10 min → 15 min cooldown, doubling up to 4 h)
    plus a global circuit breaker against distributed guessing;
  - creates a `sessions` row `{kind: 'admin', uid: 'organizer', role: 'superAdmin'}` and returns an
    opaque 256-bit token; only `sha256(token)` is stored.
- **Authorization is always server-side.** `require_session(token, 'admin')` runs inside the edge
  action wrapper *and* inside `api_admin_read`; the UI hiding things is cosmetic only.
- The login response reports whether the built-in defaults are still in use; the console shows a
  warning banner until `ADMIN_LOGIN_PASSWORD` is changed.
- **Accepted weaknesses of this mode**: one shared password (trivially guessable if left at the
  default), one audit identity for every operator (`actorEmail` is null; actions are logged under
  uid `organizer`), no MFA, no reset flow (change the secret instead). Restoring per-user auth
  later only touches `src/services/adminAuth.ts`, the auth provider and the session table.

## PIN handling (team access)

A four-digit PIN has only 10,000 possibilities. It is therefore treated as a **shared event access
code**, not as strong authentication — the design goal is to make guessing impractical and a
database leak useless, not to withstand a targeted brute force offline.

- **Verification is server-side only.** The PIN never leaves the edge function, and is never
  compared in the browser.
- **Nothing reversible is stored.** Two HMAC-SHA256 values (keyed by `PIN_HMAC_SECRET`, or the
  auto-generated database secret) live in the server-only `team_secrets` and `pin_index` tables:
  `pinVerifier = HMAC(secret, pin-verifier:eventId:teamId:pin)` and
  `pinLookupHash = HMAC(secret, pin-index:eventId:pin)`. The raw PIN is not stored, logged, or
  recoverable — only returned once to the signed-in admin at create/reset time.
- **Constant-time comparison** (`timingSafeEqual`) for the verifier.
- **Rate limiting, three layers** (fixed window + escalating cooldowns, counters in the server-only
  `rate_limits` table):
  - per client IP: default 10 failures / 10 min → 15 min cooldown, doubling up to 4 h;
  - per **PIN value** (across teams): 5 failures / 60 min → 30 min cooldown, doubling up to 12 h —
    this kills “try 0000 everywhere” scanning;
  - global circuit breaker: 400 failures / window → short global cooldown.
  All limits are configurable in `supabase/functions/auction-api/lib/config.ts`; failures are
  registered together and the response carries `retryAfterSeconds` so the UI can show a real
  countdown.
- **Enumeration resistance.** A wrong PIN and an unknown PIN end in the same generic failure path
  (the rate-limit bookkeeping runs in both cases). An inactive team reports its own explicit state
  only *after* a correct PIN, which the guesser does not have.
- **PINs are generated, not chosen** (server-side, crypto random, 1000–9999) so operators cannot
  pick 1111 by accident.
- **Reset is a hard reset**: new PIN + `pinVersion` bump + all existing sessions for that team
  revoked. Deactivating a team blocks PIN login entirely (`team-inactive`).

## Team sessions

`verifyTeamPin` creates a `sessions` row and returns an **opaque 256-bit token**:

- only `sha256(token)` is stored (`tokenHash`); the database never holds the raw token;
- the session records `{kind: 'team', eventId, teamId, revoked, expiresAt}` — the client cannot
  alter any of it (there is nothing signed to tamper with; the token is a random opaque string);
- **every** team call and team read runs `require_session(token, 'team')`, which re-reads this row,
  so:
  - organizer revokes sessions (team editor button) → access stops immediately;
  - PIN reset → sessions revoked → same;
  - deactivating a team → reads fail with `team-inactive`;
  - TTL passes (default 12 h, `TEAM_SESSION_TTL_HOURS`) → reads fail, the panel returns to login.
- `api_team_read` ignores any team/event identifiers from the caller and uses the session row's
  `{eventId, teamId}` — a team token is useless outside its own team.
- Signing out calls `logoutTeamSession`, which marks the session revoked server-side — it is not
  merely a client-side token discard.

## Edge function hardening (`auction-api`)

- One dispatcher for all 19 actions; every privileged action goes through one wrapper
  (`lib/callables.ts`) that enforces: session resolution → role check → Zod validation of the
  input → typed error mapping. A new action cannot accidentally skip the auth check without
  failing typecheck.
- Inputs are validated with the **shared** Zod schemas (`supabase/functions/_shared/schemas.ts`) —
  the same schemas the client uses — and the server is the authority; client validation is UX only.
- Typed error codes (`invalid-pin`, `rate-limited`, `team-insufficient-purse`, …) travel in the
  response envelope; the UI reacts to codes, never to message text. Internal errors are logged with
  context but returned generically.
- The wire response is always HTTP 200 with `{ok:true,data}` or `{ok:false,error:{code,message}}`;
  CORS is handled in-function for the browser origins.
- Rate-limit keys are hashed before storage (`HMAC(secret, …)` for PIN flows, SHA-256 for the admin
  login) — raw IPs and raw PINs never touch the database.
- Secrets (`ADMIN_LOGIN_PASSWORD`, `PIN_HMAC_SECRET`) live in Supabase's encrypted secret store;
  the service-role key is injected by the platform and is never logged.
- Audit logs intentionally record the acting admin and reasons, but no secrets, no tokens, no raw
  PINs.

## Threat assumptions (what we defend against, and what we accept)

**Defended:**

- A stolen database dump: PINs are irrecoverable (HMAC + server secret), session tokens are only
  stored hashed, and no credentials or service-account material are in the tables.
- Scripted PIN guessing: multi-layer rate limits with real cooldowns, plus generated PINs.
- One team trying to read another team's data or the player pool: table privileges are revoked,
  platform JWT roles cannot read the tables, and the read RPCs derive the team scope from the
  session row. Team panels physically cannot query other teams; there is no code path for it.
- A revoked/expired session lingering on a phone: every read and action re-checks the session row.
- Double-charging / double-selling from flaky phones, retries or two operators: idempotent
  `requestId` + atomic apply-plan writes. Exactly one write per intent.
- Accidental or malicious client writes: clients have no database write permission at all.
- Reacting to a lost device: organizer revokes sessions; nothing secret is on the device (the
  stored token is useless once revoked).
- Abuse of the public function endpoint: every action validates its input, the credential checks
  are rate limited, and no action leaks raw error internals.

**Accepted risks / assumptions:**

- **Shared PIN within a team**: teammates who know the PIN see the team panel. The PIN is an access
  code for the event, not per-person identity. Distribution is the organizer’s job (screenshot,
  slip of paper, WhatsApp) — treat it accordingly.
- **Campus threat model**: an attacker with both the PIN *and* network access still only sees that
  one team's updates; they cannot buy, sell, edit or see other teams.
- **Interim shared admin password**: it lives as one Supabase secret and everyone who knows it is
  effectively an operator. Change it before real events, keep it out of group chats/screenshots.
  There is no MFA in this mode.
- **Operators see everything**: admins can read all team data by design; the audit log records who
  changed what and why.
- **Supabase project owners / dashboard access**: anyone with dashboard access can bypass all of
  this. The migrations protect the API surface, not the project. Keep the account (and the
  database password) private.
- **Traffic analysis / metadata**: not defended (standard hosted-API usage).
- **Supply chain**: the app trusts the `@supabase/supabase-js` client and the Supabase platform;
  pin dependency versions as usual.

## Secret and credential hygiene

- `.env.local` (web) contains **public identifiers only** (project URL + publishable key). It never
  contains the service-role key, the database password, or the admin password.
- Server secrets belong to the Supabase project: `ADMIN_LOGIN_ID`, `ADMIN_LOGIN_PASSWORD`,
  optional `PIN_HMAC_SECRET`. Rotate them in the dashboard; no redeploy is needed.
- Never commit `.env.local` or any service-role/database-password file. `.gitignore` already covers
  them — verify before your first push.
- The only place a raw PIN appears: the one-time response of `createTeam`/`resetTeamPin` to the
  signed-in admin, and the script that prints it. Nothing else logs or returns it.
- Documentation in this repo never contains real PINs, event data or credentials.
