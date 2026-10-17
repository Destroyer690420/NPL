import { callFunction } from './callables'
import type { EventStatus, PlayerStatus } from '@shared/types'
import type { TeamSummary } from '@shared/types'

/**
 * Typed admin callables. Inputs mirror `functions/src/shared/schemas.ts` and
 * the server re-validates everything; these wrappers add no business rules.
 */

/* --------------------------------- event ---------------------------------- */

export interface CreateEventInput {
  eventId?: string
  name: string
  currencyLabel: string
  defaultStartingPurse: number
}

export interface CreateEventResult {
  eventId: string
  name: string
  setAsDefault: boolean
}

export function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  return callFunction('createEvent', input)
}

export interface UpdateEventInput {
  eventId: string
  name?: string
  currencyLabel?: string
  defaultStartingPurse?: number
  maxRosterSize?: number | null
  purchasesEnabled?: boolean
  status?: EventStatus
  reason?: string | null
}

export interface UpdateEventResult {
  eventId: string
  action: string
  status: EventStatus
  problems: string[]
}

export function updateEvent(input: UpdateEventInput): Promise<UpdateEventResult> {
  return callFunction('updateEvent', input)
}

export interface ConsistencyCheckResult {
  ok: boolean
  problems: string[]
  totals: {
    teamCount: number
    activeTeamCount: number
    playerCount: number
    availableCount: number
    soldCount: number
    withdrawnCount: number
    confirmedPurchaseCount: number
    reversedPurchaseCount: number
    totalSpent: number
    totalPoints: number
  }
}

export function checkEventConsistency(eventId: string): Promise<ConsistencyCheckResult> {
  return callFunction('checkEventConsistency', { eventId })
}

export function setDefaultEvent(eventId: string): Promise<{ eventId: string }> {
  return callFunction('setDefaultEvent', { eventId })
}

/* --------------------------------- teams ---------------------------------- */

export interface CreateTeamInput {
  eventId: string
  name: string
  startingPurse: number
  logoUrl?: string | null
}

export interface CreateTeamResult {
  teamId: string
  name: string
  /** Raw PIN, returned exactly once at creation. */
  pin: string
}

export function createTeam(input: CreateTeamInput): Promise<CreateTeamResult> {
  return callFunction('createTeam', input)
}

export interface UpdateTeamInput {
  eventId: string
  teamId: string
  name?: string
  logoUrl?: string | null
  active?: boolean
  startingPurse?: number
  reason?: string | null
}

export interface UpdateTeamResult {
  teamId: string
  name: string
  action: string
  sessionsRevoked: boolean
}

export function updateTeam(input: UpdateTeamInput): Promise<UpdateTeamResult> {
  return callFunction('updateTeam', input)
}

export interface ResetTeamPinResult {
  teamId: string
  teamName: string
  /** New raw PIN, returned exactly once. */
  pin: string
  pinVersion: number
  sessionsRevoked: number
}

export function resetTeamPin(eventId: string, teamId: string): Promise<ResetTeamPinResult> {
  return callFunction('resetTeamPin', { eventId, teamId })
}

export interface RevokeSessionsResult {
  teamId: string
  revoked: number
}

export function revokeTeamSessions(
  eventId: string,
  teamId: string,
  reason?: string | null,
): Promise<RevokeSessionsResult> {
  return callFunction('revokeSessions', { eventId, teamId, reason })
}

export interface TeamPinStatus {
  configured: boolean
  pinVersion: number
}

export function getTeamPinStatus(eventId: string, teamId: string): Promise<TeamPinStatus> {
  return callFunction('getTeamPinStatus', { eventId, teamId })
}

/* -------------------------------- players --------------------------------- */

export interface CreatePlayerInput {
  eventId: string
  name: string
  points: number
  basePrice: number
  photoUrl?: string | null
  externalReference?: string | null
  notes?: string | null
  status?: Extract<PlayerStatus, 'available' | 'withdrawn'>
}

export interface CreatePlayerResult {
  playerId: string
  name: string
}

export function createPlayer(input: CreatePlayerInput): Promise<CreatePlayerResult> {
  return callFunction('createPlayer', input)
}

export interface UpdatePlayerInput {
  eventId: string
  playerId: string
  name?: string
  points?: number
  basePrice?: number
  photoUrl?: string | null
  externalReference?: string | null
  notes?: string | null
  status?: Extract<PlayerStatus, 'available' | 'withdrawn'>
  reason?: string | null
}

export interface UpdatePlayerResult {
  playerId: string
  name: string
  corrected: boolean
  pointsDelta: number
}

export function updatePlayer(input: UpdatePlayerInput): Promise<UpdatePlayerResult> {
  return callFunction('updatePlayer', input)
}

export function setPlayerStatus(
  eventId: string,
  playerId: string,
  status: Extract<PlayerStatus, 'available' | 'withdrawn'>,
): Promise<{ playerId: string; status: PlayerStatus }> {
  return callFunction('setPlayerStatus', { eventId, playerId, status })
}

export interface ImportPlayerRow {
  name: string
  points: number
  basePrice: number
  photoUrl?: string | null
  externalReference?: string | null
}

export interface ImportPlayersResult {
  imported: number
  skipped: string[]
}

export function importPlayers(
  eventId: string,
  players: ImportPlayerRow[],
  mode: 'skip-duplicates' | 'fail' = 'fail',
): Promise<ImportPlayersResult> {
  return callFunction('importPlayers', { eventId, players, mode })
}

/* ------------------------------- purchases -------------------------------- */

export interface RecordPurchaseInput {
  eventId: string
  playerId: string
  teamId: string
  finalPrice: number
  /** Idempotency key, generated by the client per submission attempt. */
  requestId: string
}

export interface RecordPurchaseResult {
  purchaseId: string
  playerId: string
  playerName: string
  playerPoints: number
  teamId: string
  teamName: string
  finalPrice: number
  teamSummary: TeamSummary
  idempotentReplay: boolean
}

export function recordPurchase(input: RecordPurchaseInput): Promise<RecordPurchaseResult> {
  return callFunction('recordPurchase', input)
}

export interface ReversePurchaseResult {
  purchaseId: string
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  refundedPrice: number
  removedPoints: number
  teamSummary: TeamSummary
}

export function reversePurchase(
  eventId: string,
  purchaseId: string,
  reason: string,
): Promise<ReversePurchaseResult> {
  return callFunction('reversePurchase', { eventId, purchaseId, reason })
}
