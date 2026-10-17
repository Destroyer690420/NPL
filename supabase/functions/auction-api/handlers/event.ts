import { createEventSchema, eventIdSchema, updateEventSchema } from '../../_shared/schemas.ts'
import { DEFAULT_EVENT_ID } from '../../_shared/constants.ts'
import { computeEventTotals, validateEventConsistency } from '../../_shared/calculations.ts'
import {
  planCreateEvent,
  planEventConsistencyCheck,
  planSetDefaultEvent,
  planUpdateEvent,
} from '../../_shared/mutations.ts'
import { adminCallable } from '../lib/callables.ts'
import { unwrapPlan } from '../lib/errors.ts'
import { auditRef, configRef, db } from '../lib/refs.ts'
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
