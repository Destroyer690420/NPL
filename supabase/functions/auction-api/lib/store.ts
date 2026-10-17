import type { PlannedWrite } from '../../_shared/plan'
import type { DocumentData, Transaction } from './firestore-shim'
import {
  auditCollection,
  configRef,
  eventRef,
  fetchDocById,
  fetchQueryRows,
  generateDocId,
  playerRef,
  purchaseRef,
  refForWrite,
  secretRef,
  sessionRef,
  sessionsCollection,
  teamRef,
  teamsCollection,
  playersCollection,
  purchasesCollection,
  db,
  toEventDoc,
  toPlayerDoc,
  toPurchaseDoc,
  toTeamDoc,
  toTeamSecretDoc,
  toTeamSessionDoc,
  type DocRef,
} from './refs'
import type {
  EventDoc,
  PlayerDoc,
  PublicConfigDoc,
  PurchaseDoc,
  TeamDoc,
  TeamSecretDoc,
  TeamSessionDoc,
} from '../../_shared/types'

/**
 * Supabase adapter: all reads happen before all writes inside a plan
 * "transaction"; the writes themselves are applied atomically by
 * `apply_plan` with the preconditions captured during the reads.
 */

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
    // `merge: true` keeps partial patches safe while `set` stays an upsert.
    tx.set(ref, source as DocumentData, { merge: write.op === 'update' })
  }
}

async function readDocTx<T>(
  tx: Transaction,
  ref: DocRef,
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
  query: { kind: 'query' },
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
  const data = await fetchDocById('events', eventId)
  return toEventDoc(eventId, data ?? undefined)
}

export async function getTeam(eventId: string, teamId: string): Promise<TeamDoc | null> {
  const data = await fetchDocById('teams', teamId)
  if (data && data.eventId !== undefined && data.eventId !== eventId) return null
  return toTeamDoc(teamId, data ?? undefined)
}

export async function getSecret(eventId: string, teamId: string): Promise<TeamSecretDoc | null> {
  const data = await fetchDocById('team_secrets', teamId)
  if (data && typeof data.eventId === 'string' && data.eventId !== eventId) return null
  return toTeamSecretDoc(teamId, data ?? undefined)
}

export async function getSession(eventId: string, sessionId: string): Promise<TeamSessionDoc | null> {
  const data = await fetchDocById('sessions', sessionId)
  if (data && typeof data.eventId === 'string' && eventId && data.eventId !== eventId) return null
  return toTeamSessionDoc(sessionId, data ?? undefined)
}

export async function getConfig(): Promise<PublicConfigDoc | null> {
  const data = await fetchDocById('app_config', 'app')
  if (!data) return null
  return {
    defaultEventId: typeof data.defaultEventId === 'string' ? data.defaultEventId : null,
    eventName: typeof data.eventName === 'string' ? data.eventName : '',
    currencyLabel: typeof data.currencyLabel === 'string' ? data.currencyLabel : 'credits',
    eventStatus:
      data.eventStatus === 'active' || data.eventStatus === 'finalized' ? data.eventStatus : null,
    updatedAt: (data.updatedAt as PublicConfigDoc['updatedAt']) ?? null,
  }
}

/* --------------------------------- sessions ------------------------------- */

/**
 * Marks every open session of a team as revoked. Revocation is checked on
 * every authenticated call, so it takes effect immediately.
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
  const query = sessionsCollection(eventId).where('teamId', '==', teamId)
  const rows = (await fetchQueryRows(query)).filter((row) => row.data.revoked === false)

  if (rows.length === 0) return 0

  const batch = db().batch()
  for (const row of rows) {
    batch.set(
      sessionRef(eventId, row.id),
      {
        revoked: true,
        revokedAt: new Date(),
        revokedBy: options.actorUid,
        revokedReason: options.action,
      } as DocumentData,
      { merge: true },
    )
  }
  batch.set(auditCollection(eventId).doc(generateDocId()), {
    eventId,
    actorUid: options.actorUid,
    actorRole: 'admin',
    actorEmail: options.actorEmail ?? null,
    action: 'session.revoked',
    targetType: 'session',
    targetId: teamId,
    reason: options.reason,
    metadata: { revokedCount: rows.length, trigger: options.action },
    createdAt: new Date(),
  })
  await batch.commit()

  return rows.length
}

export { configRef }
