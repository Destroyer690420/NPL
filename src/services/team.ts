import { callFunction } from './callables'

/** Team-facing callables (public PIN verification + session lifecycle). */

export interface VerifyTeamPinInput {
  pin: string
  /** Optional; defaults to the configured default event server-side. */
  eventId?: string
}

export interface VerifyTeamPinResult {
  /** Opaque 256-bit session token bound to {eventId, teamId, sessionId}. */
  sessionToken: string
  sessionId: string
  eventId: string
  teamId: string
  teamName: string
  logoUrl: string | null
  expiresAt: number
  eventName: string
  currencyLabel: string
  eventStatus: 'setup' | 'active' | 'finalized'
}

/** Verifies a PIN server-side. Throws `CallError` with `invalid-pin` etc. */
export function verifyTeamPin(input: VerifyTeamPinInput): Promise<VerifyTeamPinResult> {
  return callFunction('verifyTeamPin', input)
}

export interface TeamContextResult {
  eventId: string
  eventName: string
  currencyLabel: string
  eventStatus: 'setup' | 'active' | 'finalized'
  teamId: string
  teamName: string
  logoUrl: string | null
  expiresAt: number | null
}

/** Re-hydrates the team display context after a page reload. */
export function getTeamContext(): Promise<TeamContextResult> {
  return callFunction('getTeamContext', {})
}

export function logoutTeamSession(): Promise<{ revoked: boolean }> {
  return callFunction('logoutTeamSession', {})
}

export interface TeamLineupPlayer {
  id: string
  name: string
  photoUrl: string | null
  sortOrder?: number | null
  externalReference?: string | null
  nationality?: string | null
  role?: string | null
  star?: string | null
}

/** Fetches available players in the auction pool (only name and pfp; no price or points). */
export function getTeamLineup(): Promise<TeamLineupPlayer[]> {
  return callFunction('getTeamLineup', {})
}

