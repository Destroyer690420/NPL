import type {
  AuditLogDoc,
  AuditTargetType,
  EventDoc,
  PlayerDoc,
  PublicConfigDoc,
  PurchaseDoc,
  TeamDoc,
  TeamSecretDoc,
  TeamSessionDoc,
  TimestampValue,
} from './types.ts'
import { DEFAULT_CURRENCY_LABEL } from './constants.ts'

/**
 * Document converters shared by the Cloud Functions (Admin SDK) and the web
 * client (Web SDK). Both SDKs expose the same plain data shape, so a single
 * implementation guarantees the two sides agree on the domain model.
 */

type Data = Record<string, unknown> | undefined

export function toTimestampValue(value: unknown): TimestampValue {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === 'number') return value
  if (typeof value === 'object') {
    const candidate = value as { seconds?: unknown; nanoseconds?: unknown }
    if (typeof candidate.seconds === 'number') {
      return {
        seconds: candidate.seconds,
        nanoseconds: typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : 0,
      }
    }
  }
  return null
}

/**
 * Converts any accepted timestamp representation (Firestore Timestamp, Date,
 * epoch millis, `{seconds}`) into epoch milliseconds. Null-safe.
 */
export function timestampToMillis(value: TimestampValue | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.getTime()
  const candidate = value as { seconds?: number; nanoseconds?: number; toDate?: () => Date }
  if (typeof candidate.toDate === 'function') {
    try {
      return candidate.toDate().getTime()
    } catch {
      return null
    }
  }
  if (typeof candidate.seconds === 'number') {
    return candidate.seconds * 1000 + Math.floor((candidate.nanoseconds ?? 0) / 1_000_000)
  }
  return null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toSpotlightPlayer(data: unknown): import('./types.ts').SpotlightPlayer | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.playerId !== 'string' || !d.playerId) return null
  return {
    playerId: d.playerId,
    name: asString(d.name),
    points: asInt(d.points),
    basePrice: asInt(d.basePrice),
    photoUrl: asNullableString(d.photoUrl),
    spotlightId: asString(d.spotlightId, d.playerId),
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : undefined,
  }
}

export function toEventDoc(id: string, data: Data): EventDoc | null {
  if (!data) return null
  return {
    id,
    name: asString(data.name),
    currencyLabel: asString(data.currencyLabel, DEFAULT_CURRENCY_LABEL),
    status: data.status === 'active' || data.status === 'finalized' ? data.status : 'setup',
    maxRosterSize:
      typeof data.maxRosterSize === 'number' && Number.isSafeInteger(data.maxRosterSize)
        ? data.maxRosterSize
        : null,
    defaultStartingPurse: asInt(data.defaultStartingPurse, 0),
    purchasesEnabled: data.purchasesEnabled === undefined ? true : asBool(data.purchasesEnabled, true),
    createdBy: asString(data.createdBy),
    createdAt: toTimestampValue(data.createdAt),
    updatedAt: toTimestampValue(data.updatedAt),
    spotlightPlayer: toSpotlightPlayer(data.spotlightPlayer),
    lastSoldPlayer: data.lastSoldPlayer ? (data.lastSoldPlayer as EventDoc['lastSoldPlayer']) : null,
    countdown: data.countdown ? (data.countdown as EventDoc['countdown']) : null,
    break: data.break ? (data.break as EventDoc['break']) : null,
  }
}

export function toTeamDoc(id: string, data: Data): TeamDoc | null {
  if (!data) return null
  return {
    id,
    name: asString(data.name),
    normalizedName: asString(data.normalizedName),
    logoUrl: asNullableString(data.logoUrl),
    startingPurse: asInt(data.startingPurse),
    remainingPurse: asInt(data.remainingPurse),
    totalSpent: asInt(data.totalSpent),
    totalPoints: asInt(data.totalPoints),
    playerCount: asInt(data.playerCount),
    active: asBool(data.active, true),
    createdAt: toTimestampValue(data.createdAt),
    updatedAt: toTimestampValue(data.updatedAt),
  }
}

export function toPlayerDoc(id: string, data: Data): PlayerDoc | null {
  if (!data) return null
  const status = data.status === 'sold' || data.status === 'withdrawn' ? data.status : 'available'
  return {
    id,
    name: asString(data.name),
    normalizedName: asString(data.normalizedName),
    points: asInt(data.points),
    basePrice: asInt(data.basePrice),
    status,
    soldToTeamId: asNullableString(data.soldToTeamId),
    purchaseId: asNullableString(data.purchaseId),
    photoUrl: asNullableString(data.photoUrl),
    externalReference: asNullableString(data.externalReference),
    notes: asNullableString(data.notes),
    createdAt: toTimestampValue(data.createdAt),
    updatedAt: toTimestampValue(data.updatedAt),
  }
}

export function toPurchaseDoc(id: string, data: Data): PurchaseDoc | null {
  if (!data) return null
  return {
    id,
    playerId: asString(data.playerId),
    playerNameSnapshot: asString(data.playerNameSnapshot),
    playerPointsSnapshot: asInt(data.playerPointsSnapshot),
    playerPhotoUrlSnapshot: asNullableString(data.playerPhotoUrlSnapshot),
    teamId: asString(data.teamId),
    teamNameSnapshot: asString(data.teamNameSnapshot),
    finalPrice: asInt(data.finalPrice),
    status: data.status === 'reversed' ? 'reversed' : 'confirmed',
    createdBy: asString(data.createdBy),
    requestId: asString(data.requestId, id),
    createdAt: toTimestampValue(data.createdAt),
    reversedAt: toTimestampValue(data.reversedAt),
    reversedBy: asNullableString(data.reversedBy),
    reversalReason: asNullableString(data.reversalReason),
  }
}

export function toAuditLogDoc(id: string, data: Data): AuditLogDoc | null {
  if (!data) return null
  return {
    id,
    eventId: asString(data.eventId),
    actorUid: asString(data.actorUid),
    actorRole:
      data.actorRole === 'superAdmin' || data.actorRole === 'system' ? data.actorRole : 'admin',
    actorEmail: asNullableString(data.actorEmail),
    action: (typeof data.action === 'string' ? data.action : 'event.updated') as AuditLogDoc['action'],
    targetType: (typeof data.targetType === 'string' ? data.targetType : 'event') as AuditTargetType,
    targetId: asString(data.targetId),
    reason: asNullableString(data.reason),
    metadata: (data.metadata ?? {}) as AuditLogDoc['metadata'],
    createdAt: toTimestampValue(data.createdAt),
  }
}

export function toTeamSecretDoc(teamId: string, data: Data): TeamSecretDoc | null {
  if (!data) return null
  return {
    teamId,
    pinVerifier: asString(data.pinVerifier),
    pinLookupHash: asString(data.pinLookupHash),
    pinVersion: asInt(data.pinVersion, 1),
    pinSetAt: toTimestampValue(data.pinSetAt),
    pinSetBy: asString(data.pinSetBy),
    updatedAt: toTimestampValue(data.updatedAt),
  }
}

export function toTeamSessionDoc(id: string, data: Data): TeamSessionDoc | null {
  if (!data) return null
  return {
    id,
    eventId: asString(data.eventId),
    teamId: asString(data.teamId),
    revoked: asBool(data.revoked, false),
    createdAt: toTimestampValue(data.createdAt),
    expiresAt: toTimestampValue(data.expiresAt),
    createdByIpHash: asNullableString(data.createdByIpHash),
  }
}

export function toPublicConfigDoc(data: Data): PublicConfigDoc | null {
  if (!data) return null
  return {
    defaultEventId: asNullableString(data.defaultEventId),
    eventName: asString(data.eventName),
    currencyLabel: asString(data.currencyLabel, DEFAULT_CURRENCY_LABEL),
    eventStatus: data.eventStatus === 'active' || data.eventStatus === 'finalized' ? data.eventStatus : null,
    updatedAt: toTimestampValue(data.updatedAt),
  }
}
