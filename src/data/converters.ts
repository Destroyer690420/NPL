import type { FirestoreDataConverter } from 'firebase/firestore'
import {
  toAuditLogDoc,
  toEventDoc,
  toPlayerDoc,
  toPublicConfigDoc,
  toPurchaseDoc,
  toTeamDoc,
} from '@shared/convert'
import type {
  AuditLogDoc,
  EventDoc,
  PlayerDoc,
  PublicConfigDoc,
  PurchaseDoc,
  TeamDoc,
} from '@shared/types'

/**
 * Firestore converters that run every live snapshot through the same shared
 * mappers the Cloud Functions use, so client and server always agree on the
 * domain shape. Client writes are denied by the security rules, so
 * `toFirestore` is a guard that should never fire.
 */

function readOnlyConverter<T>(
  mapper: (id: string, data: Record<string, unknown> | undefined) => T | null,
): FirestoreDataConverter<T> {
  return {
    toFirestore() {
      throw new Error('Client writes are disabled. Use the provided Cloud Functions.')
    },
    fromFirestore(snapshot, options) {
      const data = snapshot.data(options) as Record<string, unknown> | undefined
      const value = mapper(snapshot.id, data)
      if (value === null) {
        throw new Error(`Failed to convert document ${snapshot.ref.path}.`)
      }
      return value
    },
  }
}

export const eventConverter: FirestoreDataConverter<EventDoc> = readOnlyConverter(toEventDoc)
export const teamConverter: FirestoreDataConverter<TeamDoc> = readOnlyConverter(toTeamDoc)
export const playerConverter: FirestoreDataConverter<PlayerDoc> = readOnlyConverter(toPlayerDoc)
export const purchaseConverter: FirestoreDataConverter<PurchaseDoc> =
  readOnlyConverter(toPurchaseDoc)
export const auditLogConverter: FirestoreDataConverter<AuditLogDoc> =
  readOnlyConverter(toAuditLogDoc)
export const publicConfigConverter: FirestoreDataConverter<PublicConfigDoc> =
  readOnlyConverter((_id, data) => toPublicConfigDoc(data))
