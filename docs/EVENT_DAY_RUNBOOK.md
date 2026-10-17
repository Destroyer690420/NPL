# Event-day runbook

The operating procedure for the organizer, from setup to finalised results. Keep this open on the
purchase desk. Every screen referenced here is real — Dashboard, **Record purchase**, Players,
Teams, Transactions, Settings — and each action below is a working button, not a mock.

---

## 0. Before the event (one time)

- [ ] `npm run setup`, `.env.local` filled (project URL + publishable key), SQL migrations run and `auction-api` deployed — see README → Supabase setup.
- [ ] `ADMIN_LOGIN_ID` / `ADMIN_LOGIN_PASSWORD` secrets set to something **other than** `admin`/`admin`; sign in at `/admin` and confirm the console opens and no default-credentials banner shows.
- [ ] Optional: set the `PIN_HMAC_SECRET` secret so the PIN hashing secret is explicit rather than auto-generated (fine either way).
- [ ] Open the site on the purchase-desk laptop, sign in, **bookmark it**. Test Wi-Fi and a backup hotspot.

## 1. Readiness checklist (evening before)

Do this in the **real event**, then repeat it in a throwaway demo event as a dress rehearsal
(`node scripts/seed-demo.mjs …` creates a labelled `[DEMO]` event — never mix it with the real one).

1. **Settings** → set event name, currency label, roster limit, default starting purse. Save.
2. **Teams** → add every team with its starting purse. Each create shows its **PIN exactly once** —
   distribute it to the team then and there (screenshot/slip/WhatsApp). Lost PIN? **Reset PIN** any
   time; old sessions die instantly.
3. **Players** → add manually or **Import CSV** (validate → per-row errors → Import). Check the
   pool count and spot-check base prices.
4. **Settings** → **Run consistency check** → expect “no problems” on a fresh event.
5. **Settings** → **Start auction** (enabled once at least one team and one player exist).

## 2. Connectivity and live check

- **Dashboard**: cards (teams, available/sold, spend) and *Recent purchases* refresh automatically
  (every few seconds and whenever the tab regains focus). If the header badge says
  **“Offline — showing cached data”**, a refresh failed — the last good data stays visible and the
  app keeps retrying; writes are unaffected once the network returns.
- **Team panel**: open `/team` on a phone, pick the team, enter its PIN. The roster must appear and
  update when you record a purchase. This is the real end-to-end check — do it once before the
  first sale.

**One-minute test purchase (in the demo event):** Record purchase → pick a team + player → price →
Confirm → success receipt → open the team panel and watch the roster/purse change. Then
**Transactions** → Reverse it with a reason → totals return to normal.

## 3. During the auction — recording sales

For every sale:

1. **Record purchase** (keep this open; it is the fastest path).
2. Type a player name → pick from the list. Sold/disabled players are visible but not selectable.
3. Pick the team — the picker shows the live remaining purse; the price field pre-fills the base
   price.
4. Enter the final price → the live summary shows purse-after and points; problems block Confirm.
5. **Confirm** (with the explicit confirmation dialog).

What protects you here:

- The **requestId is fixed per submission attempt** — if the network stalls and you press Retry,
  the retry cannot double-charge. If the browser died mid-submit, use **“Check if it was recorded”**
  on the receipt instead of re-recording.
- Duplicate sales (same player, another team) are rejected inside the transaction: exactly one
  wins. Overspend, roster-full, withdrawn player, finalized event, purchases-disabled — all produce
  explicit blocking errors, and **no partial writes happen in any failure case**: counters, player
  status and purchase records move together or not at all.
- The receipt shows the new team totals. Cross-check with the **Dashboard** and **Transactions**.

## 4. Monitoring through the day

- **Dashboard** — spend leaderboard as cards, recent purchases, warnings (e.g. inconsistent totals).
- **Transactions** — full history, newest first; filter Confirmed/Reversed; search player/team;
  **Export CSV** for a spreadsheet.
- **Teams** — any team → detail: strike-through/roster, totals, session state; **Revoke sessions**
  if a phone is lost; **Deactivate** a team to block buying and login.

## 5. Recovery: fixing mistakes

| Situation | Do this |
| --- | --- |
| Wrong price / wrong team recorded | **Transactions** → find the purchase → **Reverse** → read the consequence preview (players returned, purse refunded) → type a reason (≥ 3 chars) → confirm. Then re-record at the correct price. Reversed purchases stay in history forever, auditable. |
| Reversed by accident | Record the sale again normally — the player is back in the pool. |
| Player details wrong (name/points/price) after sale | **Players** → edit with a reason; totals are re-derived atomically. Editing *into* a state that conflicts with the purchase is blocked (`player-status-conflict`) — reverse first if ownership must change. |
| Team’s phone lost / PIN leaked | **Teams** → team → **Reset PIN** (new PIN, all sessions revoked) and hand over the new PIN. |
| Someone left the team’s device logged in | **Teams** → team → **Revoke sessions** — the panel locks on the next read, no waiting. |
| Totals look wrong | **Settings** → **Run consistency check**. It reports exactly which record disagrees and blocks finalization while problems exist. Bring the report to the developer before editing anything manually in the Supabase Table Editor. |
| Sold player appears on the wrong team | Reverse the purchase, then the player returns to the pool and can be sold to the correct team. |
| Two operators, double submit | Second submit gets the recorded result (idempotent replay) or `player-already-sold`. Never delete purchase docs by hand. |

**Golden rules:** reverse, never edit/delete purchase documents; always type a real reason; run the
consistency check after any manual intervention.

## 6. Finish line

1. Confirm the last sale is recorded and teams’ purses look right on the Dashboard.
2. **Transactions** → Export CSV (keep a copy). Players page → Export CSV for the pool state.
3. **Settings** → **Run consistency check** → must be clean.
4. **Settings** → **Finalize auction** → success means data is now read-only: team panels remain
   readable, purchases are frozen. The finalization itself is written to the audit log.
5. Announce results. Team panels keep working in read-only mode.

Need a post-event correction after finalizing? Only a **superAdmin** can **Reopen auction**
(Settings), with a reason; do it deliberately, re-check consistency, and finalize again.

## 7. Post-event

- Leave the data in place — team panels stay valid as historical records.
- Keep the Transactions export with the event documents.
- Demo events (`[DEMO] …`) can be deleted from the Supabase Table Editor: delete rows with
  `event_id = 'demo'` in `teams`, `players`, `purchases`, `audit_logs`, `team_secrets`, then the
  `demo` row in `events`.

## Quick reference

| Need | Where |
| --- | --- |
| Fastest path to sell a player | `/admin/purchases/new` |
| Undo a sale | `/admin/transactions` → Reverse |
| Everyone’s money | `/admin` (Dashboard) |
| Audit trail of every action + reasons | `/admin/transactions` + Postgres `audit_logs` table |
| Lock out a team | `/admin/teams` → Revoke sessions / Deactivate |
| Integrity check | `/admin/settings` → Run consistency check |
| Start / finalize | `/admin/settings` → Auction lifecycle |
| Team view | `/team` (PIN) |

*Fill in for your event: organizer mobile — ______, co-organizer — ______, developer on call — ______.*
