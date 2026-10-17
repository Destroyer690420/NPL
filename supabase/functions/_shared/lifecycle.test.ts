// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planCreateEvent, planCreatePlayer, planCreateTeam } from './mutations.ts'
import { planPurchase, planReversal } from './purchases.ts'
import { computeTeamSummary, validateEventConsistency } from './calculations.ts'
import type { PlannedWrite, PlanResult } from './plan.ts'
import type { EventDoc, PlayerDoc, PurchaseDoc, TeamDoc } from './types.ts'

/**
 * In-memory stand-in for Firestore that applies the exact writes a planner
 * returns. This exercises the full auction flow (create -> purchase -> reverse)
 * and re-derives every invariant from the stored documents, so the money and
 * ownership rules are verified without needing the emulator.
 */
class MemoryDb {
  readonly docs = new Map<string, Record<string, unknown>>()

  private pathFor(eventId: string, write: PlannedWrite): string {
    switch (write.kind) {
      case 'event':
        return `events/${eventId}`
      case 'player':
        return `events/${eventId}/players/${write.id}`
      case 'team':
        return `events/${eventId}/teams/${write.id}`
      case 'purchase':
        return `events/${eventId}/purchases/${write.id}`
      case 'auditLog':
        return `events/${eventId}/auditLogs/${write.id}`
      case 'secret':
        return `events/${eventId}/teamSecrets/${write.id}`
      case 'config':
        return `config/${write.id}`
      case 'pinIndex':
        return `pinIndex/${write.id}`
      default:
        throw new Error(`unhandled write kind`)
    }
  }

  apply(eventId: string, writes: readonly PlannedWrite[]): void {
    for (const write of writes) {
      const path = this.pathFor(eventId, write)
      if (write.op === 'set') {
        this.docs.set(path, { ...write.data })
      } else {
        this.docs.set(path, { ...(this.docs.get(path) ?? {}), ...write.data })
      }
    }
  }

  get<T>(path: string): T | null {
    const value = this.docs.get(path)
    return value ? ({ ...value } as T) : null
  }

  event(eventId: string): EventDoc {
    return { id: eventId, ...(this.get<object>(`events/${eventId}`) ?? {}) } as EventDoc
  }

  team(eventId: string, teamId: string): TeamDoc {
    return { id: teamId, ...(this.get<object>(`events/${eventId}/teams/${teamId}`) ?? {}) } as TeamDoc
  }

  player(eventId: string, playerId: string): PlayerDoc {
    return {
      id: playerId,
      ...(this.get<object>(`events/${eventId}/players/${playerId}`) ?? {}),
    } as PlayerDoc
  }

  purchase(eventId: string, purchaseId: string): PurchaseDoc | null {
    const data = this.get<object>(`events/${eventId}/purchases/${purchaseId}`)
    return data ? ({ id: purchaseId, ...data } as PurchaseDoc) : null
  }

  collection(eventId: string, name: string): Array<{ id: string } & Record<string, unknown>> {
    const prefix = `events/${eventId}/${name}/`
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ id: path.slice(prefix.length), ...data }))
  }

  snapshot(): string {
    return JSON.stringify([...this.docs.entries()].sort(([a], [b]) => a.localeCompare(b)))
  }
}

const EVENT = 'default'
const ALPHA = 'teamAlpha'
const BRAVO = 'teamBravo'
const PLAYER_1 = 'plr1'
const PLAYER_2 = 'plr2'
const PLAYER_3 = 'plr3'

function apply<T>(db: MemoryDb, result: PlanResult<T>): T {
  if (!result.ok) throw new Error(`unexpected failure: ${result.code}`)
  db.apply(EVENT, result.writes)
  return result.result
}

function setupEvent(db: MemoryDb, maxRosterSize: number | null = null): void {
  apply(
    db,
    planCreateEvent(
      {
        eventId: EVENT,
        name: 'College Auction',
        currencyLabel: '₹',
        defaultStartingPurse: 100_000,
        actorUid: 'admin-1',
        auditLogId: 'audit-event',
        setAsDefault: true,
      },
      { eventExists: false },
    ),
  )

  const teams: Array<[string, string, number]> = [
    [ALPHA, 'Team Alpha', 100_000],
    [BRAVO, 'Team Bravo', 60_000],
  ]
  for (const [id, name, purse] of teams) {
    apply(
      db,
      planCreateTeam(
        {
          eventId: EVENT,
          teamId: id,
          input: { name, startingPurse: purse },
          actorUid: 'admin-1',
          auditLogId: `audit-team-${id}`,
          pinLookupHash: `hash-${id}`,
          pinVerifier: `verifier-${id}`,
          pinVersion: 1,
        },
        { event: db.event(EVENT) as EventDoc, nameTaken: false },
      ),
    )
  }

  const players: Array<[string, string, number, number]> = [
    [PLAYER_1, 'Rohit', 200, 10_000],
    [PLAYER_2, 'Ishan', 120, 8_000],
    [PLAYER_3, 'Jasprit', 180, 12_000],
  ]
  for (const [id, name, points, basePrice] of players) {
    apply(
      db,
      planCreatePlayer(
        {
          eventId: EVENT,
          playerId: id,
          input: { name, points, basePrice },
          actorUid: 'admin-1',
          auditLogId: `audit-${id}`,
        },
        { event: db.event(EVENT) as EventDoc, duplicateExternalReference: false },
      ),
    )
  }

  // Activate the event (planners only; the function wrapper adds the same write).
  db.apply(EVENT, [
    { kind: 'event', id: EVENT, op: 'update', data: { status: 'active' } },
    { kind: 'event', id: EVENT, op: 'update', data: { maxRosterSize } },
  ])
}

function purchase(
  db: MemoryDb,
  playerId: string,
  teamId: string,
  finalPrice: number,
  requestId: string,
): PlanResult<unknown> {
  return planPurchase(
    { eventId: EVENT, playerId, teamId, finalPrice, requestId, actorUid: 'admin-1' },
    {
      event: db.event(EVENT),
      player: db.player(EVENT, playerId),
      team: db.team(EVENT, teamId),
      existingPurchaseForRequest: db.purchase(EVENT, requestId) ?? null,
      auditLogId: `audit-${requestId}`,
    },
  )
}

function reverse(db: MemoryDb, purchaseId: string, reason: string): PlanResult<unknown> {
  const existing = db.purchase(EVENT, purchaseId)
  return planReversal(
    { eventId: EVENT, purchaseId, reason, actorUid: 'admin-1' },
    {
      event: db.event(EVENT),
      purchase: existing,
      player: existing ? db.player(EVENT, existing.playerId) : null,
      team: existing ? db.team(EVENT, existing.teamId) : null,
      auditLogId: `audit-rev-${purchaseId}`,
    },
  )
}

function consistency(db: MemoryDb) {
  return validateEventConsistency({
    event: db.event(EVENT),
    teams: db.collection(EVENT, 'teams') as unknown as TeamDoc[],
    players: db.collection(EVENT, 'players') as unknown as PlayerDoc[],
    purchases: db.collection(EVENT, 'purchases') as unknown as PurchaseDoc[],
  })
}

describe('auction lifecycle (planner + write application)', () => {
  it('keeps every invariant across purchases, duplicate attempts and a reversal', () => {
    const db = new MemoryDb()
    setupEvent(db)

    // --- three sales -------------------------------------------------------
    apply(db, purchase(db, PLAYER_1, ALPHA, 20_000, 'req_0000000001'))
    apply(db, purchase(db, PLAYER_2, BRAVO, 25_000, 'req_0000000002'))
    apply(db, purchase(db, PLAYER_3, ALPHA, 30_000, 'req_0000000003'))

    expect(db.team(EVENT, ALPHA)).toMatchObject({
      totalSpent: 50_000,
      remainingPurse: 50_000,
      totalPoints: 380,
      playerCount: 2,
    })
    expect(db.team(EVENT, BRAVO)).toMatchObject({
      totalSpent: 25_000,
      remainingPurse: 35_000,
      totalPoints: 120,
      playerCount: 1,
    })
    expect(db.player(EVENT, PLAYER_1)).toMatchObject({
      status: 'sold',
      soldToTeamId: ALPHA,
      purchaseId: 'req_0000000001',
    })

    // stored totals equal the totals recomputed from purchase records
    for (const teamId of [ALPHA, BRAVO]) {
      const records = db
        .collection(EVENT, 'purchases')
        .filter((p) => p.teamId === teamId && p.status === 'confirmed')
      const recomputed = computeTeamSummary(
        db.team(EVENT, teamId).startingPurse,
        records.map((p) => ({
          finalPrice: p.finalPrice as number,
          points: p.playerPointsSnapshot as number,
        })),
      )
      expect({
        totalSpent: db.team(EVENT, teamId).totalSpent,
        remainingPurse: db.team(EVENT, teamId).remainingPurse,
        totalPoints: db.team(EVENT, teamId).totalPoints,
        playerCount: db.team(EVENT, teamId).playerCount,
      }).toEqual({
        totalSpent: recomputed.totalSpent,
        remainingPurse: recomputed.remainingPurse,
        totalPoints: recomputed.totalPoints,
        playerCount: recomputed.playerCount,
      })
    }

    expect(consistency(db).problems).toEqual([])

    // --- duplicate sale attempt (player is already sold) ------------------
    const before = db.snapshot()
    const duplicate = purchase(db, PLAYER_1, BRAVO, 15_000, 'req_0000000004')
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.code).toBe('player-already-sold')
    expect(db.snapshot()).toBe(before)

    // --- idempotent retry --------------------------------------------------
    const retry = purchase(db, PLAYER_3, ALPHA, 30_000, 'req_0000000003')
    expect(retry.ok).toBe(true)
    if (retry.ok) {
      expect(retry.result).toMatchObject({ idempotentReplay: true })
      expect(retry.writes).toHaveLength(0)
    }
    // the team was not charged twice
    expect(db.team(EVENT, ALPHA).totalSpent).toBe(50_000)

    // --- overspend attempt -------------------------------------------------
    const overspend = purchase(db, PLAYER_1, BRAVO, 15_000, 'req_0000000005')
    expect(overspend.ok).toBe(false)
    // Bravo keeps exactly 35,000 after the rejected attempt
    expect(db.team(EVENT, BRAVO).remainingPurse).toBe(35_000)
    expect(consistency(db).problems).toEqual([])

    // --- reversal ----------------------------------------------------------
    apply(db, reverse(db, 'req_0000000001', 'Wrong team selected'))

    expect(db.team(EVENT, ALPHA)).toMatchObject({
      totalSpent: 30_000,
      remainingPurse: 70_000,
      totalPoints: 180,
      playerCount: 1,
    })
    expect(db.player(EVENT, PLAYER_1)).toMatchObject({
      status: 'available',
      soldToTeamId: null,
      purchaseId: null,
    })
    expect(db.purchase(EVENT, 'req_0000000001')).toMatchObject({
      status: 'reversed',
      reversalReason: 'Wrong team selected',
      reversedBy: 'admin-1',
    })
    expect(consistency(db).problems).toEqual([])

    // --- overspend attempt on the released player --------------------------
    const overspendAfterRelease = purchase(db, PLAYER_1, BRAVO, 99_999_999, 'req_0000000006')
    expect(overspendAfterRelease.ok).toBe(false)
    if (!overspendAfterRelease.ok) expect(overspendAfterRelease.code).toBe('team-insufficient-purse')
    expect(db.team(EVENT, BRAVO).remainingPurse).toBe(35_000)

    // --- double reversal is impossible ------------------------------------
    const secondReversal = reverse(db, 'req_0000000001', 'Trying again')
    expect(secondReversal.ok).toBe(false)
    if (!secondReversal.ok) expect(secondReversal.code).toBe('purchase-already-reversed')

    // the released player can be sold again
    apply(db, purchase(db, PLAYER_1, BRAVO, 15_000, 'req_0000000007'))
    expect(db.team(EVENT, BRAVO)).toMatchObject({
      totalSpent: 40_000,
      remainingPurse: 20_000,
      totalPoints: 320,
      playerCount: 2,
    })
    expect(consistency(db).problems).toEqual([])

    // --- audit trail -------------------------------------------------------
    const auditActions = db
      .collection(EVENT, 'auditLogs')
      .map((log) => log.action as string)
    expect(auditActions.filter((a) => a === 'purchase.recorded')).toHaveLength(4)
    expect(auditActions.filter((a) => a === 'purchase.reversed')).toHaveLength(1)

    // --- no client ever sees PIN material ---------------------------------
    const teamDoc = db.team(EVENT, ALPHA) as unknown as Record<string, unknown>
    expect(JSON.stringify(teamDoc)).not.toContain('verifier')
    expect(JSON.stringify(db.collection(EVENT, 'players'))).not.toContain('pinLookupHash')
  })

  it('enforces the configured roster limit', () => {
    const db = new MemoryDb()
    setupEvent(db, 1)

    apply(db, purchase(db, PLAYER_1, ALPHA, 10_000, 'req_1000000001'))
    const rejected = purchase(db, PLAYER_3, ALPHA, 10_000, 'req_1000000002')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.code).toBe('team-roster-full')
  })

  it('never lets a team purse go negative even with many purchases', () => {
    const db = new MemoryDb()
    setupEvent(db)

    const prices = [30_000, 29_000, 1_000]
    prices.forEach((price, index) => {
      const result = purchase(db, PLAYER_1, BRAVO, price, `req_200000000${index}`)
      expect(result.ok).toBe(true)
      if (result.ok) db.apply(EVENT, result.writes)
      // free the player again for the next iteration (simulates re-selling)
      if (result.ok) {
        db.apply(EVENT, [
          {
            kind: 'player',
            id: PLAYER_1,
            op: 'update',
            data: { status: 'available', soldToTeamId: null, purchaseId: null },
          },
        ])
      }
    })

    expect(db.team(EVENT, BRAVO).remainingPurse).toBe(0)

    // Even a price of 1 more than the remaining purse is rejected.
    const rejected = purchase(db, PLAYER_1, BRAVO, 1, 'req_2000000009')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.code).toBe('team-insufficient-purse')
    expect(db.team(EVENT, BRAVO).remainingPurse).toBe(0)
    expect(db.team(EVENT, BRAVO).remainingPurse).toBeGreaterThanOrEqual(0)
  })
})
