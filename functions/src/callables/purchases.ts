import { recordPurchaseSchema, reversePurchaseSchema } from '../shared/schemas'
import { planPurchase, planReversal } from '../shared/purchases'
import { adminCallable } from '../lib/callables'
import { unwrapPlan } from '../lib/errors'
import { auditRef, db } from '../lib/refs'
import {
  applyWrites,
  readEventTx,
  readPlayerTx,
  readPurchaseTx,
  readTeamTx,
} from '../lib/store'

/**
 * Records a purchase.
 *
 * Everything happens inside a single Firestore transaction: the reads, the pure
 * domain validation and then the writes. Any validation failure throws before a
 * single write is applied, so there can never be a partial purchase. The
 * purchase document id is the client supplied `requestId`, which makes retries
 * and double submits idempotent, and the player document check makes concurrent
 * sales of the same player impossible.
 */
export const recordPurchase = adminCallable({
  schema: recordPurchaseSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id

    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const player = await readPlayerTx(tx, input.eventId, input.playerId)
      const team = await readTeamTx(tx, input.eventId, input.teamId)
      const existingPurchase = await readPurchaseTx(tx, input.eventId, input.requestId)

      const plan = planPurchase(
        {
          eventId: input.eventId,
          playerId: input.playerId,
          teamId: input.teamId,
          finalPrice: input.finalPrice,
          requestId: input.requestId,
          actorUid: context.uid,
        },
        {
          event,
          player,
          team,
          existingPurchaseForRequest: existingPurchase,
          auditLogId,
        },
      )

      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return result
    })
  },
})

/** Reverses a confirmed purchase, restoring purse, points and roster count. */
export const reversePurchase = adminCallable({
  schema: reversePurchaseSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id

    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const purchase = await readPurchaseTx(tx, input.eventId, input.purchaseId)
      const player = purchase ? await readPlayerTx(tx, input.eventId, purchase.playerId) : null
      const team = purchase ? await readTeamTx(tx, input.eventId, purchase.teamId) : null

      const plan = planReversal(
        {
          eventId: input.eventId,
          purchaseId: input.purchaseId,
          reason: input.reason,
          actorUid: context.uid,
        },
        { event, purchase, player, team, auditLogId },
      )

      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return result
    })
  },
})
