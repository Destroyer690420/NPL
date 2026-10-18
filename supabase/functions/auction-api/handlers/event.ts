import {
  createEventSchema,
  eventIdSchema,
  setAuctionBreakSchema,
  setAuctionCountdownSchema,
  setSpotlightPlayerSchema,
  updateEventSchema,
} from '../../_shared/schemas.ts'
import { DEFAULT_EVENT_ID } from '../../_shared/constants.ts'
import { computeEventTotals, validateEventConsistency } from '../../_shared/calculations.ts'
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
import type { AuctionBreak, AuctionCountdown, SpotlightPlayer } from '../../_shared/types.ts'
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
          updatedAt: new Date().toISOString(),
        },
      }).eq('id', eventId)
    }

    return { ok: true, eventId }
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
      }
    }

    const { data: eventRow } = await supabase
      .from('events')
      .select('data')
      .eq('id', eventId)
      .maybeSingle()

    if (eventRow) {
      const currentData = (eventRow.data ?? {}) as Record<string, unknown>
      await supabase.from('events').update({
        data: {
          ...currentData,
          spotlightPlayer,
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


