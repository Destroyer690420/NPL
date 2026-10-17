# Data model

Firestore layout, document shapes and the invariants the consistency check enforces. Types live in
`functions/src/shared/types.ts` (imported by both the web app and the Cloud Functions); the rules
that protect each collection live in `firestore.rules` (see `docs/SECURITY.md`).

## Layout

```
config/app                                 public display config (event name, currency, default event id)
pinIndex/{eventId}:{lookupHash}            server-only PIN lookup index   (never client-readable)
rateLimits/{...}                           server-only rate limit counters (never client-readable)

events/{eventId}
  ├─ teams/{teamId}
  ├─ players/{playerId}
  ├─ purchases/{purchaseId}                purchaseId === client requestId (idempotency)
  ├─ auditLogs/{logId}
  ├─ teamSecrets/{teamId}                  server-only PIN verifier        (never client-readable)
  └─ sessions/{sessionId}                  server-only team session records (never client-readable)
```

Everything is scoped under one `events/{eventId}` tree — one deployment can host multiple events,
and the app works against the *default* event (`VITE_DEFAULT_EVENT_ID` override →
`config/app.defaultEventId` → `default`).

## Documents

### `config/app`

Public, non-sensitive display configuration. Read by everyone (players before login need the event
name and currency), written by functions only.

| Field | Type | Notes |
| --- | --- | --- |
| `defaultEventId` | `string \| null` | the event the app opens by default |
| `eventName` | `string` | display name of the default event |
| `currencyLabel` | `string` | e.g. `₹`, `credits` |
| `eventStatus` | `'setup' \| 'active' \| 'finalized' \| null` | drives badges before login |
| `updatedAt` | timestamp | |

### `events/{eventId}`

| Field | Type | Notes |
| --- | --- | --- |
| `name`, `currencyLabel` | string | display |
| `status` | `'setup' \| 'active' \| 'finalized'` | `setup` blocks purchases, `finalized` is read-only |
| `maxRosterSize` | `number \| null` | `null` = unlimited (≤ 200) |
| `defaultStartingPurse` | number | pre-fills new-team forms; each team stores its own |
| `purchasesEnabled` | boolean | operator switch; `false` blocks purchases even when active |
| `createdBy`, `createdAt`, `updatedAt` | | |

### `events/{eventId}/teams/{teamId}`

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

### `events/{eventId}/players/{playerId}`

| Field | Type | Notes |
| --- | --- | --- |
| `name`, `normalizedName` | string | unique per event |
| `points` | number | award value, ≤ 1,000,000 |
| `basePrice` | number | starting price for the purchase form |
| `status` | `'available' \| 'sold' \| 'withdrawn'` | |
| `soldToTeamId`, `purchaseId` | `string \| null` | only while `sold` |
| `photoUrl`, `externalReference`, `notes` | `string \| null` | `externalReference` is the CSV `player_id` |
| timestamps | | |

### `events/{eventId}/purchases/{purchaseId}`

`purchaseId` **is** the client-generated `requestId` (pattern `^[A-Za-z0-9_-]{8,72}$`). This is the
idempotency key: a retried submit reads the existing document inside the transaction and returns
the original result instead of writing again.

| Field | Type | Notes |
| --- | --- | --- |
| `playerId`, `teamId` | string | current references |
| `playerNameSnapshot`, `playerPointsSnapshot`, `playerPhotoUrlSnapshot` | | frozen at sale time — later player edits never rewrite history |
| `teamNameSnapshot` | string | same idea for teams |
| `finalPrice` | number | > 0, whole |
| `status` | `'confirmed' \| 'reversed'` | reversed purchases stay forever |
| `createdBy`, `requestId`, `createdAt` | | |
| `reversedAt`, `reversedBy`, `reversalReason` | | set on reversal (`reason` ≥ 3 chars) |

### `events/{eventId}/auditLogs/{logId}`

| Field | Type | Notes |
| --- | --- | --- |
| `actorUid`, `actorRole`, `actorEmail` | | who acted; `actorEmail` is null while the interim shared admin login is in use (uid `organizer`) |
| `action` | enum | `event.*`, `team.*`, `player.*`, `purchase.recorded`, `purchase.reversed`, `session.*`, … |
| `targetType`, `targetId` | | what was acted on |
| `reason` | `string \| null` | required for corrections/reversals |
| `metadata` | flat map of primitives | non-secret details (deltas, names) |
| `createdAt` | timestamp | |

### Server-only collections

Not readable by *any* client — not even admins — because they contain secrets or verifier material:

- `teamSecrets/{teamId}` — `pinVerifier` (HMAC of `eventId:teamId:pin`), `pinLookupHash`
  (HMAC of `eventId:pin`), `pinVersion`, `pinSetAt`, `pinSetBy`.
- `events/{eventId}/sessions/{sessionId}` — `teamId`, `revoked`, `expiresAt`, `createdAt`,
  `createdByIpHash`. Rules re-read this document on every team read; flipping `revoked` to `true`
  (or letting `expiresAt` pass) cuts access immediately.
- `pinIndex/{eventId}:{lookupHash}` — maps a PIN to `{teamId, pinVersion}` for O(1) login without
  storing the PIN.
- `rateLimits/{...}` — fixed-window counters for PIN attempts.

## Invariants (enforced by `validateEventConsistency`)

Run automatically before finalization and on demand via **Settings → Run consistency check**
(`checkEventConsistency`). A failing check blocks finalization.

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
sides import `computeTeamSummary` from `functions/src/shared/calculations.ts`, so there is exactly
one implementation of "how much purse is left".

## Transaction shape

Every privileged write is one Firestore transaction in one callable:

1. All reads first (event, team, player, purchase, config, secrets as needed).
2. A pure planner from `functions/src/shared/` turns the reads + input into the exact list of
   writes (`PlanResult` with `PlannedWrite[]`).
3. The function applies those writes; the planner is the single place where money/ownership rules
   live, and it is unit-tested without a database.

Because the purchase id is the client `requestId`, a replay and a concurrent duplicate both resolve
to "already exists" inside the transaction: the first commit wins, everyone else gets the recorded
result or a typed rejection — never a double charge.
