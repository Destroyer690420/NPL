import { FieldValue, Timestamp, getFirestore, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore'
import { isServerTimestamp, type PlannedWrite } from '../shared/plan'
import {
  toAuditLogDoc,
  toEventDoc,
  toPlayerDoc,
  toPublicConfigDoc,
  toPurchaseDoc,
  toTeamDoc,
  toTeamSecretDoc,
  toTeamSessionDoc,
} from '../shared/convert'

export {
  toAuditLogDoc,
  toEventDoc,
  toPlayerDoc,
  toPublicConfigDoc,
  toPurchaseDoc,
  toTeamDoc,
  toTeamSecretDoc,
  toTeamSessionDoc,
}

export function db(): Firestore {
  return getFirestore()
}

/* --------------------------------- refs ---------------------------------- */

export function eventRef(eventId: string): DocumentReference {
  return db().doc(`events/${eventId}`)
}

export function teamsCollection(eventId: string) {
  return eventRef(eventId).collection('teams')
}

export function teamRef(eventId: string, teamId: string): DocumentReference {
  return teamsCollection(eventId).doc(teamId)
}

export function playersCollection(eventId: string) {
  return eventRef(eventId).collection('players')
}

export function playerRef(eventId: string, playerId: string): DocumentReference {
  return playersCollection(eventId).doc(playerId)
}

export function purchasesCollection(eventId: string) {
  return eventRef(eventId).collection('purchases')
}

export function purchaseRef(eventId: string, purchaseId: string): DocumentReference {
  return purchasesCollection(eventId).doc(purchaseId)
}

export function auditCollection(eventId: string) {
  return eventRef(eventId).collection('auditLogs')
}

export function auditRef(eventId: string): DocumentReference {
  return auditCollection(eventId).doc()
}

export function secretsCollection(eventId: string) {
  return eventRef(eventId).collection('teamSecrets')
}

export function secretRef(eventId: string, teamId: string): DocumentReference {
  return secretsCollection(eventId).doc(teamId)
}

export function sessionsCollection(eventId: string) {
  return eventRef(eventId).collection('sessions')
}

export function sessionRef(eventId: string, sessionId: string): DocumentReference {
  return sessionsCollection(eventId).doc(sessionId)
}

export function pinIndexRef(lookupHash: string): DocumentReference {
  return db().doc(`pinIndex/${lookupHash}`)
}

export function rateLimitRef(key: string): DocumentReference {
  return db().doc(`rateLimits/${key}`)
}

export function configRef(id = 'app'): DocumentReference {
  return db().doc(`config/${id}`)
}

export function refForWrite(eventId: string, write: PlannedWrite): DocumentReference {
  switch (write.kind) {
    case 'player':
      return playerRef(eventId, write.id)
    case 'team':
      return teamRef(eventId, write.id)
    case 'purchase':
      return purchaseRef(eventId, write.id)
    case 'auditLog':
      return auditCollection(eventId).doc(write.id)
    case 'secret':
      return secretRef(eventId, write.id)
    case 'event':
      return eventRef(eventId)
    case 'config':
      return configRef(write.id)
    case 'pinIndex':
      return pinIndexRef(write.id)
    default: {
      const exhaustive: never = write.kind
      throw new Error(`Unknown write kind: ${String(exhaustive)}`)
    }
  }
}

/* --------------------------------- writes -------------------------------- */

export function replaceServerTimestamps(value: unknown): unknown {
  if (isServerTimestamp(value)) return FieldValue.serverTimestamp()
  if (Array.isArray(value)) return value.map((entry) => replaceServerTimestamps(entry))
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Timestamp) &&
    !(value instanceof FieldValue)
  ) {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = replaceServerTimestamps(entry)
    }
    return result
  }
  return value
}

export type { DocumentData }
