/**
 * Shared domain types.
 *
 * This module is intentionally dependency free (no firebase-admin, no browser
 * APIs) so that it can be imported by the Cloud Functions, the web client and
 * the test suites alike. Timestamps are kept as opaque values here; conversion
 * happens in the adapter layers.
 */

export type EventStatus = 'setup' | 'active' | 'finalized'
export type PlayerStatus = 'available' | 'sold' | 'withdrawn'
export type PurchaseStatus = 'confirmed' | 'reversed'
export type AdminRole = 'admin' | 'superAdmin'

/** Opaque timestamp value (Firestore Timestamp, Date, or epoch millis). */
export type TimestampValue =
  | { seconds: number; nanoseconds: number }
  | { toDate?: () => Date }
  | Date
  | number
  | null

export interface SpotlightPlayer {
  playerId: string
  name: string
  points: number
  basePrice: number
  photoUrl: string | null
  spotlightId: string
  updatedAt?: number
  nationality?: string | null
  role?: string | null
  star?: string | null
}

export interface SoldPlayerAnnouncement {
  eventId?: string
  purchaseId?: string
  playerId?: string
  playerName: string
  playerPhotoUrl?: string | null
  playerPoints?: number
  teamId?: string
  teamName: string
  finalPrice?: number
  soldAt?: string
}

export interface AuctionCountdown {
  targetTime: string
  durationSeconds: number
  message?: string
  startedAt: string
}

export interface AuctionBreak {
  active: boolean
  message: string
  startedAt?: string
  resumeTime?: string | null
}

export interface EventDoc {
  id: string
  name: string
  currencyLabel: string
  status: EventStatus
  /** null = unlimited roster */
  maxRosterSize: number | null
  /** Pre-fills the "starting purse" field for newly created teams. */
  defaultStartingPurse: number
  /** When false, recording purchases is blocked even while the event is active. */
  purchasesEnabled: boolean
  createdBy: string
  createdAt: TimestampValue
  updatedAt: TimestampValue
  /** Player currently on the auction block, if any. */
  spotlightPlayer: SpotlightPlayer | null
  /** Most recently sold player announcement. */
  lastSoldPlayer?: SoldPlayerAnnouncement | null
  /** Auction starting countdown timer */
  countdown?: AuctionCountdown | null
  /** Auction break / intermission state */
  break?: AuctionBreak | null
}

export interface TeamDoc {
  id: string
  name: string
  normalizedName: string
  logoUrl: string | null
  startingPurse: number
  remainingPurse: number
  totalSpent: number
  totalPoints: number
  playerCount: number
  active: boolean
  createdAt: TimestampValue
  updatedAt: TimestampValue
}

export interface PlayerDoc {
  id: string
  name: string
  normalizedName: string
  points: number
  basePrice: number
  status: PlayerStatus
  soldToTeamId: string | null
  purchaseId: string | null
  photoUrl: string | null
  externalReference: string | null
  notes: string | null
  nationality?: string | null
  role?: string | null
  star?: string | null
  rating?: number | null
  createdAt: TimestampValue
  updatedAt: TimestampValue
}

export interface PurchaseDoc {
  /** Document id; equal to the client supplied idempotency `requestId`. */
  id: string
  playerId: string
  playerNameSnapshot: string
  playerPointsSnapshot: number
  playerPhotoUrlSnapshot: string | null
  teamId: string
  teamNameSnapshot: string
  finalPrice: number
  status: PurchaseStatus
  createdBy: string
  requestId: string
  createdAt: TimestampValue
  reversedAt: TimestampValue
  reversedBy: string | null
  reversalReason: string | null
}

export type AuditAction =
  | 'event.created'
  | 'event.updated'
  | 'event.activated'
  | 'event.finalized'
  | 'event.reopened'
  | 'event.consistency-checked'
  | 'team.created'
  | 'team.updated'
  | 'team.deactivated'
  | 'team.reactivated'
  | 'team.pin-reset'
  | 'team.starting-purse-changed'
  | 'team.sessions-revoked'
  | 'player.created'
  | 'player.updated'
  | 'player.corrected'
  | 'player.imported'
  | 'purchase.recorded'
  | 'purchase.reversed'
  | 'session.created'
  | 'session.revoked'
  | 'config.updated'

export type AuditTargetType = 'event' | 'team' | 'player' | 'purchase' | 'session' | 'config'

export interface AuditLogDoc {
  id: string
  eventId: string
  actorUid: string
  actorRole: AdminRole | 'system'
  /** Admin email when available; null with the interim shared admin login. */
  actorEmail: string | null
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  reason: string | null
  /** Minimal, non-secret metadata. */
  metadata: Record<string, string | number | boolean | null>
  createdAt: TimestampValue
}

/** Server-only: PIN verifier material. Never exposed to any client. */
export interface TeamSecretDoc {
  teamId: string
  /** HMAC of `${eventId}:${teamId}:${pin}` with the server PIN secret. */
  pinVerifier: string
  /** HMAC of `${eventId}:${pin}` - allows O(1) lookup without storing the PIN. */
  pinLookupHash: string
  pinVersion: number
  pinSetAt: TimestampValue
  pinSetBy: string
  /** Microsoft-style: bumped on every reset */
  updatedAt: TimestampValue
}

/** Server-only: team-bound session created by verifyTeamPin. */
export interface TeamSessionDoc {
  id: string
  eventId: string
  teamId: string
  revoked: boolean
  createdAt: TimestampValue
  expiresAt: TimestampValue
  createdByIpHash: string | null
}

export interface PublicConfigDoc {
  defaultEventId: string | null
  eventName: string
  currencyLabel: string
  eventStatus: EventStatus | null
  updatedAt: TimestampValue
}

/** Aggregated, display-ready team summary. */
export interface TeamSummary {
  startingPurse: number
  totalSpent: number
  remainingPurse: number
  totalPoints: number
  playerCount: number
}

export interface GoogleCredentials {
  projectId: string
}
