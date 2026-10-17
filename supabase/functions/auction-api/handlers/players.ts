import type { Transaction } from '../lib/firestore-shim.ts'
import { createPlayerSchema, importPlayersSchema, setPlayerStatusSchema, updatePlayerSchema } from '../../_shared/schemas.ts'
import { planCreatePlayer, planImportPlayers, planSetPlayerStatus, planUpdatePlayer } from '../../_shared/mutations.ts'
import { adminCallable } from '../lib/callables.ts'
import { fail, unwrapPlan } from '../lib/errors.ts'
import { newId } from '../lib/pin.ts'
import { auditRef, db, playersCollection } from '../lib/refs.ts'
import {
  applyWrites,
  readEventTx,
  readPlayerTx,
  readPlayersTx,
  readPurchaseTx,
  readTeamTx,
} from '../lib/store.ts'

async function externalReferenceTaken(
  tx: Transaction,
  eventId: string,
  reference: string | null | undefined,
  excludePlayerId?: string,
): Promise<boolean> {
  const value = typeof reference === 'string' ? reference.trim().toLowerCase() : ''
  if (value === '') return false
  const snapshot = await tx.get(
    playersCollection(eventId).where('externalReferenceLower', '==', value).limit(5),
  )
  return snapshot.docs.some((doc) => doc.id !== excludePlayerId)
}

export const createPlayer = adminCallable({
  schema: createPlayerSchema,
  handler: async (input, context) => {
    const playerId = newId('plr')
    const auditLogId = auditRef(input.eventId).id

    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const duplicate = await externalReferenceTaken(tx, input.eventId, input.externalReference)

      const plan = planCreatePlayer(
        {
          eventId: input.eventId,
          playerId,
          input: {
            name: input.name,
            points: input.points,
            basePrice: input.basePrice,
            photoUrl: input.photoUrl ?? null,
            externalReference: input.externalReference ?? null,
            notes: input.notes ?? null,
            status: input.status,
          },
          actorUid: context.uid,
          auditLogId,
        },
        { event, duplicateExternalReference: duplicate },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return result
    })
  },
})

export const updatePlayer = adminCallable({
  schema: updatePlayerSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id

    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const player = await readPlayerTx(tx, input.eventId, input.playerId)

      const team = player?.soldToTeamId
        ? await readTeamTx(tx, input.eventId, player.soldToTeamId)
        : null
      const purchase = player?.purchaseId
        ? await readPurchaseTx(tx, input.eventId, player.purchaseId)
        : null
      const duplicate = await externalReferenceTaken(
        tx,
        input.eventId,
        input.externalReference,
        input.playerId,
      )

      const plan = planUpdatePlayer(
        {
          eventId: input.eventId,
          playerId: input.playerId,
          patch: {
            name: input.name,
            points: input.points,
            basePrice: input.basePrice,
            photoUrl: input.photoUrl,
            externalReference: input.externalReference,
            notes: input.notes,
            status: input.status,
          },
          reason: input.reason ?? null,
          actorUid: context.uid,
          auditLogId,
        },
        { event, player, team, purchase, duplicateExternalReference: duplicate },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return result
    })
  },
})

export const setPlayerStatus = adminCallable({
  schema: setPlayerStatusSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id
    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const player = await readPlayerTx(tx, input.eventId, input.playerId)
      const plan = planSetPlayerStatus(
        {
          eventId: input.eventId,
          playerId: input.playerId,
          status: input.status,
          actorUid: context.uid,
          auditLogId,
        },
        { event, player },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return result
    })
  },
})

export const importPlayers = adminCallable({
  schema: importPlayersSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id

    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      if (!event) fail('event-not-found')

      const existingPlayers = await readPlayersTx(tx, input.eventId)
      const existingReferences = new Set(
        existingPlayers
          .map((player) => player.externalReference?.toLowerCase())
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      )

      const mode = input.mode ?? 'fail'
      const rows: Array<{ playerId: string; input: { name: string; points: number; basePrice: number; externalReference: string | null } }> = []
      const skipped: string[] = []

      for (const row of input.players) {
        const reference = row.externalReference?.trim().toLowerCase() ?? null
        if (reference && existingReferences.has(reference)) {
          if (mode === 'skip-duplicates') {
            skipped.push(reference)
            continue
          }
          fail('player-duplicate-external-id', `Player id "${reference}" already exists.`)
        }
        if (reference) existingReferences.add(reference)
        rows.push({
          playerId: newId('plr'),
          input: {
            name: row.name,
            points: row.points,
            basePrice: row.basePrice,
            externalReference: reference,
          },
        })
      }

      if (rows.length === 0) {
        return { imported: 0, skipped }
      }

      const plan = planImportPlayers(
        { eventId: input.eventId, players: rows, actorUid: context.uid, auditLogId },
        { event, duplicateExternalReferences: new Set() },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return { ...result, skipped }
    })
  },
})
