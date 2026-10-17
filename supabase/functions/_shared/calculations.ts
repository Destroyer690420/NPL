import { addInts, subtractInts } from './money'
import type { EventDoc, PlayerDoc, PurchaseDoc, TeamDoc, TeamSummary } from './types'

/**
 * Derived totals. These pure helpers are the single source of truth for purse,
 * spend, points and roster maths; the Cloud Functions store the same values as
 * denormalised fields inside the purchase transaction and the test suite
 * re-computes them to prove they reconcile with the purchase records.
 */

export interface PurchaseLite {
  finalPrice: number
  points: number
}

export function computeTeamSummary(
  startingPurse: number,
  activePurchases: readonly PurchaseLite[],
): TeamSummary {
  let totalSpent = 0
  let totalPoints = 0
  let playerCount = 0
  for (const purchase of activePurchases) {
    totalSpent = addInts(totalSpent, purchase.finalPrice)
    totalPoints = addInts(totalPoints, purchase.points)
    playerCount += 1
  }
  return {
    startingPurse,
    totalSpent,
    remainingPurse: subtractInts(startingPurse, totalSpent),
    totalPoints,
    playerCount,
  }
}

/** Summary from the denormalised team document fields. */
export function summaryFromTeam(team: Pick<TeamDoc, 'startingPurse' | 'totalSpent' | 'remainingPurse' | 'totalPoints' | 'playerCount'>): TeamSummary {
  return {
    startingPurse: team.startingPurse,
    totalSpent: team.totalSpent,
    remainingPurse: team.remainingPurse,
    totalPoints: team.totalPoints,
    playerCount: team.playerCount,
  }
}

/** What the team summary would become if this purchase succeeded. */
export function projectPurchase(
  team: Pick<TeamDoc, 'startingPurse' | 'totalSpent' | 'remainingPurse' | 'totalPoints' | 'playerCount'>,
  finalPrice: number,
  points: number,
): TeamSummary {
  const totalSpent = addInts(team.totalSpent, finalPrice)
  return {
    startingPurse: team.startingPurse,
    totalSpent,
    remainingPurse: subtractInts(team.startingPurse, totalSpent),
    totalPoints: addInts(team.totalPoints, points),
    playerCount: team.playerCount + 1,
  }
}

export function isTeamConsistent(team: TeamDoc): boolean {
  return (
    Number.isSafeInteger(team.startingPurse) &&
    Number.isSafeInteger(team.totalSpent) &&
    Number.isSafeInteger(team.remainingPurse) &&
    Number.isSafeInteger(team.totalPoints) &&
    Number.isSafeInteger(team.playerCount) &&
    team.remainingPurse === team.startingPurse - team.totalSpent &&
    team.totalSpent >= 0 &&
    team.remainingPurse >= 0 &&
    team.totalPoints >= 0 &&
    team.playerCount >= 0
  )
}

export interface EventTotals {
  teamCount: number
  activeTeamCount: number
  playerCount: number
  availableCount: number
  soldCount: number
  withdrawnCount: number
  confirmedPurchaseCount: number
  reversedPurchaseCount: number
  totalSpent: number
  totalPoints: number
}

export function computeEventTotals(
  teams: readonly TeamDoc[],
  players: readonly PlayerDoc[],
  purchases: readonly PurchaseDoc[],
): EventTotals {
  const confirmed = purchases.filter((p) => p.status === 'confirmed')
  return {
    teamCount: teams.length,
    activeTeamCount: teams.filter((t) => t.active).length,
    playerCount: players.length,
    availableCount: players.filter((p) => p.status === 'available').length,
    soldCount: players.filter((p) => p.status === 'sold').length,
    withdrawnCount: players.filter((p) => p.status === 'withdrawn').length,
    confirmedPurchaseCount: confirmed.length,
    reversedPurchaseCount: purchases.length - confirmed.length,
    totalSpent: confirmed.reduce((sum, p) => addInts(sum, p.finalPrice), 0),
    totalPoints: confirmed.reduce((sum, p) => addInts(sum, p.playerPointsSnapshot), 0),
  }
}

export interface ConsistencyProblem {
  code: string
  message: string
  targetType: 'team' | 'player' | 'purchase' | 'event'
  targetId: string
  targetName?: string
}

export interface ConsistencyReport {
  ok: boolean
  problems: ConsistencyProblem[]
  checkedAt: number
}

export interface ConsistencyInput {
  event: EventDoc | null
  teams: readonly TeamDoc[]
  players: readonly PlayerDoc[]
  purchases: readonly PurchaseDoc[]
  now?: number
}

/**
 * Full reconciliation between purchase records and the denormalised
 * player/team state. Used before finalisation and by the admin consistency
 * check. Implements the invariants from docs/DATA_MODEL.md.
 */
export function validateEventConsistency(input: ConsistencyInput): ConsistencyReport {
  const problems: ConsistencyProblem[] = []
  const { event, teams, players, purchases } = input

  if (!event) {
    problems.push({
      code: 'event-missing',
      message: 'The event document does not exist.',
      targetType: 'event',
      targetId: '-',
    })
    return { ok: false, problems, checkedAt: input.now ?? Date.now() }
  }

  const teamsById = new Map(teams.map((t) => [t.id, t]))
  const playersById = new Map(players.map((p) => [p.id, p]))
  const confirmedByPlayer = new Map<string, PurchaseDoc[]>()

  for (const purchase of purchases) {
    const player = playersById.get(purchase.playerId)
    const team = teamsById.get(purchase.teamId)

    if (!player) {
      problems.push({
        code: 'purchase-orphan-player',
        message: `Purchase ${purchase.id} references a missing player (${purchase.playerId}).`,
        targetType: 'purchase',
        targetId: purchase.id,
      })
    }
    if (!team) {
      problems.push({
        code: 'purchase-orphan-team',
        message: `Purchase ${purchase.id} references a missing team (${purchase.teamId}).`,
        targetType: 'purchase',
        targetId: purchase.id,
      })
    }

    if (purchase.status === 'confirmed') {
      const list = confirmedByPlayer.get(purchase.playerId) ?? []
      list.push(purchase)
      confirmedByPlayer.set(purchase.playerId, list)
    } else if (!purchase.reversedAt || !purchase.reversalReason) {
      problems.push({
        code: 'reversal-missing-audit',
        message: `Reversed purchase ${purchase.id} is missing its reversal timestamp or reason.`,
        targetType: 'purchase',
        targetId: purchase.id,
      })
    }
  }

  for (const [playerId, list] of confirmedByPlayer) {
    if (list.length > 1) {
      problems.push({
        code: 'player-multiple-purchases',
        message: `Player ${playersById.get(playerId)?.name ?? playerId} has ${list.length} confirmed purchases.`,
        targetType: 'player',
        targetId: playerId,
        targetName: playersById.get(playerId)?.name,
      })
    }
  }

  for (const player of players) {
    const list = confirmedByPlayer.get(player.id) ?? []
    if (player.status === 'sold') {
      if (list.length !== 1) {
        problems.push({
          code: 'player-sold-without-purchase',
          message: `Player ${player.name} is marked sold but has ${list.length} confirmed purchases.`,
          targetType: 'player',
          targetId: player.id,
          targetName: player.name,
        })
      } else {
        const purchase = list[0]
        if (player.purchaseId !== purchase.id || player.soldToTeamId !== purchase.teamId) {
          problems.push({
            code: 'player-purchase-mismatch',
            message: `Player ${player.name} points at a different purchase/team than the recorded sale.`,
            targetType: 'player',
            targetId: player.id,
            targetName: player.name,
          })
        }
      }
    } else if (list.length > 0) {
      problems.push({
        code: 'player-available-with-purchase',
        message: `Player ${player.name} is ${player.status} but still has a confirmed purchase.`,
        targetType: 'player',
        targetId: player.id,
        targetName: player.name,
      })
    } else if (player.purchaseId !== null || player.soldToTeamId !== null) {
      problems.push({
        code: 'player-stale-assignment',
        message: `Player ${player.name} has no confirmed purchase but is still assigned to a team.`,
        targetType: 'player',
        targetId: player.id,
        targetName: player.name,
      })
    }
  }

  for (const team of teams) {
    const teamPurchases = purchases.filter((p) => p.teamId === team.id && p.status === 'confirmed')
    const expected = computeTeamSummary(team.startingPurse, [
      ...teamPurchases.map((p) => ({ finalPrice: p.finalPrice, points: p.playerPointsSnapshot })),
    ])

    const mismatches: string[] = []
    if (team.totalSpent !== expected.totalSpent) {
      mismatches.push(`totalSpent stored ${team.totalSpent}, expected ${expected.totalSpent}`)
    }
    if (team.remainingPurse !== expected.remainingPurse) {
      mismatches.push(`remainingPurse stored ${team.remainingPurse}, expected ${expected.remainingPurse}`)
    }
    if (team.totalPoints !== expected.totalPoints) {
      mismatches.push(`totalPoints stored ${team.totalPoints}, expected ${expected.totalPoints}`)
    }
    if (team.playerCount !== expected.playerCount) {
      mismatches.push(`playerCount stored ${team.playerCount}, expected ${expected.playerCount}`)
    }
    if (team.remainingPurse < 0) {
      mismatches.push(`remainingPurse is negative (${team.remainingPurse})`)
    }
    if (event.maxRosterSize !== null && team.playerCount > event.maxRosterSize) {
      mismatches.push(`playerCount ${team.playerCount} exceeds max roster size ${event.maxRosterSize}`)
    }

    if (mismatches.length > 0) {
      problems.push({
        code: 'team-totals-mismatch',
        message: `Team ${team.name}: ${mismatches.join('; ')}.`,
        targetType: 'team',
        targetId: team.id,
        targetName: team.name,
      })
    }
  }

  return { ok: problems.length === 0, problems, checkedAt: input.now ?? Date.now() }
}
