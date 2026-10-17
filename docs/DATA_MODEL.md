# Data model

Postgres table layout, document shapes and the invariants the consistency check enforces. Types
live in `supabase/functions/_shared/types.ts` (imported by both the web app and the edge function);
the SQL that protects each table lives in `supabase/migrations/` (see `docs/SECURITY.md`).

## Layout

Every table is a **document store**: `(id text primary key, event_id text null, data jsonb)`, where
`data` is exactly the document body the old Firestore model used. `id` and `event_id` are separate
columns so queries and preconditions can address rows directly; everything else lives in `data`.

```
app_config        id 'app'                   public display config (event name, currency, default event id)
events            id = eventId
teams             keyed by teamId,     event_id = eventId
players           keyed by playerId,   event_id = eventId
purchases         id = client requestId (idempotency!), event_id = eventId
audit_logs        random id,           event_id = eventId
team_secrets      keyed by teamId      server-only PIN verifier        (no client access)
pin_index         keyed by lookupHash  server-only PIN lookup index    (no client access)
sessions          random id            server-only admin/team sessions (no client access)
rate_limits       hashed keys          server-only rate limit counters (no client access)
```

Everything is scoped under one `event_id` — one project can host multiple events, and the app works
against the *default* event (`VITE_DEFAULT_EVENT_ID` override → `app_config.defaultEventId` →
`default`).

## Access model (who can read/write what)

- Tables: **nobody** except the `service_role` key used by the edge function — RLS is enabled and
  privileges are revoked from `anon`/`authenticated` (`docs/SECURITY.md`).
- Reads for the browser go through three `security definer` functions:
  - `api_public_config()` → `app_config.app` (no token);
  - `api_admin_read(token, resource, params)` → `event|events|teams|players|purchases|audit|pins`
    (admin session required). Each row is returned as `data || {id}` so the client can rebuild
    typed documents;
  - `api_team_read(token, resource)` → `state` (event + own team + own purchases) or `context`
    (event + own team) — team scope always comes from the session row.
- Writes are applied **only** by `apply_plan(p_ops)` inside the edge function, atomically, with
  preconditions recorded during the planner's reads.

## Documents

### `app_config` / `app`

Public, non-sensitive display configuration. Read by everyone (team login screen needs the event
name and currency), written by the edge function only.

| Field | Type | Notes |
| --- | --- | --- |
| `defaultEventId` | `string \| null` | the event the app opens by default |
| `eventName` | `string` | display name of the default event |
| `currencyLabel` | `string` | e.g. `₹`, `credits` |
| `eventStatus` | `'setup' \| 'active' \| 'finalized' \| null` | drives badges before login |
| `updatedAt` | timestamp | |

### `events` / `{eventId}`

| Field | Type | Notes |
| --- | --- | --- |
| `name`, `currencyLabel` | string | display |
| `status` | `'setup' \| 'active' \| 'finalized'` | `setup` blocks purchases, `finalized` is read-only |
| `maxRosterSize` | `number \| null` | `null` = unlimited (≤ 200) |
| `defaultStartingPurse` | number | pre-fills new-team forms; each team stores its own |
| `purchasesEnabled` | boolean | operator switch; `false` blocks purchases even when active |
| `createdBy`, `createdAt`, `updatedAt` | | `createdBy` is the session uid (`organizer`) |

### `teams` / `{teamId}` (`event_id` = eventId)

| Field | Type | Notes |
| --- | --- | --- |
| `name`, `normalizedName` | string | uniqueness is enforced on the normalised name |
| `logoUrl` | `string \| null` | |
| `startingPurse` | number | |
| `remainingPurse` | number | derived: `startingPurse − totalSpent` |
| `totalSpent` | number | derived: Σ confirmed `finalPrice` |
| `totalPoints` | number | derived: Σ confirmed player points snapshots |
| `playerCount` | number | derived: count of confirmed purchases |
| `active` | boolean | inactive teams cannot buy and cannot sign in |
| timestamps | | |

### `players` / `{playerId}` (`event_id` = eventId)

| Field | Type | Notes |
| --- | --- | --- |
| `name`, `normalizedName` | string | unique per event |
| `points` | number | award value, ≤ 1,000,000 |
| `basePrice` | number | starting price for the purchase form |
| `status` | `'available' \| 'sold' \| 'withdrawn'` | |
| `soldToTeamId`, `purchaseId` | `string \| null` | only while `sold` |
| `photoUrl`, `externalReference`, `notes` | `string \| null` | `externalReference` is the CSV `player_id` |
| timestamps | | |

### `purchases` / `{purchaseId}` (`event_id` = eventId)

`purchaseId` **is** the client-generated `requestId` (pattern `^[A-Za-z0-9_-]{8,72}$`) — the row id
*and* the idempotency key: a retried submit reads the existing row inside the plan and returns the
original result instead of writing again.

| Field | Type | Notes |
| --- | --- | --- |
| `playerId`, `teamId` | string | current references |
| `playerNameSnapshot`, `playerPointsSnapshot`, `playerPhotoUrlSnapshot` | | frozen at sale time — later player edits never rewrite history |
| `teamNameSnapshot` | string | same idea for teams |
| `finalPrice` | number | > 0, whole |
| `status` | `'confirmed' \| 'reversed'` | reversed purchases stay forever |
| `createdBy`, `requestId`, `createdAt` | | |
| `reversedAt`, `reversedBy`, `reversalReason` | | set on reversal (`reason` ≥ 3 chars) |

### `audit_logs` / `{logId}` (`event_id` = eventId)

| Field | Type | Notes |
| --- | --- | --- |
| `actorUid`, `actorRole`, `actorEmail` | | who acted; `actorEmail` is null while the interim shared admin login is in use (uid `organizer`) |
| `action` | enum | `event.*`, `team.*`, `player.*`, `purchase.recorded`, `purchase.reversed`, `session.*`, … |
| `targetType`, `targetId` | | what was acted on |
| `reason` | `string \| null` | required for corrections/reversals |
| `metadata` | flat map of primitives | non-secret details (deltas, names) |
| `createdAt` | timestamp | |

### Server-only tables

No client role can read these at all — they contain verifier material or session state:

- `team_secrets/{teamId}` — `pinVerifier` (HMAC of `eventId:teamId:pin`), `pinLookupHash`
  (HMAC of `eventId:pin`), `pinVersion`, `pinSetAt`, `pinSetBy`. Also `server_secrets` holds the
  auto-generated PIN secret when `PIN_HMAC_SECRET` is not set.
- `sessions/{sessionId}` — `{kind: 'admin'|'team', tokenHash, revoked, expiresAt, …}` (plus
  `eventId`/`teamId` for team sessions). Every call and read re-reads this row; flipping `revoked`
  to `true` (or letting `expiresAt` pass) cuts access immediately.
- `pin_index/{lookupHash}` — maps a PIN to `{eventId, teamId}` for O(1) login without storing the
  PIN.
- `rate_limits/{hashedKey}` — fixed-window counters for PIN and admin-login attempts.

## Invariants (enforced by `checkEventConsistency`)

Run automatically before finalization and on demand via **Settings → Run consistency check**
(`checkEventConsistency` action). A failing check blocks finalization.

1. Every purchase references an existing player and an existing team.
2. A reversed purchase has both a reversal timestamp and a reason.
3. No player has more than one confirmed purchase.
4. A `sold` player has exactly one confirmed purchase, and its `soldToTeamId`/`purchaseId` point at
   that purchase.
5. A player with a confirmed purchase must be `sold` (available/withdrawn players cannot keep one).
6. A player with no confirmed purchase must have `soldToTeamId = null` and `purchaseId = null`.
7. Team totals are exactly derivable from confirmed purchases:
   `totalSpent`, `remainingPurse`, `totalPoints`, `playerCount`.
8. `remainingPurse` is never negative.
9. `playerCount` never exceeds `maxRosterSize` (when set).

The same arithmetic is what `planPurchase`/`planReversal` write and what the client displays — both
sides import `computeTeamSummary` from `supabase/functions/_shared/calculations.ts`, so there is
exactly one implementation of "how much purse is left".

## Transaction shape

Every privileged write is one edge-function action planning one atomic `apply_plan` call:

1. All reads first (event, team, player, purchase, config, secrets as needed) inside a transaction
   collector that records each row's current value.
2. A pure planner from `supabase/functions/_shared/` turns the reads + input into the exact list of
   writes (`PlanResult` with `PlannedWrite[]`). The planner is the single place where
   money/ownership rules live, and it is unit-tested without a database.
3. The writes and the recorded preconditions are sent to `apply_plan`, which verifies every
   precondition (`data @> expected`, or "must not exist") and applies all writes or none. On a
   conflict the transaction callback retries with fresh state — the same contract Firestore
   transactions provided.

Because the purchase row id is the client `requestId`, a replay and a concurrent duplicate both
resolve to "already exists" inside the plan: the first commit wins, everyone else gets the recorded
result or a typed rejection — never a double charge.
