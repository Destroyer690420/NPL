import {
  computeTeamSummary,
  isTeamConsistent,
  summaryFromTeam,
  type PurchaseLite,
} from './calculations.ts'
import type { AppErrorCode } from './errors.ts'
import { addInts, addPoints, isValidAmount, subtractInts, subtractPoints } from './money.ts'
import { SERVER_TIMESTAMP, type PlannedWrite, type PlanResult, type ServerTimestampMarker } from './plan.ts'
import { cleanOptionalText, collapseWhitespace, isValidRequestId } from './text.ts'
import { MAX_REASON_LENGTH, MIN_REASON_LENGTH } from './constants.ts'
import type { EventDoc, PlayerDoc, PurchaseDoc, TeamDoc, TeamSummary } from './types.ts'

/**
 * Pure purchase planning.
 *
 * `planPurchase` performs every domain validation and returns the exact set of
 * documents that must be written. The Cloud Function executes the read + this
 * plan + the writes inside a single Firestore transaction, so a failure can
 * never leave partial state behind, and a retry with the same `requestId`
 * can never charge a team twice.
 */

export interface PurchaseCommand {
  eventId: string
  playerId: string
  teamId: string
  finalPrice: number
  /** Idempotency key; also used as the purchase document id. */
  requestId: string
  actorUid: string
}

export interface PurchaseState {
  event: EventDoc | null
  player: PlayerDoc | null
  team: TeamDoc | null
  /** Purchase whose id === command.requestId, if this submission was already processed. */
  existingPurchaseForRequest: PurchaseDoc | null
  auditLogId: string
}

export interface PurchaseOutcome {
  purchaseId: string
  playerId: string
  playerName: string
  playerPoints: number
  teamId: string
  teamName: string
  finalPrice: number
  teamSummary: TeamSummary
  idempotentReplay: boolean
}

function fail(
  code: AppErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): PlanResult<never> {
  return { ok: false, code, message, details }
}

export function planPurchase(
  command: PurchaseCommand,
  state: PurchaseState,
): PlanResult<PurchaseOutcome> {
  if (!isValidRequestId(command.requestId)) {
    return fail('request-id-invalid')
  }
  if (!isValidAmount(command.finalPrice, false)) {
    return fail('invalid-price', undefined, { finalPrice: command.finalPrice })
  }

  // --- idempotent replay -----------------------------------------------------
  const existing = state.existingPurchaseForRequest
  if (existing) {
    const sameSubmission =
      existing.playerId === command.playerId &&
      existing.teamId === command.teamId &&
      existing.finalPrice === command.finalPrice
    if (!sameSubmission) {
      return fail('request-conflict', undefined, { purchaseId: existing.id })
    }
    if (existing.status === 'reversed') {
      return fail('purchase-already-reversed', undefined, { purchaseId: existing.id })
    }
    if (!state.team) return fail('team-not-found')
    return {
      ok: true,
      writes: [],
      result: {
        purchaseId: existing.id,
        playerId: existing.playerId,
        playerName: existing.playerNameSnapshot,
        playerPoints: existing.playerPointsSnapshot,
        teamId: existing.teamId,
        teamName: existing.teamNameSnapshot,
        finalPrice: existing.finalPrice,
        teamSummary: summaryFromTeam(state.team),
        idempotentReplay: true,
      },
    }
  }

  // --- event -----------------------------------------------------------------
  if (!state.event) return fail('event-not-found')
  if (state.event.status === 'finalized') return fail('event-finalized')
  if (state.event.status === 'setup') return fail('event-not-started')
  if (!state.event.purchasesEnabled) return fail('purchases-disabled')

  // --- player ----------------------------------------------------------------
  const player = state.player
  if (!player) return fail('player-not-found')
  if (player.status === 'sold') return fail('player-already-sold', undefined, { playerId: player.id })
  if (player.status === 'withdrawn') return fail('player-withdrawn', undefined, { playerId: player.id })
  if (player.purchaseId !== null || player.soldToTeamId !== null) {
    return fail('player-status-conflict', undefined, { playerId: player.id })
  }
  if (!Number.isSafeInteger(player.points) || player.points < 0) {
    return fail('player-invalid', 'Player points are invalid.', { playerId: player.id })
  }

  // --- team ------------------------------------------------------------------
  const team = state.team
  if (!team) return fail('team-not-found')
  if (!team.active) return fail('team-inactive')
  if (!isTeamConsistent(team)) {
    return fail('team-state-inconsistent', undefined, { teamId: team.id })
  }
  if (state.event.maxRosterSize !== null && team.playerCount >= state.event.maxRosterSize) {
    return fail('team-roster-full', undefined, { teamId: team.id })
  }
  if (command.finalPrice > team.remainingPurse) {
    return fail('team-insufficient-purse', undefined, {
      teamId: team.id,
      remainingPurse: team.remainingPurse,
      finalPrice: command.finalPrice,
    })
  }

  // --- plan ------------------------------------------------------------------
  const now: ServerTimestampMarker = SERVER_TIMESTAMP
  const purchase: Omit<PurchaseDoc, 'id' | 'createdAt'> & { createdAt: ServerTimestampMarker } = {
    playerId: player.id,
    playerNameSnapshot: player.name,
    playerPointsSnapshot: player.points,
    playerPhotoUrlSnapshot: player.photoUrl ?? null,
    teamId: team.id,
    teamNameSnapshot: team.name,
    finalPrice: command.finalPrice,
    status: 'confirmed',
    createdBy: command.actorUid,
    requestId: command.requestId,
    createdAt: now,
    reversedAt: null,
    reversedBy: null,
    reversalReason: null,
  }

  const totalSpent = addInts(team.totalSpent, command.finalPrice)
  const remainingPurse = subtractInts(team.startingPurse, totalSpent)
  const totalPoints = addPoints(team.totalPoints, player.points)
  const playerCount = team.playerCount + 1

  const writes: PlannedWrite[] = [
    {
      kind: 'player',
      id: player.id,
      op: 'update',
      data: {
        status: 'sold',
        soldToTeamId: team.id,
        purchaseId: command.requestId,
        updatedAt: now,
      },
    },
    {
      kind: 'team',
      id: team.id,
      op: 'update',
      data: {
        remainingPurse,
        totalSpent,
        totalPoints,
        playerCount,
        updatedAt: now,
      },
    },
    {
      kind: 'purchase',
      id: command.requestId,
      op: 'set',
      data: purchase as unknown as Record<string, unknown>,
    },
    {
      kind: 'auditLog',
      id: state.auditLogId,
      op: 'set',
      data: {
        eventId: command.eventId,
        actorUid: command.actorUid,
        actorRole: 'admin',
        action: 'purchase.recorded',
        targetType: 'purchase',
        targetId: command.requestId,
        reason: null,
        metadata: {
          playerId: player.id,
          playerName: player.name,
          teamId: team.id,
          teamName: team.name,
          finalPrice: command.finalPrice,
          points: player.points,
        },
        createdAt: now,
      },
    },
  ]

  return {
    ok: true,
    writes,
    result: {
      purchaseId: command.requestId,
      playerId: player.id,
      playerName: player.name,
      playerPoints: player.points,
      teamId: team.id,
      teamName: team.name,
      finalPrice: command.finalPrice,
      teamSummary: {
        startingPurse: team.startingPurse,
        totalSpent,
        remainingPurse,
        totalPoints,
        playerCount,
      },
      idempotentReplay: false,
    },
  }
}

export interface ReversalCommand {
  eventId: string
  purchaseId: string
  reason: string
  actorUid: string
}

export interface ReversalState {
  event: EventDoc | null
  purchase: PurchaseDoc | null
  player: PlayerDoc | null
  team: TeamDoc | null
  auditLogId: string
}

export interface ReversalOutcome {
  purchaseId: string
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  refundedPrice: number
  removedPoints: number
  teamSummary: TeamSummary
}

export function cleanReason(raw: unknown): string {
  return collapseWhitespace(typeof raw === 'string' ? raw : '').slice(0, MAX_REASON_LENGTH)
}

export function isReasonValid(raw: unknown): boolean {
  return cleanReason(raw).length >= MIN_REASON_LENGTH
}

export function planReversal(
  command: ReversalCommand,
  state: ReversalState,
): PlanResult<ReversalOutcome> {
  if (!state.event) return fail('event-not-found')
  if (state.event.status === 'finalized') return fail('event-finalized')

  const reason = cleanReason(command.reason)
  if (reason.length < MIN_REASON_LENGTH) return fail('reason-required')

  const purchase = state.purchase
  if (!purchase) return fail('purchase-not-found')
  if (purchase.status === 'reversed') return fail('purchase-already-reversed')
  if (!isValidAmount(purchase.finalPrice, false)) {
    return fail('invalid-price', 'The stored purchase price is not a valid amount.')
  }

  const team = state.team
  if (!team) return fail('team-not-found')

  const player = state.player
  if (!player) return fail('purchase-reversal-conflict', 'The purchased player no longer exists.')
  if (
    player.status !== 'sold' ||
    player.purchaseId !== purchase.id ||
    player.soldToTeamId !== purchase.teamId
  ) {
    return fail(
      'purchase-reversal-conflict',
      'This player record changed after the sale and cannot be reversed automatically.',
    )
  }

  if (
    team.totalSpent < purchase.finalPrice ||
    team.totalPoints < purchase.playerPointsSnapshot ||
    team.playerCount < 1
  ) {
    return fail('team-state-inconsistent', 'Team totals are lower than the purchase being reversed.')
  }

  const now = SERVER_TIMESTAMP
  const totalSpent = subtractInts(team.totalSpent, purchase.finalPrice)
  const remainingPurse = addInts(team.remainingPurse, purchase.finalPrice)
  const totalPoints = subtractPoints(team.totalPoints, purchase.playerPointsSnapshot)
  const playerCount = team.playerCount - 1

  const writes: PlannedWrite[] = [
    {
      kind: 'team',
      id: team.id,
      op: 'update',
      data: { totalSpent, remainingPurse, totalPoints, playerCount, updatedAt: now },
    },
    {
      kind: 'player',
      id: player.id,
      op: 'update',
      data: { status: 'available', soldToTeamId: null, purchaseId: null, updatedAt: now },
    },
    {
      kind: 'purchase',
      id: purchase.id,
      op: 'update',
      data: {
        status: 'reversed',
        reversedAt: now,
        reversedBy: command.actorUid,
        reversalReason: reason,
      },
    },
    {
      kind: 'auditLog',
      id: state.auditLogId,
      op: 'set',
      data: {
        eventId: command.eventId,
        actorUid: command.actorUid,
        actorRole: 'admin',
        action: 'purchase.reversed',
        targetType: 'purchase',
        targetId: purchase.id,
        reason,
        metadata: {
          playerId: player.id,
          playerName: purchase.playerNameSnapshot,
          teamId: team.id,
          teamName: purchase.teamNameSnapshot,
          finalPrice: purchase.finalPrice,
          points: purchase.playerPointsSnapshot,
        },
        createdAt: now,
      },
    },
  ]

  return {
    ok: true,
    writes,
    result: {
      purchaseId: purchase.id,
      playerId: player.id,
      playerName: purchase.playerNameSnapshot,
      teamId: team.id,
      teamName: purchase.teamNameSnapshot,
      refundedPrice: purchase.finalPrice,
      removedPoints: purchase.playerPointsSnapshot,
      teamSummary: {
        startingPurse: team.startingPurse,
        totalSpent,
        remainingPurse,
        totalPoints,
        playerCount,
      },
    },
  }
}

/** Convenience helper used by the client for the pre-confirmation summary. */
export function projectedSummaryFromLite(
  startingPurse: number,
  purchases: PurchaseLite[],
): TeamSummary {
  return computeTeamSummary(startingPurse, purchases)
}

export { cleanOptionalText }
