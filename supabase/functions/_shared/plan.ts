import { isAppErrorCode, type AppErrorCode } from './errors.ts'

/**
 * Domain error. Thrown inside Cloud Functions (and converted to HttpsError in
 * the adapter layer) and used by pure planners to signal a typed failure.
 */
export class DomainError extends Error {
  readonly code: AppErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: AppErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code)
    this.name = 'DomainError'
    this.code = code
    this.details = details
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError
}

export function toDomainError(value: unknown, fallback: AppErrorCode = 'internal'): DomainError {
  if (isDomainError(value)) return value
  if (value && typeof value === 'object' && 'code' in value) {
    const code = (value as { code?: unknown }).code
    const message = (value as { message?: unknown }).message
    if (isAppErrorCode(code)) {
      return new DomainError(code, typeof message === 'string' ? message : undefined)
    }
  }
  return new DomainError(fallback, value instanceof Error ? value.message : undefined)
}

export type PlanResult<T> =
  | { ok: true; writes: PlannedWrite[]; result: T }
  | { ok: false; code: AppErrorCode; message?: string; details?: Record<string, unknown> }

/** Marker replaced by FieldValue.serverTimestamp() in the Firestore adapter. */
export const SERVER_TIMESTAMP = Symbol.for('auction.serverTimestamp')
export type ServerTimestampMarker = typeof SERVER_TIMESTAMP

export function isServerTimestamp(value: unknown): value is ServerTimestampMarker {
  return value === SERVER_TIMESTAMP
}

export type PlannedWriteKind =
  | 'player'
  | 'team'
  | 'purchase'
  | 'auditLog'
  | 'event'
  | 'config'
  | 'secret'
  /** Global PIN lookup index (top level collection, server only). */
  | 'pinIndex'

/**
 * A single atomic write produced by a domain planner. The Firestore adapter
 * maps `kind` + `id` to the concrete document path inside the event.
 */
export interface PlannedWrite {
  kind: PlannedWriteKind
  id: string
  /** Full document data for creates, partial patch for updates. */
  data: Record<string, unknown>
  /** 'set' (merge not used) or 'update'. */
  op: 'set' | 'update'
}
