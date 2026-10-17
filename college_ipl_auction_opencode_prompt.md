# OpenCode Build Specification --- College IPL Auction Manager

> **Purpose:** Build a production-ready, mobile-first web application
> for managing a college IPL-style player auction. This document is the
> source of truth for product behavior, screens, design, data model,
> security, implementation, and acceptance tests. Follow it carefully;
> do not merely create a visual prototype.

## 0. Instructions to the coding agent

You are the lead full-stack engineer. Inspect the existing repository
before changing anything. Preserve working conventions and code unless
there is a clear reason to improve them. If the repository is empty,
scaffold the application using the stack below.

Build the application end-to-end, not just the UI. Every visible control
must work. Every purchase must persist correctly. Do not leave fake
buttons, placeholder handlers, TODOs for core functionality, hardcoded
sample dashboard totals, or frontend-only calculations presented as
saved data.

Work in small phases: 1. Inspect the repository and report its current
structure and existing stack. 2. Write/update `PROJECT_PLAN.md` with
implementation phases and acceptance checks. 3. Implement one phase at a
time, run checks, fix errors, and update `PROJECT_PLAN.md`. 4. Keep
`README.md` current with setup, Firebase configuration, deployment, and
admin bootstrap instructions. 5. Add tests for critical logic. Do not
claim a feature is complete unless it works and has been verified. 6.
Never overwrite or delete existing user work without understanding it.
7. If credentials or Firebase configuration are missing, implement the
integration correctly with clear setup instructions and a safe
development mode. Never fabricate credentials or silently fall back to
fake persistence. 8. Prefer a simple, reliable product over unnecessary
features.

## 1. Product overview

The app supports a **physical, in-room auction**. The auctioneer
announces bids out loud. The web app does not conduct bidding and does
not need an auction presentation, live bidding controls, a projector
view, a public leaderboard, or a list of other teams' players.

The organizer uses a Canva presentation to show the players. When a
player is sold, the admin records: - the player, - the winning team, -
the final sale price.

After the admin confirms the purchase, the app must atomically: - mark
the player as sold, - assign the player to the winning team, - save the
final purchase price, - deduct that price from the team's remaining
purse, - add the player's points to the team's total points, - update
the team's player count and total spent, - write a permanent
transaction/audit record, - instantly update the winning team's open
panel through Firebase realtime updates.

There are exactly two product surfaces: 1. **Admin panel** --- full
control of event data and purchases. 2. **Team panel** --- a private,
read-only Dream11-inspired portfolio for one team.

Team members must see **only their own team's**: - remaining purse, -
total spent, - total points, - player count, - purchased players, - each
player's points, - each player's final purchase price.

Do not show teams unsold players, other teams, rankings, live bids,
upcoming players, auction strategy, or admin controls.

## 2. Technology and project conventions

Preferred stack: - React + Vite - TypeScript (preferred for reliable
data models; if the repository is already JavaScript, retain its
conventions unless migration is justified) - Tailwind CSS -
shadcn/ui-style accessible primitives where useful - Lucide icons -
Firebase Authentication for admin authentication - Cloud Firestore for
persistent data and realtime listeners - Firebase Cloud Functions for
privileged operations, PIN verification, and purchase transactions -
Firebase App Check where practical - Vitest and React Testing Library
for tests - Zod (or equivalent) for input validation - React Router for
routing

Use current stable, mutually compatible package versions. Do not
introduce a large state-management library without a demonstrated need.
Keep derived totals in a small, well-tested domain layer.

### Architecture rules

-   UI components must not directly mutate purse totals or player
    ownership.
-   All important mutations go through typed service functions and
    trusted backend operations.
-   Do not trust client-supplied points, starting purse, remaining
    purse, purchase status, or team identity.
-   Use Firestore transactions or an equivalent server-authoritative
    transaction pattern to prevent concurrent or duplicate sales.
-   Avoid denormalized fields becoming inconsistent. If totals are
    stored for efficient display, update them in the same atomic
    transaction as the purchase and test consistency.
-   Use integer values for money in the smallest unit used by the event.
    Never use floating-point arithmetic for purse calculations.
-   Use server timestamps for audit records.
-   Keep components small and understandable; separate UI, domain rules,
    Firebase adapters, validation schemas, and authorization.
-   Never put service account keys or privileged secrets in frontend
    environment variables.
-   Do not use an insecure public Firestore configuration.
-   Use a single event by default, but design records with an `eventId`
    so the app can be reused for future events.

## 3. Design system and visual direction

The interface should combine: - **Dream11-inspired sports portfolio
presentation:** compact player cards, clear points, visible purse and
squad summary, strong numeric hierarchy, and a subtle sports identity. -
**iOS-inspired usability:** restrained design, generous spacing, clear
hierarchy, rounded cards, readable typography, subtle separators,
predictable navigation, accessible controls, and polished feedback. -
**Minimal event-operations interface:** the admin can record many
purchases quickly without hunting through menus.

Do not copy Dream11 logos, proprietary assets, or branding. Use the
uploaded Dream11 team-lineup screenshot as inspiration for a
sports-oriented feel and strong player identity, not as a requirement to
copy its exact pitch layout. The actual team panel should prioritize the
player's name, points and price in a readable roster.

### Visual rules

-   Default visual theme: clean light interface with near-white
    surfaces, charcoal text, muted gray dividers, and one restrained
    green accent for positive balances/success.
-   Use dark charcoal sparingly for headers or strong emphasis.
-   Do not use gradients, glassmorphism, neon, excessive shadows,
    rainbow colors, or decorative charts.
-   Use consistent corner radii (roughly 12--18 px), spacing multiples,
    and icon sizes.
-   Use a modern system/Inter-like font stack. Prioritize legibility
    over novelty.
-   Use green for successful purchase confirmation and healthy purse
    status; amber for warnings; red only for destructive/error states.
-   Never communicate status by color alone; pair color with text or
    icons.
-   Buttons must have clear labels and comfortable touch targets
    (minimum \~44px where practical).
-   Respect `prefers-reduced-motion`. Use short, subtle transitions
    only.
-   Provide loading, empty, error, offline/reconnecting, disabled, and
    success states for all data-driven screens.
-   Use responsive layouts: mobile first, then tablet and desktop.
-   Admin screens must work on a laptop during the event and remain
    usable on a phone.
-   Team panel should be excellent on a narrow phone screen; avoid
    horizontal scrolling.

### Team panel design

Use a compact top summary: - team name and optional logo, - large
remaining purse, - total spent, - total points, - number of players.

Below it, show a simple roster of player cards. Each card shows: -
player name, - points in a prominent but compact label, - final purchase
price, - optional player photo only if configured and available.

A simple list is the default. If a visual "squad" layout inspired by
sports apps is used, it must not reduce readability or make the roster
difficult to scan. Do not require role/position data because the event
data only guarantees name, points, and reference/base price.

## 4. Roles and permissions

### Admin

-   Must sign in using Firebase Authentication.
-   Can create/edit/deactivate teams.
-   Can create/import/edit players.
-   Can set each team's starting purse.
-   Can generate, reveal, reset, and deactivate team PINs.
-   Can record purchases.
-   Can inspect all transactions and all teams.
-   Can reverse an erroneous purchase with a reason.
-   Can export reports.
-   Can lock/finalize the event.
-   Only authorized admin accounts can access admin routes or invoke
    privileged operations.

### Team user

-   Enters a four-digit team PIN.
-   After successful verification, receives a secure session bound to
    exactly one team and event.
-   Can only read that team's summary and roster.
-   Cannot change any data.
-   Cannot see other teams, player pool, transaction admin history,
    PINs, or admin routes.
-   Can log out.
-   Must not be able to switch team by changing a URL, query parameter,
    local storage value, or client request payload.

### PIN security

A four-digit PIN has only 10,000 possibilities. Treat it as a convenient
shared event access code, not strong authentication. - Verify PINs
server-side through a callable/HTTPS Cloud Function. - Normalize input
to exactly four digits; do not accept other characters. - Rate-limit
attempts per IP/session and PIN/team; add escalating cooldowns after
repeated failures. - Avoid revealing whether a particular team name/PIN
exists through overly specific error messages. - Store a secure
hash/HMAC verifier, never a raw PIN in a public team document. Use a
server-side secret where appropriate. - Never return every team's PIN or
PIN verifier to a client. - After successful verification, issue a
short-lived or revocable session credential that cannot change its team
identity. - Protect all team reads through server-verified claims/rules
or server endpoints. Do not rely only on hiding UI routes. - Provide
admin PIN reset and session revocation. - Do not persist raw PINs in
local storage, logs, analytics, or browser error reports. - Document any
Firebase limitations and the exact secure implementation used.

## 5. Routes and navigation

Suggested routes: - `/admin/login` --- admin sign-in. - `/admin` ---
admin dashboard. - `/admin/teams` --- team management. -
`/admin/teams/:teamId` --- team detail and roster. - `/admin/players`
--- player management. - `/admin/purchases/new` --- record purchase. -
`/admin/transactions` --- transaction history and corrections. -
`/admin/settings` --- event settings and finalization. - `/team/login`
--- team PIN login. - `/team` --- current authenticated team's private
panel. - `/` --- minimal landing page with clear Admin and Team access
choices, or redirect to the appropriate entry screen.

Route guards must be backed by backend authorization. A route guard is a
usability measure, not the security boundary. The team panel must derive
its team identity from the authenticated server-issued session, not from
a user-editable route parameter.

## 6. Screen specification: landing and login

### 6.1 Landing page

Keep it minimal: - event/app name, - short description such as "College
Auction Manager," - two primary actions: "Admin Login" and "Team
Login." - no public team data or player data. - responsive, accessible
layout.

### 6.2 Admin login

Elements: - email input, - password input, - show/hide password
control, - sign-in button, - loading indicator, - inline validation and
generic authentication error. - optional password reset flow if Firebase
Auth is configured for it.

Behavior: - Validate required fields before submitting. - Disable
duplicate submission while pending. - Never reveal whether an email is
registered. - On success, route to `/admin`. - On failure, show a
helpful but non-sensitive message. - Never store admin password in local
storage. - Persist Firebase Auth session using Firebase's supported
persistence settings.

### 6.3 Team PIN login

Elements: - event/app name, - "Enter your team PIN" heading, -
four-digit numeric input (one field is acceptable; four visual boxes are
also acceptable), - submit/continue button, - clear/reset input
action, - generic invalid PIN/temporary lockout message, - loading
state.

Behavior: - Accept exactly four digits. - Support mobile numeric keypad
and keyboard submission. - Do not authenticate until the full PIN is
entered. - Prevent rapid repeated requests. - On success, establish a
team-bound session and route to `/team`. - On failure, clear or retain
input according to usability, display an accessible message, and honor
cooldowns. - If the session expires, return to login with a brief
explanation. - Do not disclose the team identity or existence before
successful verification unless the product explicitly chooses a public
team selector (default: no team selector).

## 7. Screen specification: admin dashboard

The dashboard is an operational overview, not a public presentation.

### Header

-   app/event name,
-   active event label,
-   admin identity/menu,
-   status indicator (Setup, Active, Finalized),
-   navigation to Dashboard, Teams, Players, Record Purchase,
    Transactions, Settings.

### Summary cards

Calculate from actual persisted data: - number of teams, - total
players, - available players, - sold players, - total confirmed spend.

Each card should be clickable if it has a useful corresponding filtered
view. Never hardcode sample figures.

### Primary action

A prominent "Record Purchase" button that opens the purchase workflow.

### Recent purchases

Show the most recent 5--10 confirmed purchases: - player, - winning
team, - final price, - points awarded, - timestamp, - admin/operator.
Clicking a record opens its details.

### Operational warnings

Show actionable warnings: - no teams configured, - no players loaded, -
event not ready, - team has a zero/negative invalid balance (should
never occur), - available player has inconsistent sale status, -
connection unavailable, - event finalized.

### Loading and errors

Use skeletons or a clear loading state. If data fails, show retry
controls and do not display stale values as if current. Display
last-updated/connection status where useful.

## 8. Screen specification: team management

### Team list

Elements: - page title "Teams," - search by team name, - "Add Team"
button, - optional CSV import for teams if useful, - list/table of
teams.

Each row/card shows: - team name and optional logo, - starting purse, -
remaining purse, - total spent, - total points, - number of players, -
active/deactivated state, - actions menu.

On small screens use cards instead of a cramped table.

### Add team form

Fields: - team name (required), - optional logo URL/upload if storage is
configured, - starting purse (required non-negative integer in event
currency units), - generate four-digit PIN action.

Rules: - Team names should be unique within the event, ignoring
case/extra spaces. - Starting purse must be a valid integer and cannot
be negative. - Generate a cryptographically secure random four-digit PIN
server-side. - Handle accidental PIN collisions safely; a collision must
not grant access to the wrong team. - Show the new PIN once in a
prominent reveal/copy panel. The admin can copy it for the team. Do not
leak it through the public team record. - Allow explicit reveal/reset if
the system's secure PIN policy permits it; never retrieve a raw PIN if
only a verifier is stored. In that case reset it instead. - Confirm
successful creation and provide a route to team details.

### Team detail page

Show: - team name and optional logo, - starting purse, - remaining
purse, - total spent, - total points, - number of players, - purchased
roster, - transactions belonging to that team, - PIN status
(configured/reset needed, not the verifier), - actions: edit team
name/logo, reset PIN, deactivate/reactivate, view roster.

Do not allow editing remaining purse directly. It is derived from
starting purse and valid transactions. Changing the starting purse after
purchases exist requires a confirmation and audit record. If the event
is finalized, block changes unless an authorized admin explicitly
reopens it.

### Deactivation

Deactivation must block future team login and purchases. It must not
delete the team, roster, purchases, or audit history.

## 9. Screen specification: player management

### Player list

Elements: - page title "Players," - search by name/ID, - status filters:
All, Available, Sold, - sorting by name, points, base/reference price,
status, - "Add Player" button, - "Import CSV" button, - "Download CSV
Template" button, - clear empty state and error state.

Each row/card shows: - player name, - points, - base/reference price, -
status, - winning team and final price only in the admin interface if
sold, - edit action.

### Player data model

Required: - `id` (stable unique ID), - `eventId`, - `name` (trimmed,
non-empty), - `points` (integer; allow zero if the rules permit, never
negative), - `basePrice` (integer, non-negative), - `status`
(`available`, `sold`, or `withdrawn`), - created/updated timestamps.

Optional: - `photoUrl`, - `externalReference`, - admin notes.

Do not require role, cricket position, department, or category unless
added as an explicit optional future field. The provided event dataset
guarantees name, points and price only.

### Add/edit player form

-   Name.
-   Points.
-   Base/reference price.
-   Optional photo.
-   Save and cancel.

Validation: - trim strings, - reject empty names, - validate numeric
fields as finite integers, - reject negative values, - prevent duplicate
external IDs, - warn about possible duplicate names but do not
necessarily reject same-name players if their IDs differ.

Editing rules: - Before a player is sold, ordinary edits are allowed. -
Once sold, changing points or base price must show a warning and be
recorded in the audit log. - Changing a sold player's points must update
the team's point total safely if the product supports post-sale edits.
Preferred safer default: use a controlled "Correct player data"
operation with an audit reason and atomic recalculation. - Do not allow
an admin to mark a sold player available without reversing the linked
purchase.

### CSV import

Template columns: `player_id,name,points,base_price`

Requirements: - provide downloadable template, - accept UTF-8 CSV and
sensible spreadsheet exports, - preview rows before committing, -
display row numbers and precise validation errors, - show counts for
valid, invalid and duplicate rows, - allow cancellation before commit, -
never silently skip invalid rows, - never create partial unexpected
imports, - make duplicate handling explicit (skip, update, or cancel;
default should be cancel/skip with a clear report, not overwrite
silently), - provide a downloadable error report if practical.

## 10. Screen specification: record purchase --- highest priority

This is the most frequently used admin workflow. Optimize it for speed,
clarity and preventing mistakes.

### Layout

A single focused page or modal with these fields in order: 1. Player
search/select. 2. Winning team search/select. 3. Final sale price. 4.
Live validation/summary. 5. Confirm purchase button.

Keep the recent purchases panel visible beside or below the form on wide
screens and below it on mobile.

### Player selection

-   Search by name or ID.
-   Show points and base/reference price in the options.
-   Sold or withdrawn players must be disabled and clearly labelled.
-   If the selected player becomes sold by another operator before
    confirmation, reject the transaction and refresh the form.
-   No need to display the Canva presentation inside the app.

### Team selection

-   Search by team name.
-   Show remaining purse and player count beside each team.
-   Deactivated teams cannot be selected.
-   If a team's balance changes before confirmation, validate against
    the latest server-side balance.

### Final price

-   Required.
-   Positive integer unless the event's rules explicitly allow a free
    purchase (default: greater than zero).
-   Must be entered by the admin; do not silently substitute base price.
-   Use the event's configured currency/credit label consistently.
-   Format numbers with thousands separators in summaries.
-   Do not use floating point.

### Pre-confirmation summary

Show: - player name, - player points, - selected team, - final price, -
team's current remaining purse, - estimated remaining purse after
purchase, - team's points after purchase.

If the purchase would exceed the available purse, show a blocking error
and disable confirmation. This frontend validation is only a
convenience; the backend must independently validate the same
conditions.

### Confirmation

Use an explicit confirmation action with clear text, e.g. "Confirm
purchase for Team Alpha." On small screens ensure the action is not
hidden below a long form. Prevent double clicks.

### Server-side purchase operation

Implement a trusted callable/HTTPS Cloud Function (or equivalent trusted
server endpoint) that: 1. Authenticates the admin and checks admin
authorization. 2. Validates `eventId`, `playerId`, `teamId`, and final
price. 3. Reads current event state, player, team and relevant
transaction state inside a Firestore transaction. 4. Confirms event is
not finalized/locked. 5. Confirms player is available and not already
assigned. 6. Confirms team exists and is active. 7. Confirms price is a
valid integer and permitted by rules. 8. Confirms team has enough
remaining purse. 9. Confirms any optional squad limits if configured.
10. Atomically marks the player sold and records winning team/final
price. 11. Atomically reduces remaining purse, increases total spent,
increases total points, and increments roster count. 12. Creates a
purchase record and audit entry with server timestamp and admin UID. 13.
Returns a clear success result with the authoritative updated summary.
14. Returns a typed error without partial writes if any validation
fails.

Use a transaction/idempotency strategy to avoid duplicate purchase
writes from repeated submissions or network retries. A unique
operation/request ID can help ensure a retry of the same submission
cannot create a second charge. Firestore transaction retries must be
safe.

If two admins try to sell the same player concurrently, only one
purchase may succeed. The other must receive a "This player has already
been sold" error. No team can be charged twice for one player.

### After success

-   Show a clear success toast/panel with player, team, final price and
    points.
-   Clear the player/team/price form only after the server confirms
    success.
-   Keep the recent purchase visible.
-   Team roster and summary update through realtime listeners.
-   Preserve form values if the operation fails, so the admin can
    correct them.
-   Do not optimistically show a confirmed sale before the backend
    succeeds.

### Keyboard and speed

-   Search fields should be keyboard accessible.
-   Provide sensible tab order.
-   Enter may submit only when the form is valid and the confirmation
    design remains safe.
-   Avoid requiring multiple unnecessary screens for each purchase.
-   Do not implement "one click sale" that can accidentally charge the
    wrong team.

## 11. Screen specification: transaction history and corrections

### Transaction list

Show: - timestamp, - player, - team, - final price, - points credited, -
admin/operator, - status (`confirmed`, `reversed`), - optional
correction reason.

Filters: - team, - player, - date range, - status, - admin/operator.

Search by player or team name. Sort newest first by default. Provide CSV
export.

### Purchase details

Show all fields of the original transaction, including immutable IDs and
timestamps.

### Reversal/correction flow

A mistaken purchase must not be silently deleted. - Admin selects a
purchase and clicks "Reverse purchase." - Require a reason. - Show the
consequences before confirming: the price will be credited back to the
original team, points removed, player returned to available status
(unless another explicit policy prevents it), and the original
transaction preserved as reversed. - Trusted backend operation checks
authorization and transaction status. - Reversal must be atomic and
idempotent. - The original purchase must not be reversed twice. - Create
a separate reversal record/audit entry linked to the original. - Restore
the team's purse and points consistently. - If the team has since spent
its money, reversal still credits the exact original price; never let
balance calculations silently become negative. - If the player was
somehow reassigned after an inconsistent legacy state, stop and require
manual resolution instead of corrupting data. - A correction to the sale
price should be implemented as a controlled reversal and re-recording,
or as an atomic adjustment with a clear audit trail. Choose one safe,
documented approach.

## 12. Screen specification: event settings and finalization

### Settings

-   event name,
-   currency/credit label (e.g. `₹` or `credits`),
-   default starting purse for newly created teams (optional),
-   optional maximum roster size (default: no limit unless specified),
-   event status: Setup, Active, Finalized.

Starting purse is configured per team at creation; do not assume every
team has the same amount.

### Event lifecycle

-   **Setup:** teams and players can be created/imported; purchases may
    be disabled until admin starts the event if desired.
-   **Active:** purchases allowed; normal edits that could affect
    history are controlled.
-   **Finalized:** purchases and ordinary data mutations blocked; team
    panels remain read-only and accessible if policy permits.

Require confirmation for starting and finalizing. Finalization should
validate: - all confirmed purchases reference valid players and teams, -
no player has multiple active purchases, - purse calculations are
consistent, - team point totals reconcile with purchased player point
snapshots, - no pending/incomplete operations exist.

If validation fails, show actionable errors and do not finalize.

Provide an explicit "Reopen event" action restricted to super admins,
with mandatory reason and audit log.

## 13. Team panel behavior in detail

### Page structure

1.  Header: team logo (optional), team name, logout button/menu.
2.  Main financial card: remaining purse.
3.  Summary metrics: total spent, total points, number of players.
4.  "My Players" heading and roster.
5.  Empty state if no players have been purchased.

No sidebar is needed on mobile. Avoid complex tabs because the team only
needs one page.

### Player card

Each purchased player card displays: - player name, - points, - final
purchase price. Optional player photo may be shown if it exists; missing
photos must use a neutral placeholder. Do not display base price in
place of the actual purchase price. Label the final value clearly as
"Paid" or "Purchase price."

Sort the roster by most recently purchased by default, with an optional
simple sort by points or name only if it improves usability. Do not add
filters or statistics that clutter the experience.

### Calculations

-   `totalSpent` equals the sum of active, confirmed purchase prices.
-   `remainingPurse` equals `startingPurse - totalSpent`.
-   `totalPoints` equals the sum of the points snapshots for active,
    confirmed purchases.
-   `playerCount` equals the number of active, confirmed purchases.

These values must reconcile with transaction records. If stored as
denormalized fields for fast display, update them atomically with
purchase/reversal. Include tests that compare stored totals against
recomputed totals.

### Realtime

Use Firestore `onSnapshot` or equivalent subscriptions for the
authenticated team's summary and roster. - On a successful purchase,
changes should appear without manual refresh. - Show a small
"Updating..." state while reconnecting if needed. - On permission
errors, stop listeners and route to login or show an access error. -
Clean up listeners when the component unmounts. - Do not create one
listener per player if a roster query can be used. - Do not expose
another team's data in a shared listener/query.

### Empty state

When no players have been purchased: - show the team name and purse, -
total points 0, - total spent 0, - player count 0, - a simple message
such as "Your purchased players will appear here." Do not show the
admin's player pool or auction instructions.

## 14. Data model and invariants

Design the Firestore schema clearly. A reasonable baseline:

### `events/{eventId}`

-   `name`
-   `currencyLabel`
-   `status`: `setup | active | finalized`
-   `maxRosterSize` (optional/null)
-   `createdAt`, `updatedAt`
-   `createdBy`

### `events/{eventId}/teams/{teamId}`

-   `name`
-   `normalizedName`
-   `logoUrl` (optional)
-   `startingPurse` (integer)
-   `remainingPurse` (integer, maintained atomically)
-   `totalSpent` (integer, maintained atomically)
-   `totalPoints` (integer)
-   `playerCount` (integer)
-   `active`
-   `createdAt`, `updatedAt`

Do not store raw team PINs in this document.

### `events/{eventId}/players/{playerId}`

-   `name`
-   `normalizedName`
-   `points` (integer)
-   `basePrice` (integer)
-   `status`: `available | sold | withdrawn`
-   `soldToTeamId` (null until sold)
-   `purchaseId` (null until sold)
-   `photoUrl` (optional)
-   `createdAt`, `updatedAt`

### `events/{eventId}/purchases/{purchaseId}`

-   `playerId`
-   `playerNameSnapshot`
-   `teamId`
-   `teamNameSnapshot`
-   `finalPrice` (integer)
-   `pointsSnapshot` (integer)
-   `status`: `confirmed | reversed`
-   `createdBy`
-   `createdAt` (server timestamp)
-   `reversedAt` (optional)
-   `reversedBy` (optional)
-   `reversalReason` (optional)
-   `requestId` (idempotency key)

### `events/{eventId}/auditLogs/{logId}`

-   `actorUid`
-   `actorRole`
-   `action`
-   `targetType`
-   `targetId`
-   `reason` (when applicable)
-   `metadata` (minimal, no secrets)
-   `createdAt` (server timestamp)

### Private PIN/session records

Store PIN verifier and rate-limit/session data in a collection
inaccessible to team clients, or use another server-side secure
mechanism. Do not return the PIN verifier to the browser.

### Invariants --- must always hold

1.  One active purchase per player per event.
2.  A player with an active purchase has `status = sold`, the correct
    `soldToTeamId`, and matching `purchaseId`.
3.  A player without an active purchase must not be assigned to a team.
4.  `remainingPurse >= 0` for every team.
5.  `startingPurse - totalSpent = remainingPurse`.
6.  `totalSpent` equals the sum of active purchase prices.
7.  `totalPoints` equals the sum of active purchase points snapshots.
8.  `playerCount` equals the number of active purchases for that team.
9.  A reversed purchase cannot be reversed again.
10. All money/points totals use validated integer arithmetic.
11. Team users cannot read or mutate other teams' private records.
12. No team client can invoke an admin-only operation.

Document how the implementation maintains and verifies these invariants.

## 15. Firestore security and backend operations

Write restrictive Firestore Security Rules from the beginning: - Default
deny. - Admin reads/writes require verified admin authorization. - Team
reads are restricted to the authenticated session's one team and only to
the minimum required fields/collections. - Team clients have no direct
write permission for event, team totals, players, purchases, or audit
logs. - Private PIN/session documents are never readable by team
clients. - Do not rely on a frontend route guard. - Test rules using the
Firebase Emulator Suite if feasible.

Implement trusted backend functions for at least: - `createTeam` (admin
only; generates PIN securely server-side). - `resetTeamPin` (admin
only). - `verifyTeamPin` (publicly callable but strongly rate-limited;
creates a team-bound session). - `recordPurchase` (admin only; atomic
validation and write). - `reversePurchase` (admin only; atomic
reversal). - `createPlayer` / `updatePlayer` / `importPlayers` (admin
only; or carefully validated bulk writes). - `updateTeam` /
`deactivateTeam` (admin only). - `finalizeEvent` / `reopenEvent` (admin
or super admin as appropriate). - report/export endpoints if needed.

If Cloud Functions are used, follow the currently supported Firebase
runtime and deploy structure. Validate all inputs on the server, not
just with client-side Zod. Keep authorization logic centralized and
tested.

## 16. Error handling and operational reliability

Provide consistent messages for: - wrong PIN, - rate limit/cooldown, -
expired session, - not authorized, - player already sold, - team
inactive, - insufficient purse, - invalid sale price, - event
finalized, - connection lost, - duplicate request, - server unavailable.

Do not expose internal stack traces or secrets to users.

During the live event: - Do not optimistically mark a player sold before
backend success. - Disable the submit button while a purchase is
processing. - Use idempotency keys to protect against double
submissions. - On network timeout, check the transaction/request ID
before retrying to avoid double charging. - If a mutation outcome is
uncertain, display "Checking purchase status..." and reconcile with the
server before enabling a retry. - Show a visible Firebase connection
state in the admin UI. - Keep the last confirmed transaction visible for
verification. - Never silently discard failed changes. - Use an error
boundary for unexpected UI errors. - Provide safe retry actions.

## 17. Accessibility and responsive behavior

-   All forms have visible labels, not placeholder-only labels.
-   Keyboard navigation and focus indicators work.
-   Dialogs trap focus and return focus to the triggering control.
-   Errors are announced to assistive technology.
-   Color contrast is sufficient.
-   Buttons have descriptive names.
-   The team panel is usable at 320px width and on common mobile
    browsers.
-   Admin tables collapse into cards on narrow screens.
-   Numeric values do not overflow; use formatted amounts and tabular
    numerals.
-   Avoid relying on hover for essential functionality.

## 18. Testing requirements

### Unit tests

Test: - purse calculation, - points calculation, - roster count, -
integer and price validation, - player status transitions, - duplicate
purchase prevention logic, - reversal logic, - team PIN format
validation, - event lifecycle permissions.

### Integration/backend tests

Using Firebase Emulator Suite where possible: - valid purchase updates
player, team, purchase and audit records together, - insufficient purse
rejects purchase without any partial writes, - sold player cannot be
purchased again, - two simultaneous purchase attempts for one player
yield exactly one success, - double-submit/idempotent retry charges only
once, - inactive team cannot buy a player, - finalized event rejects
purchases, - valid reversal restores the correct balance and points, -
second reversal is rejected, - unauthorized user cannot create a
purchase, - team session cannot read another team's data, - team session
cannot write any data, - invalid PIN attempts trigger cooldown, - raw
PINs/verifiers are not exposed in public reads.

### UI tests

-   admin can sign in,
-   admin can create a team and obtain the PIN,
-   admin can add a player,
-   admin can select a player/team and record a purchase,
-   validation errors are clear,
-   team can log in using its PIN,
-   team sees its own players and totals,
-   realtime updates appear after a confirmed purchase,
-   team logout and session expiration work,
-   empty states display correctly.

### Manual acceptance run

Create at least two teams and three players in a development/test event.
Perform purchases, verify balances and points, reverse one purchase,
attempt a duplicate sale, attempt overspending, and confirm team
isolation. Reconcile the totals against purchase records. Do not test
with production event data.

## 19. Seed data and development mode

-   Do not seed fake data into production.
-   If sample data is useful for development, make it opt-in and clearly
    label it as demo data.
-   Never allow demo mode to appear as a successful Firebase-backed
    production mode.
-   Provide a documented way to create the first admin securely, such as
    Firebase Auth plus a server-side allowlist or a one-time setup
    script. Do not let a public visitor self-promote to admin.
-   Keep `.env.example` with variable names only, never secrets.
-   Add `.gitignore` entries for local credentials, service account
    files, build outputs, and environment files.

## 20. Documentation and developer experience

Create or update: - `README.md` --- overview, requirements,
installation, local development, Firebase setup, emulator setup, deploy,
first admin setup, import format, troubleshooting. - `PROJECT_PLAN.md`
--- phases, checklists, current status, verification results, and next
steps. - `docs/DATA_MODEL.md` --- schema and invariants. -
`docs/SECURITY.md` --- roles, PIN security, authorization, rules, threat
assumptions. - `docs/EVENT_DAY_RUNBOOK.md` --- setup checklist, test
purchase, connectivity check, recovery process, correction workflow,
finalization and export. - `firestore.rules` and indexes configuration
as needed. - Cloud Functions source and tests. - `.env.example`.

Never write secrets, real PINs, service account credentials, or private
event data into documentation or logs.

## 21. Event-day runbook functionality

The app should make it possible for the organizer to: 1. Sign in as
admin. 2. Create the event and set the currency label. 3. Add all teams
and their starting purses. 4. securely distribute each team's PIN. 5.
Import and validate all players. 6. Verify the event readiness summary.
7. Perform a clearly labelled test in a separate test event before the
actual event. 8. Start the event. 9. Record each sold player quickly.
10. Check recent transactions and team balances throughout the event.
11. Reverse a mistake if necessary, with a reason. 12. Reconcile totals
and export results. 13. Finalize the event and leave team panels
read-only.

Add a concise checklist in the admin UI or runbook, but do not clutter
the main purchase workflow.

## 22. Explicit non-goals

Do not build: - online bidding, - a live auctioneer console, - a
Canva/presentation viewer, - a public projector screen, - a public
player marketplace, - other teams' dashboards or rosters for team
users, - rankings/leaderboards for team users, - chat, - notifications
unrelated to purchase updates, - fantasy cricket lineup selection, -
cricket roles/positions unless the event dataset later requires them, -
complex charts or analytics, - payment processing, - an elaborate
multi-event SaaS billing system.

Keep the first release focused on safe purchase recording and private
team portfolios.

## 23. Definition of done

The application is complete only when all of the following are true: -
Admin authentication and server-side authorization work. - Team PIN
verification is secure enough for the documented event threat model,
with rate limiting and team-bound sessions. - Admin can create teams
with independent starting purses. - Admin can create/import players with
name, points and reference price. - Admin can record a final purchase
price and assign the player to a team. - Every valid purchase updates
player status, purchase history, purse, spend, points and player count
atomically. - Invalid purchases cause no partial writes. - Duplicate and
concurrent sales are prevented. - Team panels show only their own team
and purchased players. - Team panels update automatically without
refreshing. - Reversals are controlled, atomic, reasoned and
auditable. - The app handles loading, empty, error, offline and
reconnecting states. - CSV import/export works and reports validation
errors clearly. - Firestore rules deny unauthorized access by default. -
Unit and integration tests cover all critical financial and ownership
logic. - No core buttons are decorative or nonfunctional. -
`npm run build`, lint/type checks, and tests pass. - README, security
documentation, data model and event-day runbook are accurate. - The
implementation does not claim Firebase is configured or deployed until
it has actually been verified.

## 24. Final instruction to OpenCode

Start by inspecting the repository and existing configuration. Then
create/update `PROJECT_PLAN.md` and implement the product in small,
verified phases. Prioritize the purchase transaction, data integrity,
PIN security, and team data isolation above visual polish. Build the UI
to the Dream11-inspired and iOS-inspired design principles above, but
keep it restrained and exceptionally easy to operate.

Do not stop after generating a plan or a static mockup. Continue
implementing the working application, run the available checks, fix
failures, and report: - what was implemented, - files changed, -
commands/tests run and their actual results, - Firebase setup steps
still required, - any known limitations or incomplete work.

Never claim tests, deployment, or Firebase integration succeeded unless
you actually ran and verified them.
