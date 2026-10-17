// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  planCreateEvent,
  planCreatePlayer,
  planCreateTeam,
  planImportPlayers,
  planSetDefaultEvent,
  planUpdateEvent,
  planUpdatePlayer,
  planUpdateTeam,
  validatePlayerInput,
} from './mutations.ts'
import { makeEvent, makePlayer, makePurchase, makeTeam } from './fixtures.ts'
import { validateEventConsistency } from './calculations.ts'
import type { PlanResult } from './plan.ts'

function expectFailure(result: PlanResult<unknown>, code: string) {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.code).toBe(code)
}

const auditLogId = 'audit-x'
const actorUid = 'admin-1'

describe('validatePlayerInput', () => {
  it('trims names and normalises them for comparisons', () => {
    const result = validatePlayerInput({
      name: '  Virat   Kohli ',
      points: 250,
      basePrice: 10_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.name).toBe('Virat Kohli')
    expect(result.value.normalizedName).toBe('virat kohli')
  })

  it.each<[string, Parameters<typeof validatePlayerInput>[0]]>([
    ['empty name', { name: '   ', points: 10, basePrice: 100 }],
    ['negative points', { name: 'A', points: -1, basePrice: 100 }],
    ['fractional points', { name: 'A', points: 1.5, basePrice: 100 }],
    ['negative base price', { name: 'A', points: 10, basePrice: -5 }],
    ['bad photo url', { name: 'A', points: 10, basePrice: 100, photoUrl: 'javascript:alert(1)' }],
  ])('rejects %s', (_label, input) => {
    expect(validatePlayerInput(input).ok).toBe(false)
  })

  it('allows zero points and zero base price', () => {
    const result = validatePlayerInput({ name: 'Bench Player', points: 0, basePrice: 0 })
    expect(result.ok).toBe(true)
  })
})

describe('planCreatePlayer', () => {
  const command = {
    eventId: 'default',
    playerId: 'p1',
    input: { name: 'Player One', points: 50, basePrice: 2_000 },
    actorUid,
    auditLogId,
  }

  it('creates the player as available with no assignment', () => {
    const result = planCreatePlayer(command, { event: makeEvent(), duplicateExternalReference: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const playerWrite = result.writes.find((w) => w.kind === 'player')
    expect(playerWrite?.data).toMatchObject({
      name: 'Player One',
      points: 50,
      basePrice: 2_000,
      status: 'available',
      soldToTeamId: null,
      purchaseId: null,
      externalReferenceLower: null,
    })
    expect(result.writes.some((w) => w.kind === 'auditLog')).toBe(true)
  })

  it('rejects duplicate external references and finalized events', () => {
    expectFailure(
      planCreatePlayer(
        { ...command, input: { ...command.input, externalReference: 'IPL-1' } },
        { event: makeEvent(), duplicateExternalReference: true },
      ),
      'player-duplicate-external-id',
    )
    expectFailure(
      planCreatePlayer(command, { event: makeEvent({ status: 'finalized' }), duplicateExternalReference: false }),
      'event-finalized',
    )
  })
})

describe('planUpdatePlayer', () => {
  const command = {
    eventId: 'default',
    playerId: 'p1',
    patch: { points: 200 },
    reason: 'Correcting points from the scorecard',
    actorUid,
    auditLogId,
  }

  it('allows ordinary edits before a sale', () => {
    const result = planUpdatePlayer(command, {
      event: makeEvent(),
      player: makePlayer('p1', { points: 100 }),
      team: null,
      purchase: null,
      duplicateExternalReference: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.writes.some((w) => w.kind === 'team')).toBe(false)
    expect(result.result.corrected).toBe(false)
  })

  it('blocks marking a sold player available', () => {
    expectFailure(
      planUpdatePlayer(
        { ...command, patch: { status: 'available' } },
        {
          event: makeEvent(),
          player: makePlayer('p1', { status: 'sold', soldToTeamId: 't1', purchaseId: 'purch_1' }),
          team: makeTeam('t1', { totalPoints: 100, playerCount: 1, totalSpent: 10_000 }),
          purchase: makePurchase('purch_1'),
          duplicateExternalReference: false,
        },
      ),
      'player-status-conflict',
    )
  })

  it('requires a reason when changing a sold player', () => {
    expectFailure(
      planUpdatePlayer(
        { ...command, reason: null },
        {
          event: makeEvent(),
          player: makePlayer('p1', { status: 'sold', soldToTeamId: 't1', purchaseId: 'purch_1' }),
          team: makeTeam('t1', { totalPoints: 100, playerCount: 1, totalSpent: 10_000 }),
          purchase: makePurchase('purch_1'),
          duplicateExternalReference: false,
        },
      ),
      'reason-required',
    )
  })

  it('recalculates team points atomically and audits the correction', () => {
    const result = planUpdatePlayer(command, {
      event: makeEvent(),
      player: makePlayer('p1', { status: 'sold', soldToTeamId: 't1', purchaseId: 'purch_1', points: 100 }),
      team: makeTeam('t1', { totalPoints: 100, playerCount: 1, totalSpent: 10_000, remainingPurse: 90_000, startingPurse: 100_000 }),
      purchase: makePurchase('purch_1', { playerPointsSnapshot: 100 }),
      duplicateExternalReference: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const teamWrite = result.writes.find((w) => w.kind === 'team')
    expect(teamWrite?.data).toMatchObject({ totalPoints: 200 })
    const auditWrite = result.writes.find((w) => w.kind === 'auditLog')
    expect(auditWrite?.data).toMatchObject({ action: 'player.corrected', reason: command.reason })
    expect(result.result).toMatchObject({ corrected: true, pointsDelta: 100 })
  })

  it('refuses a correction that would make team points negative', () => {
    expectFailure(
      planUpdatePlayer(
        { ...command, patch: { points: 10 } },
        {
          event: makeEvent(),
          player: makePlayer('p1', { status: 'sold', soldToTeamId: 't1', purchaseId: 'purch_1', points: 100 }),
          team: makeTeam('t1', { totalPoints: 20, playerCount: 1, totalSpent: 10_000 }),
          purchase: makePurchase('purch_1'),
          duplicateExternalReference: false,
        },
      ),
      'team-state-inconsistent',
    )
  })

  it('keeps the sale snapshot name in sync for display fields', () => {
    const result = planUpdatePlayer(
      { ...command, patch: { name: 'Corrected Name' }, reason: null },
      {
        event: makeEvent(),
        player: makePlayer('p1', { status: 'sold', soldToTeamId: 't1', purchaseId: 'purch_1' }),
        team: makeTeam('t1', { totalPoints: 100, playerCount: 1, totalSpent: 10_000 }),
        purchase: makePurchase('purch_1'),
        duplicateExternalReference: false,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const purchaseWrite = result.writes.find((w) => w.kind === 'purchase')
    expect(purchaseWrite?.data).toMatchObject({ playerNameSnapshot: 'Corrected Name' })
  })
})

describe('planCreateTeam', () => {
  const command = {
    eventId: 'default',
    teamId: 't1',
    input: { name: 'Team Alpha', startingPurse: 120_000 },
    actorUid,
    auditLogId,
    pinLookupHash: 'lookup-hash',
    pinVerifier: 'verifier',
    pinVersion: 1,
  }

  it('creates the team with a full purse and stores only PIN hashes', () => {
    const result = planCreateTeam(command, { event: makeEvent(), nameTaken: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const teamWrite = result.writes.find((w) => w.kind === 'team')
    expect(teamWrite?.data).toMatchObject({
      name: 'Team Alpha',
      normalizedName: 'team alpha',
      startingPurse: 120_000,
      remainingPurse: 120_000,
      totalSpent: 0,
      totalPoints: 0,
      playerCount: 0,
      active: true,
    })

    const secretWrite = result.writes.find((w) => w.kind === 'secret')
    expect(secretWrite?.data).toMatchObject({ pinVerifier: 'verifier', pinLookupHash: 'lookup-hash' })
    // The team document must never contain PIN material.
    expect(Object.keys(teamWrite?.data ?? {})).not.toContain('pin')
    expect(result.writes.some((w) => w.kind === 'pinIndex')).toBe(true)
  })

  it('rejects duplicate names (case/space insensitive)', () => {
    expectFailure(planCreateTeam(command, { event: makeEvent(), nameTaken: true }), 'team-name-taken')
  })

  it('rejects invalid purses', () => {
    expectFailure(
      planCreateTeam(
        { ...command, input: { name: 'Team Beta', startingPurse: -1 } },
        { event: makeEvent(), nameTaken: false },
      ),
      'invalid-argument',
    )
  })
})

describe('planUpdateTeam', () => {
  const team = makeTeam('t1', {
    name: 'Team Alpha',
    normalizedName: 'team alpha',
    startingPurse: 100_000,
    totalSpent: 40_000,
    remainingPurse: 60_000,
    playerCount: 2,
  })

  it('requires a reason when the starting purse changes', () => {
    expectFailure(
      planUpdateTeam(
        { eventId: 'default', teamId: 't1', patch: { startingPurse: 150_000 }, reason: null, actorUid, auditLogId },
        { event: makeEvent(), team, nameTaken: false },
      ),
      'reason-required',
    )
  })

  it('blocks reducing the purse below the amount already spent', () => {
    expectFailure(
      planUpdateTeam(
        { eventId: 'default', teamId: 't1', patch: { startingPurse: 30_000 }, reason: 'Adjustment', actorUid, auditLogId },
        { event: makeEvent(), team, nameTaken: false },
      ),
      'team-purse-too-low',
    )
  })

  it('keeps remaining purse consistent when the purse grows', () => {
    const result = planUpdateTeam(
      { eventId: 'default', teamId: 't1', patch: { startingPurse: 150_000 }, reason: 'Sponsor added funds', actorUid, auditLogId },
      { event: makeEvent(), team, nameTaken: false },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const teamWrite = result.writes.find((w) => w.kind === 'team')
    expect(teamWrite?.data).toMatchObject({ startingPurse: 150_000, remainingPurse: 110_000 })
    const auditWrite = result.writes.find((w) => w.kind === 'auditLog')
    expect(auditWrite?.data).toMatchObject({ action: 'team.starting-purse-changed' })
  })

  it('flags deactivation for session revocation', () => {
    const result = planUpdateTeam(
      { eventId: 'default', teamId: 't1', patch: { active: false }, reason: null, actorUid, auditLogId },
      { event: makeEvent(), team, nameTaken: false },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.sessionsRevoked).toBe(true)
    const teamWrite = result.writes.find((w) => w.kind === 'team')
    expect(teamWrite?.data).toMatchObject({ active: false })
  })

  it('blocks changes on a finalized event', () => {
    expectFailure(
      planUpdateTeam(
        { eventId: 'default', teamId: 't1', patch: { name: 'Renamed' }, reason: null, actorUid, auditLogId },
        { event: makeEvent({ status: 'finalized' }), team, nameTaken: false },
      ),
      'event-finalized',
    )
  })
})

describe('planCreateEvent / planUpdateEvent', () => {
  it('creates the event in setup state and publishes the default config', () => {
    const result = planCreateEvent(
      {
        eventId: 'default',
        name: 'College Auction 2026',
        currencyLabel: '₹',
        defaultStartingPurse: 100_000,
        actorUid,
        auditLogId,
        setAsDefault: true,
      },
      { eventExists: false },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const eventWrite = result.writes.find((w) => w.kind === 'event')
    expect(eventWrite?.data).toMatchObject({ name: 'College Auction 2026', status: 'setup' })
    expect(result.writes.some((w) => w.kind === 'config')).toBe(true)
  })

  it('requires teams and players before activation', () => {
    expectFailure(
      planUpdateEvent(
        { eventId: 'default', patch: { status: 'active' }, reason: null, actorUid, actorRole: 'admin', auditLogId },
        { event: makeEvent({ status: 'setup' }), teamCount: 0, playerCount: 3, consistency: null, isDefaultEvent: false },
      ),
      'event-not-ready',
    )
  })

  it('activates when the event is ready', () => {
    const result = planUpdateEvent(
      { eventId: 'default', patch: { status: 'active' }, reason: null, actorUid, actorRole: 'admin', auditLogId },
      { event: makeEvent({ status: 'setup' }), teamCount: 2, playerCount: 3, consistency: null, isDefaultEvent: false },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.action).toBe('event.activated')
    expect(result.writes.some((w) => w.kind === 'event')).toBe(true)
  })

  it('refuses to finalize when the consistency check fails', () => {
    expectFailure(
      planUpdateEvent(
        { eventId: 'default', patch: { status: 'finalized' }, reason: null, actorUid, actorRole: 'admin', auditLogId },
        {
          event: makeEvent(),
          teamCount: 1,
          playerCount: 1,
          consistency: { ok: false, checkedAt: 0, problems: [{ code: 'x', message: 'broken', targetType: 'team', targetId: 't1' }] },
          isDefaultEvent: false,
        },
      ),
      'event-consistency-failed',
    )
  })

  it('only lets a super admin reopen a finalized event, with a reason', () => {
    expectFailure(
      planUpdateEvent(
        { eventId: 'default', patch: { status: 'active' }, reason: 'Need to fix data', actorUid, actorRole: 'admin', auditLogId },
        { event: makeEvent({ status: 'finalized' }), teamCount: 1, playerCount: 1, consistency: null, isDefaultEvent: false },
      ),
      'not-super-admin',
    )
    expectFailure(
      planUpdateEvent(
        { eventId: 'default', patch: { status: 'active' }, reason: null, actorUid, actorRole: 'superAdmin', auditLogId },
        { event: makeEvent({ status: 'finalized' }), teamCount: 1, playerCount: 1, consistency: null, isDefaultEvent: false },
      ),
      'reason-required',
    )
    const result = planUpdateEvent(
      { eventId: 'default', patch: { status: 'active' }, reason: 'Mistake in the last sale', actorUid, actorRole: 'superAdmin', auditLogId },
      { event: makeEvent({ status: 'finalized' }), teamCount: 1, playerCount: 1, consistency: null, isDefaultEvent: false },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.action).toBe('event.reopened')
  })

  it('validates the roster limit and currency label', () => {
    expectFailure(
      planUpdateEvent(
        { eventId: 'default', patch: { maxRosterSize: 0 }, reason: null, actorUid, actorRole: 'admin', auditLogId },
        { event: makeEvent(), teamCount: 1, playerCount: 1, consistency: null, isDefaultEvent: false },
      ),
      'invalid-argument',
    )
    expectFailure(
      planUpdateEvent(
        { eventId: 'default', patch: { currencyLabel: '   ' }, reason: null, actorUid, actorRole: 'admin', auditLogId },
        { event: makeEvent(), teamCount: 1, playerCount: 1, consistency: null, isDefaultEvent: false },
      ),
      'invalid-argument',
    )
  })

  it('publishes the public config for the default event only', () => {
    const withConfig = planUpdateEvent(
      { eventId: 'default', patch: { name: 'Renamed event' }, reason: null, actorUid, actorRole: 'admin', auditLogId },
      { event: makeEvent(), teamCount: 1, playerCount: 1, consistency: null, isDefaultEvent: true },
    )
    expect(withConfig.ok).toBe(true)
    if (!withConfig.ok) return
    expect(withConfig.writes.some((w) => w.kind === 'config')).toBe(true)

    const withoutConfig = planUpdateEvent(
      { eventId: 'other', patch: { name: 'Renamed event' }, reason: null, actorUid, actorRole: 'admin', auditLogId },
      { event: makeEvent({ id: 'other' }), teamCount: 1, playerCount: 1, consistency: null, isDefaultEvent: false },
    )
    expect(withoutConfig.ok).toBe(true)
    if (!withoutConfig.ok) return
    expect(withoutConfig.writes.some((w) => w.kind === 'config')).toBe(false)
  })

  it('sets the default event explicitly', () => {
    const result = planSetDefaultEvent(
      { eventId: 'default', actorUid, auditLogId },
      { event: makeEvent() },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.writes[0]).toMatchObject({ kind: 'config', id: 'app' })
  })
})

describe('planImportPlayers', () => {
  it('writes every valid row plus one audit entry', () => {
    const result = planImportPlayers(
      {
        eventId: 'default',
        players: [
          { playerId: 'p1', input: { name: 'A', points: 10, basePrice: 100 } },
          { playerId: 'p2', input: { name: 'B', points: 20, basePrice: 200 } },
        ],
        actorUid,
        auditLogId,
      },
      { event: makeEvent(), duplicateExternalReferences: new Set() },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.writes.filter((w) => w.kind === 'player')).toHaveLength(2)
    expect(result.writes.filter((w) => w.kind === 'auditLog')).toHaveLength(1)
  })

  it('rejects the whole batch when a row is invalid', () => {
    expectFailure(
      planImportPlayers(
        {
          eventId: 'default',
          players: [
            { playerId: 'p1', input: { name: 'A', points: 10, basePrice: 100 } },
            { playerId: 'p2', input: { name: 'B', points: -1, basePrice: 200 } },
          ],
          actorUid,
          auditLogId,
        },
        { event: makeEvent(), duplicateExternalReferences: new Set() },
      ),
      'invalid-argument',
    )
  })

  it('rejects duplicate external references inside the batch', () => {
    expectFailure(
      planImportPlayers(
        {
          eventId: 'default',
          players: [
            { playerId: 'p1', input: { name: 'A', points: 10, basePrice: 100, externalReference: 'X1' } },
            { playerId: 'p2', input: { name: 'B', points: 10, basePrice: 100, externalReference: 'x1' } },
          ],
          actorUid,
          auditLogId,
        },
        { event: makeEvent(), duplicateExternalReferences: new Set() },
      ),
      'player-duplicate-external-id',
    )
  })
})

describe('validateEventConsistency (finalisation gate)', () => {
  it('accepts a consistent event', () => {
    const teams = [makeTeam('t1', { startingPurse: 100_000, totalSpent: 10_000, remainingPurse: 90_000, totalPoints: 100, playerCount: 1 })]
    const players = [makePlayer('p1', { status: 'sold', soldToTeamId: 't1', purchaseId: 'purch_1' })]
    const purchases = [makePurchase('purch_1', { playerId: 'p1', teamId: 't1', finalPrice: 10_000, playerPointsSnapshot: 100 })]
    const report = validateEventConsistency({ event: makeEvent(), teams, players, purchases })
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('reports every broken invariant with an actionable message', () => {
    const teams = [makeTeam('t1', { startingPurse: 100_000, totalSpent: 10_000, remainingPurse: 100_000, totalPoints: 0, playerCount: 0 })]
    const players = [
      makePlayer('p1', { status: 'sold', soldToTeamId: null, purchaseId: null }),
      makePlayer('p2', { status: 'available', soldToTeamId: 't9', purchaseId: 'purch_9' }),
    ]
    const purchases = [
      makePurchase('purch_1', { playerId: 'p9', teamId: 't1' }),
      makePurchase('purch_2', { playerId: 'p2', teamId: 't1', status: 'reversed' }),
    ]
    const report = validateEventConsistency({ event: makeEvent(), teams, players, purchases })
    expect(report.ok).toBe(false)
    const codes = report.problems.map((p) => p.code)
    expect(codes).toContain('team-totals-mismatch')
    expect(codes).toContain('player-sold-without-purchase')
    expect(codes).toContain('player-stale-assignment')
    expect(codes).toContain('reversal-missing-audit')
    expect(codes).toContain('purchase-orphan-player')
  })
})
