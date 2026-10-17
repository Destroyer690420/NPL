import { FieldValue, type DocumentData, type Query, type Transaction } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import type { PlannedWrite } from '../shared/plan'
import {
  auditCollection,
  db,
  eventRef,
  playerRef,
  purchaseRef,
  purchasesCollection,
  playersCollection,
  replaceServerTimestamps,
  refForWrite,
  secretRef,
  sessionRef,
  sessionsCollection,
  teamRef,
  teamsCollection,
  toEventDoc,
  toPlayerDoc,
  toPurchaseDoc,
  toTeamDoc,
  toTeamSecretDoc,
  toTeamSessionDoc,
  configRef,
} from './refs'
import type {
  EventDoc,
  PlayerDoc,
  PublicConfigDoc,
  PurchaseDoc,
  TeamDoc,
  TeamSecretDoc,
  TeamSessionDoc,
} from '../shared/types'

/** Firestore adapter: all reads happen before all writes inside a transaction. */

export function applyWrites(
  tx: Transaction,
  eventId: string,
  writes: readonly PlannedWrite[],
  options?: { actorEmail?: string | null },
): void {
  for (const write of writes) {
    const ref = refForWrite(eventId, write)
    const source =
      write.kind === 'auditLog' && options?.actorEmail
        ? { ...write.data, actorEmail: options.actorEmail }
        : write.data
    const data = replaceServerTimestamps(source) as DocumentData
    // `merge: true` keeps partial patches safe while `set` stays an upsert.
    tx.set(ref, data, { merge: write.op === 'update' })
  }
}

async function readDocTx<T>(
  tx: Transaction,
  ref: ReturnType<typeof eventRef>,
  mapper: (id: string, data: DocumentData | undefined) => T | null,
): Promise<T | null> {
  const snapshot = await tx.get(ref)
  return mapper(snapshot.id, snapshot.data())
}

export function readEventTx(tx: Transaction, eventId: string): Promise<EventDoc | null> {
  return readDocTx(tx, eventRef(eventId), toEventDoc)
}

export function readTeamTx(tx: Transaction, eventId: string, teamId: string): Promise<TeamDoc | null> {
  return readDocTx(tx, teamRef(eventId, teamId), toTeamDoc)
}

export function readPlayerTx(
  tx: Transaction,
  eventId: string,
  playerId: string,
): Promise<PlayerDoc | null> {
  return readDocTx(tx, playerRef(eventId, playerId), toPlayerDoc)
}

export function readPurchaseTx(
  tx: Transaction,
  eventId: string,
  purchaseId: string,
): Promise<PurchaseDoc | null> {
  return readDocTx(tx, purchaseRef(eventId, purchaseId), toPurchaseDoc)
}

export function readSecretTx(
  tx: Transaction,
  eventId: string,
  teamId: string,
): Promise<TeamSecretDoc | null> {
  return readDocTx(tx, secretRef(eventId, teamId), toTeamSecretDoc)
}

export function readSessionTx(
  tx: Transaction,
  eventId: string,
  sessionId: string,
): Promise<TeamSessionDoc | null> {
  return readDocTx(tx, sessionRef(eventId, sessionId), toTeamSessionDoc)
}

async function readQueryTx<T>(
  tx: Transaction,
  query: Query,
  mapper: (id: string, data: DocumentData | undefined) => T | null,
): Promise<T[]> {
  const snapshot = await tx.get(query)
  return snapshot.docs
    .map((doc) => mapper(doc.id, doc.data()))
    .filter((value): value is T => value !== null)
}

export function readTeamsTx(tx: Transaction, eventId: string): Promise<TeamDoc[]> {
  return readQueryTx(tx, teamsCollection(eventId), toTeamDoc)
}

export function readPlayersTx(tx: Transaction, eventId: string): Promise<PlayerDoc[]> {
  return readQueryTx(tx, playersCollection(eventId), toPlayerDoc)
}

export function readPurchasesTx(tx: Transaction, eventId: string): Promise<PurchaseDoc[]> {
  return readQueryTx(tx, purchasesCollection(eventId), toPurchaseDoc)
}

/* --------------------------- non transactional ---------------------------- */

export async function getEvent(eventId: string): Promise<EventDoc | null> {
  const snapshot = await eventRef(eventId).get()
  return toEventDoc(snapshot.id, snapshot.data())
}

export async function getTeam(eventId: string, teamId: string): Promise<TeamDoc | null> {
  const snapshot = await teamRef(eventId, teamId).get()
  return toTeamDoc(snapshot.id, snapshot.data())
}

export async function getSecret(eventId: string, teamId: string): Promise<TeamSecretDoc | null> {
  const snapshot = await secretRef(eventId, teamId).get()
  return toTeamSecretDoc(snapshot.id, snapshot.data())
}

export async function getSession(eventId: string, sessionId: string): Promise<TeamSessionDoc | null> {
  const snapshot = await sessionRef(eventId, sessionId).get()
  return toTeamSessionDoc(snapshot.id, snapshot.data())
}

export async function getConfig(): Promise<PublicConfigDoc | null> {
  const snapshot = await configRef().get()
  const data = snapshot.data()
  if (!data) return null
  return {
    defaultEventId: typeof data.defaultEventId === 'string' ? data.defaultEventId : null,
    eventName: typeof data.eventName === 'string' ? data.eventName : '',
    currencyLabel: typeof data.currencyLabel === 'string' ? data.currencyLabel : 'credits',
    eventStatus:
      data.eventStatus === 'active' || data.eventStatus === 'finalized' ? data.eventStatus : null,
    updatedAt: data.updatedAt ?? null,
  }
}

/* --------------------------------- sessions ------------------------------- */

/**
 * Marks every open session of a team as revoked. Runs outside the calling
 * transaction because it may touch many documents; revocation is checked by
 * the security rules on every read, so it takes effect immediately.
 */
export async function revokeTeamSessions(
  eventId: string,
  teamId: string,
  options: {
    actorUid: string
    actorEmail?: string | null
    reason: string
    action: 'team.sessions-revoked' | 'team.pin-reset' | 'team.deactivated'
  },
): Promise<number> {
  const snapshot = await sessionsCollection(eventId)
    .where('teamId', '==', teamId)
    .where('revoked', '==', false)
    .get()

  if (snapshot.empty) return 0

  let revoked = 0
  const docs = snapshot.docs
  for (let index = 0; index < docs.length; index += 400) {
    const chunk = docs.slice(index, index + 400)
    const batch = db().batch()
    for (const doc of chunk) {
      batch.set(
        doc.ref,
        {
          revoked: true,
          revokedAt: FieldValue.serverTimestamp(),
          revokedBy: options.actorUid,
          revokedReason: options.action,
        },
        { merge: true },
      )
      revoked += 1
    }
    await batch.commit()
  }

  await auditCollection(eventId).add({
    eventId,
    actorUid: options.actorUid,
    actorRole: 'admin',
    actorEmail: options.actorEmail ?? null,
    action: 'session.revoked',
    targetType: 'session',
    targetId: teamId,
    reason: options.reason,
    metadata: { revokedCount: revoked, trigger: options.action },
    createdAt: FieldValue.serverTimestamp(),
  })

  logger.info('Revoked team sessions', { eventId, teamId, revoked })
  return revoked
}

export { configRef }
