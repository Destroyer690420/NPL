import { SERVER_TIMESTAMP, type ServerTimestampMarker } from '../../_shared/plan'

/**
 * Firestore-compatible API surface implemented over Supabase Postgres.
 *
 * The business handlers were written against the Firestore admin SDK. Instead
 * of rewriting the tested domain logic, this shim provides the exact subset of
 * that API the handlers use, backed by the `auction-api` Postgres tables (see
 * supabase/migrations). All writes funnel through the atomic `apply_plan`
 * database function.
 */

export type DocumentData = Record<string, unknown>

/** Opaque marker replaced with a server timestamp inside `apply_plan`. */
export const FieldValue = {
  serverTimestamp(): ServerTimestampMarker {
    return SERVER_TIMESTAMP
  },
}

/** Firestore Timestamp stand-in. Serialized to `{seconds,nanoseconds}` JSON. */
export class Timestamp {
  readonly seconds: number
  readonly nanoseconds: number

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds
    this.nanoseconds = nanoseconds
  }

  static fromMillis(milliseconds: number): Timestamp {
    const seconds = Math.floor(milliseconds / 1000)
    const nanoseconds = Math.round((milliseconds - seconds * 1000) * 1_000_000)
    return new Timestamp(seconds, nanoseconds)
  }

  static fromDate(date: Date): Timestamp {
    return Timestamp.fromMillis(date.getTime())
  }

  static fromJson(value: { seconds: number; nanoseconds?: number }): Timestamp {
    return new Timestamp(value.seconds, value.nanoseconds ?? 0)
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000)
  }

  toDate(): Date {
    return new Date(this.toMillis())
  }

  toJson(): { seconds: number; nanoseconds: number } {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds }
  }
}

export function isTimestampLike(value: unknown): value is Timestamp {
  return (
    value instanceof Timestamp ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { seconds?: unknown }).seconds === 'number' &&
      typeof (value as { toMillis?: unknown }).toMillis === 'function')
  )
}

/** Snapshot shape shared by document and query results. */
export interface SnapshotLike {
  id: string
  exists: boolean
  empty: boolean
  docs: Array<{ id: string; exists: true; data(): DocumentData | undefined }>
  data(): DocumentData | undefined
}

/** The transaction interface the ported handlers are written against. */
export interface Transaction {
  get(source: unknown): Promise<SnapshotLike>
  set(ref: unknown, data: DocumentData, options?: { merge?: boolean }): void
  delete(ref: unknown): void
}

export type { ServerTimestampMarker }
