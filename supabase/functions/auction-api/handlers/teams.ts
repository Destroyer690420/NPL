import { FieldValue, type Transaction } from '../lib/firestore-shim.ts'
import { createTeamSchema, revokeTeamSessionsSchema, teamIdSchema, updateTeamSchema } from '../../_shared/schemas.ts'
import { planCreateTeam, planUpdateTeam } from '../../_shared/mutations.ts'
import { normalizeName } from '../../_shared/text.ts'
import { adminCallable } from '../lib/callables.ts'
import { fail, unwrapPlan } from '../lib/errors.ts'
import {
  PIN_SECRET_PARAM,
  generatePin,
  newId,
  pinLookupHash,
  pinVerifierHash,
  pinSecret,
} from '../lib/pin.ts'
import { auditCollection, auditRef, db, pinIndexRef, secretRef, teamsCollection } from '../lib/refs.ts'
import {
  applyWrites,
  getSecret,
  getTeam,
  readEventTx,
  readSecretTx,
  readTeamTx,
  revokeTeamSessions,
} from '../lib/store.ts'

/**
 * Generates a four digit PIN whose lookup hash is not already taken.
 * Collisions are resolved by re-generating, so a PIN collision can never grant
 * access to the wrong team.
 */
async function findFreePin(
  secret: string,
  eventId: string,
  isTaken: (lookupHash: string) => Promise<boolean>,
): Promise<{ pin: string; lookupHash: string }> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const pin = generatePin()
    const lookupHash = pinLookupHash(secret, eventId, pin)
    if (!(await isTaken(lookupHash))) return { pin, lookupHash }
  }
  fail('failed-precondition', 'Could not generate an unused PIN. Please try again.')
}

async function teamNameTakenInTx(
  tx: Transaction,
  eventId: string,
  name: string,
  excludeTeamId?: string,
): Promise<boolean> {
  const snapshot = await tx.get(
    teamsCollection(eventId).where('normalizedName', '==', normalizeName(name)).limit(5),
  )
  return snapshot.docs.some((doc) => doc.id !== excludeTeamId)
}

export const createTeam = adminCallable({
  schema: createTeamSchema,
  secrets: [PIN_SECRET_PARAM],
  handler: async (input, context) => {
    const secret = pinSecret()
    const teamId = newId('team')
    const auditLogId = auditRef(input.eventId).id

    return db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const nameTaken = await teamNameTakenInTx(tx, input.eventId, input.name)

      const { pin, lookupHash } = await findFreePin(
        secret,
        input.eventId,
        async (hash) => (await tx.get(pinIndexRef(hash))).exists,
      )

      const plan = planCreateTeam(
        {
          eventId: input.eventId,
          teamId,
          input: { name: input.name, startingPurse: input.startingPurse, logoUrl: input.logoUrl },
          actorUid: context.uid,
          auditLogId,
          pinLookupHash: lookupHash,
          pinVerifier: pinVerifierHash(secret, input.eventId, teamId, pin),
          pinVersion: 1,
        },
        { event, nameTaken },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })

      // The raw PIN is returned exactly once and is never persisted in plain text.
      return { ...result, pin }
    })
  },
})

export const updateTeam = adminCallable({
  schema: updateTeamSchema,
  handler: async (input, context) => {
    const auditLogId = auditRef(input.eventId).id

    const outcome = await db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      const team = await readTeamTx(tx, input.eventId, input.teamId)
      const nameTaken =
        input.name !== undefined
          ? await teamNameTakenInTx(tx, input.eventId, input.name, input.teamId)
          : false

      const plan = planUpdateTeam(
        {
          eventId: input.eventId,
          teamId: input.teamId,
          patch: {
            name: input.name,
            logoUrl: input.logoUrl,
            active: input.active,
            startingPurse: input.startingPurse,
          },
          reason: input.reason ?? null,
          actorUid: context.uid,
          auditLogId,
        },
        { event, team, nameTaken },
      )
      const { result, writes } = unwrapPlan(plan)
      applyWrites(tx, input.eventId, writes, { actorEmail: context.email })
      return result
    })

    if (outcome.sessionsRevoked) {
      await revokeTeamSessions(input.eventId, outcome.teamId, {
        actorUid: context.uid,
        actorEmail: context.email,
        reason: 'Team deactivated',
        action: 'team.deactivated',
      })
    }

    return outcome
  },
})

export const resetTeamPin = adminCallable({
  schema: teamIdSchema,
  secrets: [PIN_SECRET_PARAM],
  handler: async (input, context) => {
    const secret = pinSecret()
    const auditLogId = auditRef(input.eventId).id

    const result = await db().runTransaction(async (tx) => {
      const event = await readEventTx(tx, input.eventId)
      if (!event) fail('event-not-found')

      const team = await readTeamTx(tx, input.eventId, input.teamId)
      if (!team) fail('team-not-found')

      const existingSecret = await readSecretTx(tx, input.eventId, input.teamId)

      const { pin, lookupHash } = await findFreePin(
        secret,
        input.eventId,
        async (hash) => (await tx.get(pinIndexRef(hash))).exists,
      )

      const pinVerifier = pinVerifierHash(secret, input.eventId, input.teamId, pin)
      const pinVersion = (existingSecret?.pinVersion ?? 0) + 1

      if (existingSecret && existingSecret.pinLookupHash !== lookupHash) {
        tx.delete(pinIndexRef(existingSecret.pinLookupHash))
      }

      tx.set(
        auditCollection(input.eventId).doc(auditLogId),
        {
          eventId: input.eventId,
          actorUid: context.uid,
          actorRole: 'admin',
          actorEmail: context.email,
          action: 'team.pin-reset',
          targetType: 'team',
          targetId: input.teamId,
          reason: null,
          metadata: { teamName: team.name, pinVersion },
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: false },
      )

      tx.set(
        secretRef(input.eventId, input.teamId),
        {
          teamId: input.teamId,
          pinVerifier,
          pinLookupHash: lookupHash,
          pinVersion,
          pinSetAt: FieldValue.serverTimestamp(),
          pinSetBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      tx.set(
        pinIndexRef(lookupHash),
        { eventId: input.eventId, teamId: input.teamId },
        { merge: true },
      )

      return { teamId: input.teamId, teamName: team.name, pin, pinVersion }
    })

    const revoked = await revokeTeamSessions(input.eventId, input.teamId, {
      actorUid: context.uid,
      actorEmail: context.email,
      reason: 'PIN reset',
      action: 'team.pin-reset',
    })

    return { ...result, sessionsRevoked: revoked }
  },
})

export const revokeSessions = adminCallable({
  schema: revokeTeamSessionsSchema,
  handler: async (input, context) => {
    const team = await getTeam(input.eventId, input.teamId)
    if (!team) fail('team-not-found')
    const revoked = await revokeTeamSessions(input.eventId, input.teamId, {
      actorUid: context.uid,
      actorEmail: context.email,
      reason: input.reason ?? 'Sessions revoked by admin',
      action: 'team.sessions-revoked',
    })
    return { teamId: input.teamId, revoked }
  },
})

/** Reports whether a PIN is configured without ever exposing the verifier. */
export const getTeamPinStatus = adminCallable({
  schema: teamIdSchema,
  handler: async (input) => {
    const secret = await getSecret(input.eventId, input.teamId)
    return {
      configured: secret !== null,
      pinVersion: secret?.pinVersion ?? 0,
    }
  },
})
