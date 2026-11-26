import { callFunction } from './callables'
import {
  broadcastBreak,
  broadcastCountdown,
  broadcastPlayerSold,
  broadcastPresenterCommand,
  broadcastPresenterView,
  broadcastRoundChange,
  broadcastSpotlight,
  type PresenterCommandType,
} from '@/lib/realtime'
import type {
  AuctionBreak,
  AuctionCountdown,
  EventStatus,
  PlayerStatus,
  PresenterViewOverride,
  RoundPhase,
  RoundSnapshot,
  TeamSummary,
} from '@shared/types'

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
  basePrice?: number
  photoUrl?: string | null
  externalReference?: string | null
  notes?: string | null
  status?: Extract<PlayerStatus, 'available' | 'withdrawn'>
  nationality?: string | null
  role?: string | null
  star?: string | null
  sortOrder?: number | null
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
  nationality?: string | null
  role?: string | null
  star?: string | null
  sortOrder?: number | null
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
  basePrice?: number
  photoUrl?: string | null
  externalReference?: string | null
  nationality?: string | null
  role?: string | null
  star?: string | null
  sortOrder?: number | null
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
  playerPhotoUrl?: string | null
  nationality?: string | null
  role?: string | null
  star?: string | null
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
  roundEnded?: boolean
  roundPhase?: RoundPhase
}

export async function recordPurchase(input: RecordPurchaseInput): Promise<RecordPurchaseResult> {
  const result: RecordPurchaseResult = await callFunction('recordPurchase', {
    eventId: input.eventId,
    playerId: input.playerId,
    teamId: input.teamId,
    finalPrice: input.finalPrice,
    requestId: input.requestId,
  })
  broadcastSpotlight(input.eventId, null)
  broadcastPlayerSold(input.eventId, {
    purchaseId: result.purchaseId,
    playerId: result.playerId,
    playerName: result.playerName,
    playerPhotoUrl: input.playerPhotoUrl ?? null,
    playerPoints: result.playerPoints,
    teamId: result.teamId,
    teamName: result.teamName,
    finalPrice: result.finalPrice,
    nationality: input.nationality ?? null,
    role: input.role ?? null,
    star: input.star ?? null,
  })
  if (result.roundEnded && result.roundPhase) {
    broadcastRoundChange(input.eventId, result.roundPhase)
  }
  return result
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

/* ----------------------------- reset event data --------------------------- */

export interface ResetEventDataResult {
  ok: boolean
  eventId: string
}

export function resetEventData(eventId: string): Promise<ResetEventDataResult> {
  return callFunction('resetEventData', { eventId })
}

export function deleteTransactionsData(eventId: string): Promise<{ ok: boolean; deleted: string }> {
  return callFunction('deleteTransactionsData', { eventId })
}

export function deletePlayersData(eventId: string): Promise<{ ok: boolean; deleted: string }> {
  return callFunction('deletePlayersData', { eventId })
}

export function deleteTeamsData(eventId: string): Promise<{ ok: boolean; deleted: string }> {
  return callFunction('deleteTeamsData', { eventId })
}

/* ---------------------------- spotlight player ---------------------------- */

export interface SetSpotlightPlayerResult {
  ok: boolean
  eventId: string
  spotlightPlayer: import('@shared/types').SpotlightPlayer | null
}

export async function setSpotlightPlayer(
  eventId: string,
  playerId: string | null,
): Promise<SetSpotlightPlayerResult> {
  const result: SetSpotlightPlayerResult = await callFunction('setSpotlightPlayer', { eventId, playerId })
  broadcastSpotlight(eventId, result.spotlightPlayer)
  return result
}

export async function clearSpotlightPlayer(eventId: string): Promise<SetSpotlightPlayerResult> {
  const result: SetSpotlightPlayerResult = await callFunction('setSpotlightPlayer', { eventId, playerId: null })
  broadcastSpotlight(eventId, null)
  return result
}

/* ------------------------- countdown & break -------------------------- */

export interface SetAuctionCountdownInput {
  eventId: string
  targetTime: string | null
  durationSeconds: number | null
  message?: string | null
}

export async function setAuctionCountdown(input: SetAuctionCountdownInput): Promise<void> {
  const countdown: AuctionCountdown | null =
    input.targetTime && input.durationSeconds
      ? {
          targetTime: input.targetTime,
          durationSeconds: input.durationSeconds,
          message: input.message?.trim() || 'Starting in',
          startedAt: new Date().toISOString(),
        }
      : null

  await callFunction('setAuctionCountdown', input)
  broadcastCountdown(input.eventId, countdown)
}

export interface SetAuctionBreakInput {
  eventId: string
  active: boolean
  message?: string | null
  resumeTime?: string | null
}

export async function setAuctionBreak(input: SetAuctionBreakInput): Promise<void> {
  const breakState: AuctionBreak | null = input.active
    ? {
        active: true,
        message: input.message?.trim() || 'We will be back soon',
        startedAt: new Date().toISOString(),
        resumeTime: input.resumeTime?.trim() || null,
      }
    : null

  await callFunction('setAuctionBreak', input)
  broadcastBreak(input.eventId, breakState)
}

/* -------------------------- 2-round auction flow -------------------------- */

export interface StartRoundResult {
  ok: boolean
  eventId: string
  currentRound: 1 | 2
  roundPhase: RoundPhase
  poolSize: number
  roundPoolPlayerIds: string[]
  qualifiedTeamIds?: string[]
  eliminatedTeamIds?: string[]
}

export interface EndRoundResult {
  ok: boolean
  eventId: string
  roundPhase: RoundPhase
  snapshot: RoundSnapshot
}

export interface MarkPlayerUnsoldResult {
  ok: boolean
  eventId: string
  roundEnded: boolean
  roundPhase: RoundPhase
  activePoolIndex?: number
  snapshot?: RoundSnapshot
}

export async function startRound1(eventId: string): Promise<StartRoundResult> {
  const result = await callFunction<{ eventId: string }, StartRoundResult>('startRound1', { eventId })
  broadcastSpotlight(eventId, null)
  broadcastRoundChange(eventId, result.roundPhase)
  return result
}

export async function endRound1(eventId: string): Promise<EndRoundResult> {
  const result = await callFunction<{ eventId: string }, EndRoundResult>('endRound1', { eventId })
  broadcastSpotlight(eventId, null)
  broadcastRoundChange(eventId, result.roundPhase)
  return result
}

export async function resumeRound1(eventId: string): Promise<StartRoundResult> {
  const result = await callFunction<{ eventId: string }, StartRoundResult>('resumeRound1', { eventId })
  broadcastSpotlight(eventId, null)
  broadcastPresenterView(eventId, 'auto')
  broadcastRoundChange(eventId, result.roundPhase)
  return result
}

export async function startRound2(eventId: string): Promise<StartRoundResult> {
  const result = await callFunction<{ eventId: string }, StartRoundResult>('startRound2', { eventId })
  broadcastSpotlight(eventId, null)
  broadcastRoundChange(eventId, result.roundPhase)
  return result
}

export async function endRound2(eventId: string): Promise<EndRoundResult> {
  const result = await callFunction<{ eventId: string }, EndRoundResult>('endRound2', { eventId })
  broadcastSpotlight(eventId, null)
  broadcastRoundChange(eventId, result.roundPhase)
  return result
}

export async function resumeRound2(eventId: string): Promise<StartRoundResult> {
  const result = await callFunction<{ eventId: string }, StartRoundResult>('resumeRound2', { eventId })
  broadcastSpotlight(eventId, null)
  broadcastPresenterView(eventId, 'auto')
  broadcastRoundChange(eventId, result.roundPhase)
  return result
}

export async function markPlayerUnsold(eventId: string, playerId: string): Promise<MarkPlayerUnsoldResult> {
  const result = await callFunction<{ eventId: string; playerId: string }, MarkPlayerUnsoldResult>(
    'markPlayerUnsold',
    { eventId, playerId },
  )
  broadcastSpotlight(eventId, null)
  broadcastRoundChange(eventId, result.roundPhase)
  return result
}

export async function setPresenterView(
  eventId: string,
  view: PresenterViewOverride,
): Promise<{ ok: boolean; eventId: string; presenterView: PresenterViewOverride }> {
  const result = await callFunction<
    { eventId: string; view: PresenterViewOverride },
    { ok: boolean; eventId: string; presenterView: PresenterViewOverride }
  >('setPresenterView', { eventId, view })
  if (view !== 'auto') {
    broadcastSpotlight(eventId, null)
  }
  broadcastPresenterView(eventId, result.presenterView)
  return result
}

export function sendPresenterCommand(eventId: string, command: PresenterCommandType): void {
  broadcastPresenterCommand(eventId, command)
}

