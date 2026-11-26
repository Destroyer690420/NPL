import {
  createEventSchema,
  eventIdSchema,
  markPlayerUnsoldSchema,
  setAuctionBreakSchema,
  setAuctionCountdownSchema,
  setSpotlightPlayerSchema,
  updateEventSchema,
} from '../../_shared/schemas.ts'
import {
  DEFAULT_EVENT_ID,
  ROUND_1_TARGET_TEAMS,
  ROUND_2_STARTING_PURSE,
  ROUND_2_TARGET_TEAMS,
} from '../../_shared/constants.ts'
import { computeEventTotals, validateEventConsistency } from '../../_shared/calculations.ts'
import { toEventDoc, toPlayerDoc, toTeamDoc } from '../../_shared/convert.ts'
import {
  buildRoundPool,
  buildRoundSnapshot,
  findNextUnprocessedIndex,
  isRoundPoolComplete,
} from '../../_shared/rounds.ts'
import {
  planCreateEvent,
  planEventConsistencyCheck,
  planSetDefaultEvent,
  planUpdateEvent,
} from '../../_shared/mutations.ts'
import { adminCallable } from '../lib/callables.ts'
import { fail, unwrapPlan } from '../lib/errors.ts'
import { auditRef, configRef, db } from '../lib/refs.ts'
import { supabase } from '../lib/supabase.ts'
import type {
  AuctionBreak,
  AuctionCountdown,
  EventDoc,
  PlayerDoc,
  RoundPhase,
  RoundSnapshot,
  SpotlightPlayer,
  TeamDoc,
} from '../../_shared/types.ts'
import {
  applyWrites,
  readEventTx,
  readPlayersTx,
  readPurchasesTx,
  readTeamsTx,
} from '../lib/store.ts'

/** Creates an event and (when it is the first one) makes it the default event. */
export const createEvent = adminCallable({
  schema: createEventSchema,
  handler: async (input, context) => {
    const eventId = input.eventId ?? DEFAULT_EVENT_ID
    const auditLogId = auditRef(eventId).id

    return db().runTransaction(async (tx) => {
      const existing = await readEventTx(tx, eventId)
      const configSnapshot = await tx.get(configRef())
      const currentDefault = (configSnapshot.data()?.defaultEventId as string | null | undefined) ?? null
      const setAsDefault = currentDefault === null || currentDefault === eventId

      const plan = planCreateEvent(
        {
          eventId,
          name: input.name,
          currencyLabel: input.currencyLabel,
          defaultStartingPurse: input.defaultStartingPurse,
          actorUid: context.uid,
          auditLogId,
          setAsDefault,
        },
        { eventExists: existing !== null },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, eventId, writes, { actorEmail: context.email })
      return { ...result, setAsDefault }
    })
  },
})

/**
 * Updates event settings and lifecycle state.
 * Finalisation runs the full consistency check inside the same transaction.
 */
export const updateEvent = adminCallable({
  schema: updateEventSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id

    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)

      let teamCount = 0
      let playerCount = 0
      let consistency: ReturnType<typeof validateEventConsistency> | null = null

      const needsFullRead = input.status !== undefined
      if (needsFullRead && event) {
        const teams = await readTeamsTx(tx, input.eventId)
        teamCount = teams.length
        if (input.status === 'active' || input.status === 'finalized') {
          const players = await readPlayersTx(tx, input.eventId)
          playerCount = players.length
          if (input.status === 'finalized') {
            const purchases = await readPurchasesTx(tx, input.eventId)
            consistency = validateEventConsistency({ event, teams, players, purchases })
          }
        }
      }

      const configSnapshot = await tx.get(configRef())
      const isDefaultEvent = configSnapshot.data()?.defaultEventId === input.eventId

      const plan = planUpdateEvent(
        {
          eventId: input.eventId,
          patch: {
            name: input.name,
            currencyLabel: input.currencyLabel,
            defaultStartingPurse: input.defaultStartingPurse,
            maxRosterSize: input.maxRosterSize,
            purchasesEnabled: input.purchasesEnabled,
            status: input.status,
          },
          reason: input.reason ?? null,
          actorUid: context.uid,
          actorRole: context.role,
          auditLogId,
        },
        { event, teamCount, playerCount, consistency, isDefaultEvent },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return result
    })
  },
})

/** Reconciles stored team totals against the purchase records. */
export const checkEventConsistency = adminCallable({
  schema: eventIdSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id

    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const teams = await readTeamsTx(tx, input.eventId)
      const players = await readPlayersTx(tx, input.eventId)
      const purchases = await readPurchasesTx(tx, input.eventId)
      const report = validateEventConsistency({ event, teams, players, purchases })

      const plan = planEventConsistencyCheck(
        { eventId: input.eventId, actorUid: context.uid, auditLogId },
        { event, report },
      )
      const { writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })

      return {
        ok: report.ok,
        problems: report.problems,
        totals: computeEventTotals(teams, players, purchases),
      }
    })
  },
})

/** Changes which event the team PIN login page targets. */
export const setDefaultEvent = adminCallable({
  schema: eventIdSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id
    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const plan = planSetDefaultEvent(
        { eventId: input.eventId, actorUid: context.uid, auditLogId },
        { event },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return result
    })
  },
})

/**
 * Deletes all players, teams, purchases, audit logs and secrets for an event,
 * resetting the event to draft state with a fresh slate.
 */
export const resetEventData = adminCallable({
  schema: eventIdSchema,
  handler: async (input) => {
    const { eventId } = input

    await supabase.from('purchases').delete().eq('event_id', eventId)
    await supabase.from('players').delete().eq('event_id', eventId)
    await supabase.from('team_secrets').delete().eq('event_id', eventId)
    await supabase.from('pin_index').delete().eq('event_id', eventId)
    await supabase.from('sessions').delete().eq('event_id', eventId)
    await supabase.from('teams').delete().eq('event_id', eventId)
    await supabase.from('audit_logs').delete().eq('event_id', eventId)

    const { data: eventRow } = await supabase.from('events').select('data').eq('id', eventId).maybeSingle()
    if (eventRow) {
      await supabase.from('events').update({
        data: {
          ...(eventRow.data as Record<string, unknown>),
          status: 'draft',
          purchasesEnabled: true,
          spotlightPlayer: null,
          lastSoldPlayer: null,
          currentRound: 0,
          roundPhase: 'not_started',
          roundPoolPlayerIds: [],
          activePoolIndex: 0,
          unsoldPlayerIds: [],
          eliminatedTeamIds: [],
          qualifiedTeamIds: [],
          round1Results: null,
          round2Results: null,
          updatedAt: new Date().toISOString(),
        },
      }).eq('id', eventId)
    }

    return { ok: true, eventId }
  },
})

/**
 * Deletes all purchases / transactions for the event.
 * Reverts player statuses back to available, restores team remainingPurse to startingPurse,
 * resets team totalSpent, totalPoints, and playerCount to 0, and clears spotlight/sold cards.
 */
export const deleteTransactionsData = adminCallable({
  schema: eventIdSchema,
  handler: async (input) => {
    const { eventId } = input

    // 1. Delete all purchases
    await supabase.from('purchases').delete().eq('event_id', eventId)

    // 2. Reset player statuses back to available
    const { data: playerRows } = await supabase.from('players').select('id, data').eq('event_id', eventId)
    if (playerRows && playerRows.length > 0) {
      const updates = playerRows.map((r) => {
        const d = (r.data ?? {}) as Record<string, unknown>
        return {
          id: r.id,
          event_id: eventId,
          data: {
            ...d,
            status: 'available',
            soldToTeamId: null,
            purchaseId: null,
            updatedAt: new Date().toISOString(),
          },
        }
      })
      await supabase.from('players').upsert(updates)
    }

    // 3. Reset team balances and rosters
    const { data: teamRows } = await supabase.from('teams').select('id, data').eq('event_id', eventId)
    if (teamRows && teamRows.length > 0) {
      const updates = teamRows.map((r) => {
        const d = (r.data ?? {}) as Record<string, unknown>
        const startingPurse = Number(d.startingPurse ?? 0)
        return {
          id: r.id,
          event_id: eventId,
          data: {
            ...d,
            remainingPurse: startingPurse,
            totalSpent: 0,
            totalPoints: 0,
            playerCount: 0,
            updatedAt: new Date().toISOString(),
          },
        }
      })
      await supabase.from('teams').upsert(updates)
    }

    // 4. Clear spotlight and last sold player announcements on event
    const { data: eventRow } = await supabase.from('events').select('data').eq('id', eventId).maybeSingle()
    if (eventRow) {
      await supabase.from('events').update({
        data: {
          ...(eventRow.data as Record<string, unknown>),
          spotlightPlayer: null,
          lastSoldPlayer: null,
          currentRound: 0,
          roundPhase: 'not_started',
          roundPoolPlayerIds: [],
          activePoolIndex: 0,
          unsoldPlayerIds: [],
          eliminatedTeamIds: [],
          qualifiedTeamIds: [],
          round1Results: null,
          round2Results: null,
          updatedAt: new Date().toISOString(),
        },
      }).eq('id', eventId)
    }

    return { ok: true, deleted: 'transactions' }
  },
})

/**
 * Deletes all players in the pool.
 * Also clears transactions and resets team spent/roster count so teams stay consistent.
 */
export const deletePlayersData = adminCallable({
  schema: eventIdSchema,
  handler: async (input) => {
    const { eventId } = input

    // 1. Delete all purchases
    await supabase.from('purchases').delete().eq('event_id', eventId)

    // 2. Delete all players
    await supabase.from('players').delete().eq('event_id', eventId)

    // 3. Reset team balances and rosters to 0
    const { data: teamRows } = await supabase.from('teams').select('id, data').eq('event_id', eventId)
    if (teamRows && teamRows.length > 0) {
      const updates = teamRows.map((r) => {
        const d = (r.data ?? {}) as Record<string, unknown>
        const startingPurse = Number(d.startingPurse ?? 0)
        return {
          id: r.id,
          event_id: eventId,
          data: {
            ...d,
            remainingPurse: startingPurse,
            totalSpent: 0,
            totalPoints: 0,
            playerCount: 0,
            updatedAt: new Date().toISOString(),
          },
        }
      })
      await supabase.from('teams').upsert(updates)
    }

    // 4. Clear spotlight and last sold player announcements on event
    const { data: eventRow } = await supabase.from('events').select('data').eq('id', eventId).maybeSingle()
    if (eventRow) {
      await supabase.from('events').update({
        data: {
          ...(eventRow.data as Record<string, unknown>),
          spotlightPlayer: null,
          lastSoldPlayer: null,
          currentRound: 0,
          roundPhase: 'not_started',
          roundPoolPlayerIds: [],
          activePoolIndex: 0,
          unsoldPlayerIds: [],
          eliminatedTeamIds: [],
          qualifiedTeamIds: [],
          round1Results: null,
          round2Results: null,
          updatedAt: new Date().toISOString(),
        },
      }).eq('id', eventId)
    }

    return { ok: true, deleted: 'players' }
  },
})

/**
 * Deletes all teams, credentials, and active sessions.
 * Also deletes any purchases made by those teams and marks existing players as available.
 */
export const deleteTeamsData = adminCallable({
  schema: eventIdSchema,
  handler: async (input) => {
    const { eventId } = input

    // 1. Delete purchases made by teams
    await supabase.from('purchases').delete().eq('event_id', eventId)

    // 2. Delete team credentials, indexes, sessions, and teams
    await supabase.from('team_secrets').delete().eq('event_id', eventId)
    await supabase.from('pin_index').delete().eq('event_id', eventId)
    await supabase.from('sessions').delete().eq('event_id', eventId)
    await supabase.from('teams').delete().eq('event_id', eventId)

    // 3. Mark existing players back to available
    const { data: playerRows } = await supabase.from('players').select('id, data').eq('event_id', eventId)
    if (playerRows && playerRows.length > 0) {
      const updates = playerRows.map((r) => {
        const d = (r.data ?? {}) as Record<string, unknown>
        return {
          id: r.id,
          event_id: eventId,
          data: {
            ...d,
            status: 'available',
            soldToTeamId: null,
            purchaseId: null,
            updatedAt: new Date().toISOString(),
          },
        }
      })
      await supabase.from('players').upsert(updates)
    }

    // 4. Clear last sold player announcement on event
    const { data: eventRow } = await supabase.from('events').select('data').eq('id', eventId).maybeSingle()
    if (eventRow) {
      await supabase.from('events').update({
        data: {
          ...(eventRow.data as Record<string, unknown>),
          lastSoldPlayer: null,
          updatedAt: new Date().toISOString(),
        },
      }).eq('id', eventId)
    }

    return { ok: true, deleted: 'teams' }
  },
})

/**
 * Sets or clears the player currently on the auction block.
 * When a player is set, it updates spotlightPlayer on the event,
 * making it visible to everyone.
 * When playerId is null, it closes the spotlight card for everyone.
 */
export const setSpotlightPlayer = adminCallable({
  schema: setSpotlightPlayerSchema,
  handler: async (input) => {
    const { eventId, playerId } = input

    let spotlightPlayer: SpotlightPlayer | null = null

    if (playerId) {
      const { data: playerRow } = await supabase
        .from('players')
        .select('id, data')
        .eq('event_id', eventId)
        .eq('id', playerId)
        .maybeSingle()

      if (!playerRow) {
        fail('not-found', 'Player not found')
      }

      const pData = (playerRow.data ?? {}) as Record<string, unknown>
      spotlightPlayer = {
        playerId,
        name: String(pData.name ?? ''),
        points: Number(pData.points ?? 0),
        basePrice: Number(pData.basePrice ?? 0),
        photoUrl: typeof pData.photoUrl === 'string' ? pData.photoUrl : null,
        spotlightId: `${playerId}-${Date.now()}`,
        updatedAt: Date.now(),
        nationality: typeof pData.nationality === 'string' ? pData.nationality : null,
        role: typeof pData.role === 'string' ? pData.role : null,
        star: typeof pData.star === 'string' ? pData.star : null,
      }
    }

    const { data: eventRow } = await supabase
      .from('events')
      .select('data')
      .eq('id', eventId)
      .maybeSingle()

    if (eventRow) {
      const currentData = (eventRow.data ?? {}) as Record<string, unknown>
      const poolIds = Array.isArray(currentData.roundPoolPlayerIds)
        ? currentData.roundPoolPlayerIds.filter((id): id is string => typeof id === 'string')
        : []
      const poolIdx = playerId ? poolIds.indexOf(playerId) : -1
      await supabase.from('events').update({
        data: {
          ...currentData,
          spotlightPlayer,
          ...(poolIdx >= 0 ? { activePoolIndex: poolIdx } : {}),
          updatedAt: new Date().toISOString(),
        },
      }).eq('id', eventId)
    }

    return { ok: true, eventId, spotlightPlayer }
  },
})

/**
 * Sets or clears the countdown timer for the auction start.
 * Broadcasts to all connected team screens.
 */
export const setAuctionCountdown = adminCallable({
  schema: setAuctionCountdownSchema,
  handler: async (input) => {
    const { eventId, targetTime, durationSeconds, message } = input

    let countdown: AuctionCountdown | null = null
    if (targetTime && durationSeconds) {
      countdown = {
        targetTime,
        durationSeconds,
        message: message?.trim() || 'Starting in',
        startedAt: new Date().toISOString(),
      }
    }

    const { data: eventRow } = await supabase
      .from('events')
      .select('data')
      .eq('id', eventId)
      .maybeSingle()

    if (eventRow) {
      const currentData = (eventRow.data ?? {}) as Record<string, unknown>
      await supabase
        .from('events')
        .update({
          data: {
            ...currentData,
            countdown,
            updatedAt: new Date().toISOString(),
          },
        })
        .eq('id', eventId)
    }

    return { ok: true, eventId, countdown }
  },
})

/**
 * Sets or clears the break / intermission state for the auction.
 * Broadcasts "We will be back soon" to all team screens.
 */
export const setAuctionBreak = adminCallable({
  schema: setAuctionBreakSchema,
  handler: async (input) => {
    const { eventId, active, message, resumeTime } = input

    let breakState: AuctionBreak | null = null
    if (active) {
      breakState = {
        active: true,
        message: message?.trim() || 'We will be back soon',
        startedAt: new Date().toISOString(),
        resumeTime: resumeTime?.trim() || null,
      }
    }

    const { data: eventRow } = await supabase
      .from('events')
      .select('data')
      .eq('id', eventId)
      .maybeSingle()

    if (eventRow) {
      const currentData = (eventRow.data ?? {}) as Record<string, unknown>
      await supabase
        .from('events')
        .update({
          data: {
            ...currentData,
            break: breakState,
            updatedAt: new Date().toISOString(),
          },
        })
        .eq('id', eventId)
    }

    return { ok: true, eventId, break: breakState }
  },
})

/* -------------------------------------------------------------------------- */
/* 2-Round Auction Lifecycle & Queue Management                               */
/* -------------------------------------------------------------------------- */

async function loadEventAndEntities(eventId: string): Promise<{
  rawEventData: Record<string, unknown>
  event: EventDoc
  teams: TeamDoc[]
  players: PlayerDoc[]
}> {
  const [{ data: eventRow }, { data: teamRows }, { data: playerRows }] = await Promise.all([
    supabase.from('events').select('id, data').eq('id', eventId).maybeSingle(),
    supabase.from('teams').select('id, data').eq('event_id', eventId),
    supabase.from('players').select('id, data').eq('event_id', eventId),
  ])

  if (!eventRow) {
    fail('event-not-found')
  }

  const rawEventData = (eventRow.data ?? {}) as Record<string, unknown>
  const event = toEventDoc(eventId, rawEventData)
  if (!event) {
    fail('event-not-found')
  }

  const teams = (teamRows ?? [])
    .map((r) => toTeamDoc(r.id, (r.data ?? {}) as Record<string, unknown>))
    .filter((t): t is TeamDoc => t !== null)

  const players = (playerRows ?? [])
    .map((r) => toPlayerDoc(r.id, (r.data ?? {}) as Record<string, unknown>))
    .filter((p): p is PlayerDoc => p !== null)

  return { rawEventData, event, teams, players }
}

async function writeRoundAudit(
  eventId: string,
  actorUid: string,
  actorEmail: string | null,
  action: 'round.started' | 'round.ended' | 'player.unsold',
  targetId: string,
  metadata: Record<string, string | number | boolean | null>,
): Promise<void> {
  const auditId = auditRef(eventId).id
  await supabase.from('audit_logs').insert({
    id: auditId,
    event_id: eventId,
    data: {
      eventId,
      actorUid,
      actorRole: 'admin',
      actorEmail,
      action,
      targetType: action === 'player.unsold' ? 'player' : 'event',
      targetId,
      reason: null,
      metadata,
      createdAt: {
        seconds: Math.floor(Date.now() / 1000),
        nanoseconds: 0,
      },
    },
  })
}

async function syncPublicConfigStatus(eventId: string, status: string): Promise<void> {
  const { data: cfgRow } = await supabase.from('app_config').select('data').eq('id', 'app').maybeSingle()
  const cfgData = (cfgRow?.data ?? {}) as Record<string, unknown>
  if (cfgData.defaultEventId === eventId) {
    await supabase.from('app_config').update({
      data: {
        ...cfgData,
        eventStatus: status,
        updatedAt: new Date().toISOString(),
      },
    }).eq('id', 'app')
  }
}

async function finalizeRoundState(params: {
  eventId: string
  round: 1 | 2
  rawEventData: Record<string, unknown>
  event: EventDoc
  teams: TeamDoc[]
  players: PlayerDoc[]
  actorUid: string
  actorEmail: string | null
  extraPatch?: Record<string, unknown>
}): Promise<{ roundPhase: RoundPhase; snapshot: RoundSnapshot }> {
  const { eventId, round, rawEventData, event, teams, players, actorUid, actorEmail, extraPatch } = params
  const snapshot = buildRoundSnapshot({
    round,
    teams,
    players,
    poolSize: event.roundPoolPlayerIds?.length ?? 0,
    excludedTeamIds: round === 2 ? (event.eliminatedTeamIds ?? []) : [],
  })

  const nextPhase: RoundPhase = round === 1 ? 'round1_ended' : 'round2_ended'
  const nowIso = new Date().toISOString()

  const patch: Record<string, unknown> = {
    ...rawEventData,
    ...(extraPatch ?? {}),
    roundPhase: nextPhase,
    spotlightPlayer: null,
    lastSoldPlayer: null,
    updatedAt: nowIso,
    ...(round === 1
      ? {
          eliminatedTeamIds: snapshot.eliminatedTeamIds,
          qualifiedTeamIds: snapshot.qualifiedTeamIds,
          round1Results: snapshot,
        }
      : {
          round2Results: snapshot,
        }),
  }

  await supabase.from('events').update({ data: patch }).eq('id', eventId)

  await writeRoundAudit(eventId, actorUid, actorEmail, 'round.ended', eventId, {
    round,
    qualifiedCount: snapshot.qualifiedTeamIds.length,
    eliminatedCount: snapshot.eliminatedTeamIds.length,
  })

  return { roundPhase: nextPhase, snapshot }
}

/**
 * Called after a purchase (or unsold action) during an active round to update
 * the queue index and auto-end Round 1 or Round 2 once every player in the
 * active round pool has been processed.
 */
export async function syncRoundProgressAfterSale(params: {
  eventId: string
  soldPlayerId: string
  actorUid: string
  actorEmail: string | null
}): Promise<{ roundEnded: boolean; roundPhase: RoundPhase }> {
  const { rawEventData, event, teams, players } = await loadEventAndEntities(params.eventId)
  const phase = event.roundPhase ?? 'not_started'
  if (phase !== 'round1_active' && phase !== 'round2_active') {
    return { roundEnded: false, roundPhase: phase }
  }

  const poolIds = event.roundPoolPlayerIds ?? []
  if (poolIds.length === 0) {
    return { roundEnded: false, roundPhase: phase }
  }

  const unsold = (event.unsoldPlayerIds ?? []).filter((id) => id !== params.soldPlayerId)
  const unsoldSet = new Set(unsold)
  const playersById = new Map(players.map((p) => [p.id, p]))

  const soldIdx = poolIds.indexOf(params.soldPlayerId)
  const searchFrom = soldIdx >= 0 ? soldIdx + 1 : (event.activePoolIndex ?? 0)
  const nextIdx = findNextUnprocessedIndex(poolIds, playersById, unsoldSet, searchFrom)
  const complete = isRoundPoolComplete(poolIds, playersById, unsoldSet)

  if (complete) {
    const round = phase === 'round1_active' ? 1 : 2
    const finalized = await finalizeRoundState({
      eventId: params.eventId,
      round,
      rawEventData,
      event,
      teams,
      players,
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      extraPatch: {
        unsoldPlayerIds: unsold,
        activePoolIndex: poolIds.length,
      },
    })
    return { roundEnded: true, roundPhase: finalized.roundPhase }
  }

  await supabase.from('events').update({
    data: {
      ...rawEventData,
      unsoldPlayerIds: unsold,
      activePoolIndex: nextIdx >= 0 ? nextIdx : (event.activePoolIndex ?? 0),
      updatedAt: new Date().toISOString(),
    },
  }).eq('id', params.eventId)

  return { roundEnded: false, roundPhase: phase }
}

/**
 * Starts Round 1: generates the 187-player pool via `buildRoundPool(masterPlayers, 17)`
 * without deleting any rows from the master player list, activates the event,
 * and loads the serial queue (BAT -> BOWL -> AR -> WK).
 */
export const startRound1 = adminCallable({
  schema: eventIdSchema,
  handler: async (input, context) => {
    const { rawEventData, event, teams, players } = await loadEventAndEntities(input.eventId)
    if (event.status === 'finalized') {
      fail('event-finalized')
    }
    if (teams.length === 0 || players.length === 0) {
      fail('event-not-ready', 'Add at least one team and players before starting Round 1.')
    }

    const pool = buildRoundPool(players, ROUND_1_TARGET_TEAMS)
    const poolIds = pool.map((p) => p.id)
    const qualifiedTeamIds = teams.filter((t) => t.active).map((t) => t.id)
    const nowIso = new Date().toISOString()

    await supabase.from('events').update({
      data: {
        ...rawEventData,
        status: 'active',
        purchasesEnabled: true,
        currentRound: 1,
        roundPhase: 'round1_active',
        roundPoolPlayerIds: poolIds,
        activePoolIndex: 0,
        unsoldPlayerIds: [],
        eliminatedTeamIds: [],
        qualifiedTeamIds,
        round1Results: null,
        round2Results: null,
        spotlightPlayer: null,
        lastSoldPlayer: null,
        updatedAt: nowIso,
      },
    }).eq('id', input.eventId)

    await syncPublicConfigStatus(input.eventId, 'active')
    await writeRoundAudit(input.eventId, context.uid, context.email, 'round.started', input.eventId, {
      round: 1,
      poolSize: poolIds.length,
      targetTeamCount: ROUND_1_TARGET_TEAMS,
    })

    return {
      ok: true,
      eventId: input.eventId,
      currentRound: 1 as const,
      roundPhase: 'round1_active' as const,
      poolSize: poolIds.length,
      roundPoolPlayerIds: poolIds,
    }
  },
})

/** Ends Round 1 and computes Qualified vs Eliminated teams. */
export const endRound1 = adminCallable({
  schema: eventIdSchema,
  handler: async (input, context) => {
    const { rawEventData, event, teams, players } = await loadEventAndEntities(input.eventId)
    if (event.roundPhase !== 'round1_active' && event.currentRound !== 1) {
      fail('failed-precondition', 'Round 1 is not currently active.')
    }
    if (event.roundPhase === 'round1_ended' && event.round1Results) {
      return { ok: true, eventId: input.eventId, roundPhase: 'round1_ended' as const, snapshot: event.round1Results }
    }

    const { roundPhase, snapshot } = await finalizeRoundState({
      eventId: input.eventId,
      round: 1,
      rawEventData,
      event,
      teams,
      players,
      actorUid: context.uid,
      actorEmail: context.email,
    })

    return { ok: true, eventId: input.eventId, roundPhase, snapshot }
  },
})

/**
 * Starts Round 2:
 * 1. Locks out Round 1 eliminated teams.
 * 2. Resets every qualified team's purse to ₹125 Crore and clears Round 1 squads.
 * 3. Returns all master players to `available` and builds the 132-player Round 2 pool.
 */
export const startRound2 = adminCallable({
  schema: eventIdSchema,
  handler: async (input, context) => {
    const { rawEventData, event, teams, players } = await loadEventAndEntities(input.eventId)
    if (event.status === 'finalized') {
      fail('event-finalized')
    }
    if (event.roundPhase !== 'round1_ended') {
      fail('failed-precondition', 'End Round 1 before starting Round 2.')
    }

    const eliminatedIds = event.eliminatedTeamIds ?? []
    const eliminatedSet = new Set(eliminatedIds)
    const qualifiedTeamIds = teams
      .filter((t) => t.active && !eliminatedSet.has(t.id))
      .map((t) => t.id)

    if (qualifiedTeamIds.length === 0) {
      fail('failed-precondition', 'No teams qualified from Round 1 for Round 2.')
    }

    const nowIso = new Date().toISOString()

    // 1. Clear Round 1 purchases so Round 2 squads start clean and reconcile
    await supabase.from('purchases').delete().eq('event_id', input.eventId)

    // 2. Return every master player to the available pool without deleting any rows
    const { data: rawPlayerRows } = await supabase
      .from('players')
      .select('id, data')
      .eq('event_id', input.eventId)

    if (rawPlayerRows && rawPlayerRows.length > 0) {
      const playerUpdates = rawPlayerRows.map((row) => {
        const d = (row.data ?? {}) as Record<string, unknown>
        return {
          id: row.id,
          event_id: input.eventId,
          data: {
            ...d,
            status: 'available',
            soldToTeamId: null,
            purchaseId: null,
            updatedAt: nowIso,
          },
        }
      })
      await supabase.from('players').upsert(playerUpdates)
    }

    // 3. Reset qualified teams' purse to ₹125 Crore and clear squad stats
    const { data: rawTeamRows } = await supabase
      .from('teams')
      .select('id, data')
      .eq('event_id', input.eventId)

    if (rawTeamRows && rawTeamRows.length > 0) {
      const teamUpdates = rawTeamRows.map((row) => {
        const d = (row.data ?? {}) as Record<string, unknown>
        const isEliminated = eliminatedSet.has(row.id)
        const nextStartingPurse = isEliminated
          ? Number(d.startingPurse ?? 0)
          : ROUND_2_STARTING_PURSE
        return {
          id: row.id,
          event_id: input.eventId,
          data: {
            ...d,
            startingPurse: nextStartingPurse,
            remainingPurse: nextStartingPurse,
            totalSpent: 0,
            totalPoints: 0,
            playerCount: 0,
            updatedAt: nowIso,
          },
        }
      })
      await supabase.from('teams').upsert(teamUpdates)
    }

    // 4. Generate 132-player Round 2 pool from all master players
    const pool = buildRoundPool(players, ROUND_2_TARGET_TEAMS)
    const poolIds = pool.map((p) => p.id)

    await supabase.from('events').update({
      data: {
        ...rawEventData,
        status: 'active',
        purchasesEnabled: true,
        currentRound: 2,
        roundPhase: 'round2_active',
        roundPoolPlayerIds: poolIds,
        activePoolIndex: 0,
        unsoldPlayerIds: [],
        eliminatedTeamIds: eliminatedIds,
        qualifiedTeamIds,
        round2Results: null,
        spotlightPlayer: null,
        lastSoldPlayer: null,
        updatedAt: nowIso,
      },
    }).eq('id', input.eventId)

    await syncPublicConfigStatus(input.eventId, 'active')
    await writeRoundAudit(input.eventId, context.uid, context.email, 'round.started', input.eventId, {
      round: 2,
      poolSize: poolIds.length,
      targetTeamCount: ROUND_2_TARGET_TEAMS,
      qualifiedTeams: qualifiedTeamIds.length,
      eliminatedTeams: eliminatedIds.length,
    })

    return {
      ok: true,
      eventId: input.eventId,
      currentRound: 2 as const,
      roundPhase: 'round2_active' as const,
      poolSize: poolIds.length,
      roundPoolPlayerIds: poolIds,
      qualifiedTeamIds,
      eliminatedTeamIds: eliminatedIds,
    }
  },
})

/** Ends Round 2 and computes ranked Final Results leaderboard + disqualified teams. */
export const endRound2 = adminCallable({
  schema: eventIdSchema,
  handler: async (input, context) => {
    const { rawEventData, event, teams, players } = await loadEventAndEntities(input.eventId)
    if (event.roundPhase !== 'round2_active' && event.currentRound !== 2) {
      fail('failed-precondition', 'Round 2 is not currently active.')
    }
    if (event.roundPhase === 'round2_ended' && event.round2Results) {
      return { ok: true, eventId: input.eventId, roundPhase: 'round2_ended' as const, snapshot: event.round2Results }
    }

    const { roundPhase, snapshot } = await finalizeRoundState({
      eventId: input.eventId,
      round: 2,
      rawEventData,
      event,
      teams,
      players,
      actorUid: context.uid,
      actorEmail: context.email,
    })

    return { ok: true, eventId: input.eventId, roundPhase, snapshot }
  },
})

/**
 * Marks a player in the active round pool as Unsold, clears the spotlight,
 * advances `activePoolIndex`, and auto-ends the round if all pool players are processed.
 */
export const markPlayerUnsold = adminCallable({
  schema: markPlayerUnsoldSchema,
  handler: async (input, context) => {
    const { rawEventData, event, teams, players } = await loadEventAndEntities(input.eventId)
    const player = players.find((p) => p.id === input.playerId)
    if (!player) {
      fail('player-not-found')
    }
    if (player.status === 'sold') {
      fail('player-already-sold')
    }

    const phase = event.roundPhase ?? 'not_started'
    if (phase !== 'round1_active' && phase !== 'round2_active') {
      await supabase.from('events').update({
        data: {
          ...rawEventData,
          spotlightPlayer: null,
          updatedAt: new Date().toISOString(),
        },
      }).eq('id', input.eventId)
      return { ok: true, eventId: input.eventId, roundEnded: false, roundPhase: phase }
    }

    const poolIds = event.roundPoolPlayerIds ?? []
    const existingUnsold = event.unsoldPlayerIds ?? []
    const nextUnsold = existingUnsold.includes(input.playerId)
      ? existingUnsold
      : [...existingUnsold, input.playerId]
    const unsoldSet = new Set(nextUnsold)
    const playersById = new Map(players.map((p) => [p.id, p]))

    const idx = poolIds.indexOf(input.playerId)
    const searchFrom = idx >= 0 ? idx + 1 : (event.activePoolIndex ?? 0)
    const nextIdx = findNextUnprocessedIndex(poolIds, playersById, unsoldSet, searchFrom)
    const complete = isRoundPoolComplete(poolIds, playersById, unsoldSet)

    await writeRoundAudit(input.eventId, context.uid, context.email, 'player.unsold', input.playerId, {
      playerName: player.name,
      round: event.currentRound ?? 0,
    })

    if (complete) {
      const round = phase === 'round1_active' ? 1 : 2
      const finalized = await finalizeRoundState({
        eventId: input.eventId,
        round,
        rawEventData,
        event,
        teams,
        players,
        actorUid: context.uid,
        actorEmail: context.email,
        extraPatch: {
          unsoldPlayerIds: nextUnsold,
          activePoolIndex: poolIds.length,
        },
      })
      return {
        ok: true,
        eventId: input.eventId,
        roundEnded: true,
        roundPhase: finalized.roundPhase,
        snapshot: finalized.snapshot,
      }
    }

    await supabase.from('events').update({
      data: {
        ...rawEventData,
        spotlightPlayer: null,
        unsoldPlayerIds: nextUnsold,
        activePoolIndex: nextIdx >= 0 ? nextIdx : (event.activePoolIndex ?? 0),
        updatedAt: new Date().toISOString(),
      },
    }).eq('id', input.eventId)

    return {
      ok: true,
      eventId: input.eventId,
      roundEnded: false,
      roundPhase: phase,
      activePoolIndex: nextIdx >= 0 ? nextIdx : (event.activePoolIndex ?? 0),
    }
  },
})


