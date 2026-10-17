import { randomBytes } from 'node:crypto'
import { isServerTimestamp, type PlanResult, type PlannedWrite } from '../../_shared/plan'
import {
  toAuditLogDoc,
  toEventDoc,
  toPlayerDoc,
  toPublicConfigDoc,
  toPurchaseDoc,
  toTeamDoc,
  toTeamSecretDoc,
  toTeamSessionDoc,
} from '../../_shared/convert'
import { AppFunctionError, fail } from './errors'
import { isTimestampLike, type SnapshotLike } from './firestore-shim'
import { logger } from './logger'
import { supabase } from './supabase'

/**
 * Document references + the atomic write pipeline.
 *
 * Every table is a document store: `(id, event_id, data jsonb)`. Writes are
 * collected inside a transaction (all reads first, then writes) and applied by
 * the single `apply_plan` Postgres function, which verifies every precondition
 * recorded during the reads and rolls back atomically on any mismatch. On a
 * mismatch the transaction callback is retried with fresh state — the same
 * contract the Firestore transactions provided.
 */

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

export type DocTable =
  | 'app_config'
  | 'events'
  | 'teams'
  | 'players'
  | 'purchases'
  | 'audit_logs'
  | 'team_secrets'
  | 'pin_index'
  | 'sessions'
  | 'rate_limits'

export interface DocRef {
  readonly kind: 'doc'
  readonly table: DocTable
  readonly id: string
  readonly eventId: string | null
}

export interface QueryFilter {
  readonly field: string
  readonly value: unknown
}

export interface QuerySpec {
  readonly kind: 'query'
  readonly table: DocTable
  readonly eventId: string | null
  readonly filters: readonly QueryFilter[]
  readonly limitCount: number | null
}

export interface CollectionHandle extends QuerySpec {
  doc(id?: string): DocRef
  where(field: string, op: '==', value: unknown): CollectionHandle
  limit(count: number): CollectionHandle
  add(data: Record<string, unknown>): Promise<{ id: string }>
}

export function generateDocId(): string {
  return randomBytes(12).toString('base64url')
}

class CollectionQuery implements CollectionHandle {
  readonly kind = 'query' as const

  constructor(
    readonly table: DocTable,
    readonly eventId: string | null,
    readonly filters: readonly QueryFilter[] = [],
    readonly limitCount: number | null = null,
  ) {}

  doc(id?: string): DocRef {
    return { kind: 'doc', table: this.table, id: id ?? generateDocId(), eventId: this.eventId }
  }

  where(field: string, _op: '==', value: unknown): CollectionHandle {
    return new CollectionQuery(this.table, this.eventId, [...this.filters, { field, value }], this.limitCount)
  }

  limit(count: number): CollectionHandle {
    return new CollectionQuery(this.table, this.eventId, this.filters, count)
  }

  async add(data: Record<string, unknown>): Promise<{ id: string }> {
    const ref = this.doc()
    await applyOps([{ t: ref.table, id: ref.id, e: ref.eventId, m: 'set', d: prepareData(data) }])
    return { id: ref.id }
  }
}

/* --------------------------------- refs ---------------------------------- */

export function eventRef(eventId: string): DocRef {
  return { kind: 'doc', table: 'events', id: eventId, eventId }
}

export function teamsCollection(eventId: string): CollectionHandle {
  return new CollectionQuery('teams', eventId)
}

export function teamRef(eventId: string, teamId: string): DocRef {
  return teamsCollection(eventId).doc(teamId) as DocRef
}

export function playersCollection(eventId: string): CollectionHandle {
  return new CollectionQuery('players', eventId)
}

export function playerRef(eventId: string, playerId: string): DocRef {
  return playersCollection(eventId).doc(playerId) as DocRef
}

export function purchasesCollection(eventId: string): CollectionHandle {
  return new CollectionQuery('purchases', eventId)
}

export function purchaseRef(eventId: string, purchaseId: string): DocRef {
  return purchasesCollection(eventId).doc(purchaseId) as DocRef
}

export function auditCollection(eventId: string): CollectionHandle {
  return new CollectionQuery('audit_logs', eventId)
}

export function auditRef(eventId: string): DocRef {
  return auditCollection(eventId).doc() as DocRef
}

export function secretsCollection(eventId: string): CollectionHandle {
  return new CollectionQuery('team_secrets', eventId)
}

export function secretRef(eventId: string, teamId: string): DocRef {
  return secretsCollection(eventId).doc(teamId) as DocRef
}

export function sessionsCollection(eventId: string | null): CollectionHandle {
  return new CollectionQuery('sessions', eventId)
}

export function sessionRef(eventId: string | null, sessionId: string): DocRef {
  return sessionsCollection(eventId).doc(sessionId) as DocRef
}

export function pinIndexRef(lookupHash: string): DocRef {
  return { kind: 'doc', table: 'pin_index', id: lookupHash, eventId: null }
}

export function rateLimitRef(key: string): DocRef {
  return { kind: 'doc', table: 'rate_limits', id: key, eventId: null }
}

export function configRef(id = 'app'): DocRef {
  return { kind: 'doc', table: 'app_config', id, eventId: null }
}

export function refForWrite(eventId: string, write: PlannedWrite): DocRef {
  switch (write.kind) {
    case 'player':
      return playerRef(eventId, write.id)
    case 'team':
      return teamRef(eventId, write.id)
    case 'purchase':
      return purchaseRef(eventId, write.id)
    case 'auditLog':
      return auditCollection(eventId).doc(write.id) as DocRef
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

/* ------------------------------ serialization ----------------------------- */

/** Sentinels replaced with the database timestamp inside `apply_plan`. */
const SERVER_TS_SENTINEL = { __serverTs: true } as const

export function replaceServerTimestamps(value: unknown): unknown {
  return prepareData(value)
}

function prepareData(value: unknown): unknown {
  if (isServerTimestamp(value)) return SERVER_TS_SENTINEL
  if (isTimestampLike(value)) {
    return typeof (value as { toJson?: () => unknown }).toJson === 'function'
      ? (value as { toJson: () => unknown }).toJson()
      : { seconds: (value as { seconds: number }).seconds, nanoseconds: (value as { nanoseconds?: number }).nanoseconds ?? 0 }
  }
  if (value instanceof Date) {
    const ms = value.getTime()
    const seconds = Math.floor(ms / 1000)
    return { seconds, nanoseconds: Math.round((ms - seconds * 1000) * 1_000_000) }
  }
  if (Array.isArray(value)) return value.map((entry) => (entry === undefined ? null : prepareData(entry)))
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue
      result[key] = prepareData(entry)
    }
    return result
  }
  if (typeof value === 'function' || typeof value === 'symbol') return null
  return value
}

/* --------------------------------- reads ---------------------------------- */

export async function fetchDocById(
  table: DocTable,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from(table).select('data').eq('id', id).maybeSingle()
  if (error) {
    logger.error('Document read failed', { table, id, message: error.message })
    throw new AppFunctionError('unavailable', 'The event database could not be reached.')
  }
  const row = data as { data: Record<string, unknown> } | null
  return row?.data ?? null
}

export async function fetchQueryRows(
  spec: QuerySpec,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  let builder = supabase.from(spec.table).select('id,data')
  if (spec.eventId) builder = builder.eq('event_id', spec.eventId)
  const { data, error } = await builder
  if (error) {
    logger.error('Query read failed', { table: spec.table, message: error.message })
    throw new AppFunctionError('unavailable', 'The event database could not be reached.')
  }
  let rows = ((data ?? []) as Array<{ id: string; data: Record<string, unknown> }>).filter((row) =>
    spec.filters.every((filter) => (row.data as Record<string, unknown>)[filter.field] === filter.value),
  )
  if (spec.limitCount !== null) rows = rows.slice(0, spec.limitCount)
  return rows
}

function docSnapshot(id: string, data: Record<string, unknown> | null): SnapshotLike {
  return {
    id,
    exists: data !== null,
    empty: data === null,
    docs: [],
    data: () => data ?? undefined,
  }
}

function querySnapshot(rows: Array<{ id: string; data: Record<string, unknown> }>): SnapshotLike {
  const docs = rows.map((row) => ({
    id: row.id,
    exists: true as const,
    data: () => row.data,
  }))
  return { id: '', exists: false, empty: docs.length === 0, docs, data: () => undefined }
}

/* ------------------------------ transactions ------------------------------ */

export interface PendingOp {
  t: DocTable
  id: string
  e: string | null
  m: 'set' | 'merge' | 'delete'
  d?: unknown
  x?: unknown
}

class PlanConflictError extends Error {
  constructor() {
    super('plan-conflict')
    this.name = 'PlanConflictError'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class WriteTransaction {
  private readonly ops: PendingOp[] = []
  private readonly reads = new Map<string, Record<string, unknown> | null>()

  async get(source: DocRef | QuerySpec): Promise<SnapshotLike> {
    if (source.kind === 'doc') {
      const data = await fetchDocById(source.table, source.id)
      this.reads.set(`${source.table}|${source.id}`, data)
      return docSnapshot(source.id, data)
    }
    const rows = await fetchQueryRows(source)
    for (const row of rows) this.reads.set(`${source.table}|${row.id}`, row.data)
    return querySnapshot(rows)
  }

  set(ref: DocRef, data: Record<string, unknown>, options?: { merge?: boolean }): void {
    this.ops.push({
      t: ref.table,
      id: ref.id,
      e: ref.eventId,
      m: options?.merge ? 'merge' : 'set',
      d: prepareData(data),
    })
  }

  delete(ref: DocRef): void {
    this.ops.push({ t: ref.table, id: ref.id, e: ref.eventId, m: 'delete' })
  }

  pending(): PendingOp[] {
    return this.ops
  }

  /** Preconditions derived from everything this transaction read. */
  expectFor(op: PendingOp): unknown | undefined {
    const read = this.reads.get(`${op.t}|${op.id}`)
    if (read === undefined) return undefined
    if (read === null) return { __absent: true }
    return read
  }
}

class WriteBatch {
  private readonly ops: PendingOp[] = []

  set(ref: DocRef, data: Record<string, unknown>, options?: { merge?: boolean }): void {
    this.ops.push({
      t: ref.table,
      id: ref.id,
      e: ref.eventId,
      m: options?.merge ? 'merge' : 'set',
      d: prepareData(data),
    })
  }

  delete(ref: DocRef): void {
    this.ops.push({ t: ref.table, id: ref.id, e: ref.eventId, m: 'delete' })
  }

  commit(): Promise<void> {
    return applyOps(this.ops)
  }
}

/** Runs the collected ops atomically through the database function. */
async function applyOps(ops: PendingOp[], tx: WriteTransaction | null = null): Promise<void> {
  if (ops.length === 0) return
  const payload = ops.map((op) =>
    tx ? { ...op, x: tx.expectFor(op) } : { ...op },
  )
  const { error } = await supabase.rpc('apply_plan', { p_ops: payload })
  if (!error) return
  const code = String((error as { code?: string }).code ?? '')
  const message = String(error.message ?? '')
  if (message.includes('plan-conflict') || code === '23505' || code === '40001') {
    throw new PlanConflictError()
  }
  logger.error('Write batch failed', { message, code })
  throw new AppFunctionError('unavailable', 'The change could not be saved. Please try again.')
}

export interface FirestoreLikeDb {
  runTransaction<T>(callback: (tx: WriteTransaction) => Promise<T>): Promise<T>
  batch(): WriteBatch
}

export function db(): FirestoreLikeDb {
  return {
    async runTransaction<T>(callback: (tx: WriteTransaction) => Promise<T>): Promise<T> {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const tx = new WriteTransaction()
        const result = await callback(tx)
        const ops = tx.pending()
        if (ops.length === 0) return result
        try {
          await applyOps(ops, tx)
          return result
        } catch (error) {
          if (error instanceof PlanConflictError) {
            await sleep(20 + attempt * 25 + Math.floor(Math.random() * 20))
            continue
          }
          throw error
        }
      }
      fail('unavailable', 'The event data is changing quickly. Please try again.')
    },
    batch(): WriteBatch {
      return new WriteBatch()
    },
  }
}

export function assertPlanOk<T>(plan: PlanResult<T>): PlanResult<T> {
  return plan
}
