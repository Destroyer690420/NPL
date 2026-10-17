// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planPurchase, planReversal, type PurchaseCommand, type PurchaseState } from './purchases.ts'
import { makeEvent, makePlayer, makePurchase, makeTeam } from './fixtures.ts'
import type { PlanResult } from './plan.ts'

const REQUEST_ID = 'req_12345678-abcd'

function command(overrides: Partial<PurchaseCommand> = {}): PurchaseCommand {
  return {
    eventId: 'default',
    playerId: 'p1',
    teamId: 't1',
    finalPrice: 10_000,
    requestId: REQUEST_ID,
    actorUid: 'admin-1',
    ...overrides,
  }
}

function baseState(overrides: Partial<PurchaseState> = {}): PurchaseState {
  return {
    event: makeEvent(),
    player: makePlayer('p1', { points: 120 }),
    team: makeTeam('t1', { startingPurse: 100_000 }),
    existingPurchaseForRequest: null,
    auditLogId: 'audit-1',
    ...overrides,
  }
}

function expectFailure(result: PlanResult<unknown>, code: string) {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.code).toBe(code)
}

describe('planPurchase - success path', () => {
  it('produces exactly the player, team, purchase and audit writes', () => {
    const result = planPurchase(command(), baseState())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.writes).toHaveLength(4)
    const byKind = Object.fromEntries(result.writes.map((w) => [w.kind, w]))

    expect(byKind.player).toMatchObject({
      id: 'p1',
      op: 'update',
      data: { status: 'sold', soldToTeamId: 't1', purchaseId: REQUEST_ID },
    })
    expect(byKind.team).toMatchObject({
      id: 't1',
      op: 'update',
      data: { remainingPurse: 90_000, totalSpent: 10_000, totalPoints: 120, playerCount: 1 },
    })
    expect(byKind.purchase).toMatchObject({
      id: REQUEST_ID,
      op: 'set',
      data: {
        playerId: 'p1',
        teamId: 't1',
        finalPrice: 10_000,
        status: 'confirmed',
        playerPointsSnapshot: 120,
        createdBy: 'admin-1',
        requestId: REQUEST_ID,
      },
    })
    expect(byKind.auditLog).toMatchObject({ id: 'audit-1', op: 'set' })

    expect(result.result).toMatchObject({
      purchaseId: REQUEST_ID,
      finalPrice: 10_000,
      idempotentReplay: false,
      teamSummary: {
        startingPurse: 100_000,
        totalSpent: 10_000,
        remainingPurse: 90_000,
        totalPoints: 120,
        playerCount: 1,
      },
    })
  })

  it('keeps the invariant startingPurse - totalSpent = remainingPurse for existing spend', () => {
    const result = planPurchase(
      command({ finalPrice: 25_000 }),
      baseState({
        team: makeTeam('t1', { startingPurse: 100_000, totalSpent: 40_000, playerCount: 2, totalPoints: 300 }),
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const teamWrite = result.writes.find((w) => w.kind === 'team')
    expect(teamWrite?.data).toMatchObject({
      totalSpent: 65_000,
      remainingPurse: 35_000,
      totalPoints: 420,
      playerCount: 3,
    })
  })
})

describe('planPurchase - rejections never produce writes', () => {
  it.each<[string, PurchaseState, string, Partial<PurchaseCommand>?]>([
    ['missing event', baseState({ event: null }), 'event-not-found'],
    ['event in setup', baseState({ event: makeEvent({ status: 'setup' }) }), 'event-not-started'],
    ['finalized event', baseState({ event: makeEvent({ status: 'finalized' }) }), 'event-finalized'],
    ['purchases disabled', baseState({ event: makeEvent({ purchasesEnabled: false }) }), 'purchases-disabled'],
    ['missing player', baseState({ player: null }), 'player-not-found'],
    ['sold player', baseState({ player: makePlayer('p1', { status: 'sold', soldToTeamId: 't2', purchaseId: 'p' }) }), 'player-already-sold'],
    ['withdrawn player', baseState({ player: makePlayer('p1', { status: 'withdrawn' }) }), 'player-withdrawn'],
    ['stale assignment', baseState({ player: makePlayer('p1', { soldToTeamId: 't2' }) }), 'player-status-conflict'],
    ['missing team', baseState({ team: null }), 'team-not-found'],
    ['inactive team', baseState({ team: makeTeam('t1', { active: false }) }), 'team-inactive'],
    ['insufficient purse', baseState({ team: makeTeam('t1', { startingPurse: 9_999 }) }), 'team-insufficient-purse'],
    [
      'inconsistent team totals',
      baseState({ team: makeTeam('t1', { startingPurse: 100_000, totalSpent: 5_000, remainingPurse: 90_000 }) }),
      'team-state-inconsistent',
    ],
    ['invalid request id', baseState(), 'request-id-invalid', { requestId: 'bad' }],
    ['zero price', baseState(), 'invalid-price', { finalPrice: 0 }],
    ['negative price', baseState(), 'invalid-price', { finalPrice: -5 }],
    ['fractional price', baseState(), 'invalid-price', { finalPrice: 1000.5 }],
  ])('rejects %s', (_label, state, code, overrides) => {
    const result = planPurchase(command(overrides), state)
    expectFailure(result, code)
  })

  it('rejects when the roster limit is reached', () => {
    const result = planPurchase(
      command(),
      baseState({
        event: makeEvent({ maxRosterSize: 2 }),
        team: makeTeam('t1', { playerCount: 2, totalSpent: 0 }),
      }),
    )
    expectFailure(result, 'team-roster-full')
  })

  it('uses integer arithmetic only', () => {
    const result = planPurchase(
      command({ finalPrice: 999_999_999 }),
      baseState({ team: makeTeam('t1', { startingPurse: 999_999_999 }) }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.teamSummary.remainingPurse).toBe(0)
    expect(Number.isSafeInteger(result.result.teamSummary.remainingPurse)).toBe(true)
  })
})

describe('planPurchase - concurrency and retries', () => {
  it('is idempotent for a repeated request id', () => {
    const existing = makePurchase(REQUEST_ID, { playerId: 'p1', teamId: 't1', finalPrice: 10_000 })
    const replayState = baseState({
      player: makePlayer('p1', { status: 'sold', soldToTeamId: 't1', purchaseId: REQUEST_ID }),
      team: makeTeam('t1', { startingPurse: 100_000, totalSpent: 10_000, remainingPurse: 90_000, playerCount: 1, totalPoints: 120 }),
      existingPurchaseForRequest: existing,
    })

    const replay = planPurchase(command(), replayState)
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.writes).toHaveLength(0)
    expect(replay.result.idempotentReplay).toBe(true)

    // A second, concurrent submission with a different request id is rejected
    // because the player is already sold (no purchase doc exists for that id yet).
    const duplicate = planPurchase(
      command({ requestId: 'req_other_987654' }),
      { ...replayState, existingPurchaseForRequest: null },
    )
    expectFailure(duplicate, 'player-already-sold')
  })

  it('rejects a reused request id with a different payload', () => {
    const existing = makePurchase(REQUEST_ID, { playerId: 'p1', teamId: 't1', finalPrice: 10_000 })
    const result = planPurchase(
      command({ finalPrice: 12_000 }),
      baseState({ existingPurchaseForRequest: existing }),
    )
    expectFailure(result, 'request-conflict')
  })

  it('rejects a replay of a reversed purchase', () => {
    const existing = makePurchase(REQUEST_ID, { status: 'reversed', reversalReason: 'mistake' })
    const result = planPurchase(command(), baseState({ existingPurchaseForRequest: existing }))
    expectFailure(result, 'purchase-already-reversed')
  })
})

describe('planReversal', () => {
  const purchase = makePurchase('purch_1', {
    playerId: 'p1',
    teamId: 't1',
    finalPrice: 10_000,
    playerPointsSnapshot: 120,
  })

  function reversalState(overrides: Partial<Parameters<typeof planReversal>[1]> = {}) {
    return {
      event: makeEvent(),
      purchase,
      player: makePlayer('p1', { status: 'sold', soldToTeamId: 't1', purchaseId: 'purch_1' }),
      team: makeTeam('t1', {
        startingPurse: 100_000,
        totalSpent: 10_000,
        remainingPurse: 90_000,
        totalPoints: 120,
        playerCount: 1,
      }),
      auditLogId: 'audit-2',
      ...overrides,
    }
  }

  it('restores purse, points and roster count atomically', () => {
    const result = planReversal(
      { eventId: 'default', purchaseId: 'purch_1', reason: 'Wrong team selected', actorUid: 'admin-1' },
      reversalState(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const teamWrite = result.writes.find((w) => w.kind === 'team')
    expect(teamWrite?.data).toMatchObject({
      totalSpent: 0,
      remainingPurse: 100_000,
      totalPoints: 0,
      playerCount: 0,
    })
    const playerWrite = result.writes.find((w) => w.kind === 'player')
    expect(playerWrite?.data).toMatchObject({ status: 'available', soldToTeamId: null, purchaseId: null })
    const purchaseWrite = result.writes.find((w) => w.kind === 'purchase')
    expect(purchaseWrite?.data).toMatchObject({
      status: 'reversed',
      reversedBy: 'admin-1',
      reversalReason: 'Wrong team selected',
    })
    expect(result.writes.some((w) => w.kind === 'auditLog')).toBe(true)
  })

  it('credits the exact price even when the team already spent it', () => {
    const result = planReversal(
      { eventId: 'default', purchaseId: 'purch_1', reason: 'Wrong team', actorUid: 'admin-1' },
      reversalState({
        team: makeTeam('t1', {
          startingPurse: 100_000,
          totalSpent: 99_000,
          remainingPurse: 1_000,
          totalPoints: 500,
          playerCount: 4,
        }),
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.teamSummary).toMatchObject({
      totalSpent: 89_000,
      remainingPurse: 11_000,
      totalPoints: 380,
      playerCount: 3,
    })
  })

  it.each<[string, Parameters<typeof planReversal>[1], string]>([
    ['already reversed purchase', reversalState({ purchase: makePurchase('purch_1', { status: 'reversed' }) }), 'purchase-already-reversed'],
    ['missing purchase', reversalState({ purchase: null }), 'purchase-not-found'],
    ['finalized event', reversalState({ event: makeEvent({ status: 'finalized' }) }), 'event-finalized'],
    ['missing team', reversalState({ team: null }), 'team-not-found'],
    [
      'player reassigned elsewhere',
      reversalState({
        player: makePlayer('p1', { status: 'sold', soldToTeamId: 't2', purchaseId: 'purch_2' }),
      }),
      'purchase-reversal-conflict',
    ],
    ['player already free', reversalState({ player: makePlayer('p1') }), 'purchase-reversal-conflict'],
    ['missing player', reversalState({ player: null }), 'purchase-reversal-conflict'],
  ])('rejects %s', (_label, state, code) => {
    const result = planReversal(
      { eventId: 'default', purchaseId: 'purch_1', reason: 'Reason text', actorUid: 'admin-1' },
      state,
    )
    expectFailure(result, code)
  })

  it('requires a real reason', () => {
    const result = planReversal(
      { eventId: 'default', purchaseId: 'purch_1', reason: '  ', actorUid: 'admin-1' },
      reversalState(),
    )
    expectFailure(result, 'reason-required')
  })

  it('refuses to make totals negative when stored data is already broken', () => {
    const result = planReversal(
      { eventId: 'default', purchaseId: 'purch_1', reason: 'Broken state', actorUid: 'admin-1' },
      reversalState({
        team: makeTeam('t1', {
          startingPurse: 100_000,
          totalSpent: 0,
          remainingPurse: 100_000,
          totalPoints: 0,
          playerCount: 0,
        }),
      }),
    )
    expectFailure(result, 'team-state-inconsistent')
  })
})
