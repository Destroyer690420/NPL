import type { AdminRole } from '@shared/types'
import type { AppErrorCode } from '@shared/errors'

/**
 * Browser-side session bookkeeping.
 *
 * The server issues opaque 256-bit session tokens (admin and team) and stores
 * only their hashes; this module keeps the raw token plus the display context
 * in local storage so a page reload can restore the session. Expired sessions
 * are dropped on read. Nothing here is trusted: every API call re-validates
 * the token server-side.
 */

export type SessionScope = 'admin' | 'team'

export interface StoredAdminSession {
  token: string
  /** Epoch ms, or null when the server did not provide one. */
  expiresAt: number | null
  role: AdminRole
  displayName: string
}

export interface StoredTeamSession {
  token: string
  expiresAt: number | null
  eventId: string | null
  teamId: string | null
}

const STORAGE_KEYS: Record<SessionScope, string> = {
  admin: 'auction:admin:session',
  team: 'auction:team:session',
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readStoredSession(scope: 'admin'): StoredAdminSession | null
export function readStoredSession(scope: 'team'): StoredTeamSession | null
export function readStoredSession(scope: SessionScope): StoredAdminSession | StoredTeamSession | null {
  const store = storage()
  if (!store) return null
  const raw = store.getItem(STORAGE_KEYS[scope])
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAdminSession & StoredTeamSession>
    if (typeof parsed?.token !== 'string' || parsed.token === '') return null
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : null
    if (expiresAt !== null && expiresAt <= Date.now()) {
      store.removeItem(STORAGE_KEYS[scope])
      return null
    }
    if (scope === 'admin') {
      return {
        token: parsed.token,
        expiresAt,
        role: parsed.role === 'admin' || parsed.role === 'superAdmin' ? parsed.role : 'admin',
        displayName: typeof parsed.displayName === 'string' ? parsed.displayName : 'Organizer',
      }
    }
    return {
      token: parsed.token,
      expiresAt,
      eventId: typeof parsed.eventId === 'string' ? parsed.eventId : null,
      teamId: typeof parsed.teamId === 'string' ? parsed.teamId : null,
    }
  } catch {
    return null
  }
}

export function writeStoredSession(
  scope: SessionScope,
  session: StoredAdminSession | StoredTeamSession,
): void {
  try {
    storage()?.setItem(STORAGE_KEYS[scope], JSON.stringify(session))
  } catch {
    // Storage unavailable (private mode): the session lasts until reload.
  }
}

export function clearStoredSession(scope: SessionScope): void {
  try {
    storage()?.removeItem(STORAGE_KEYS[scope])
  } catch {
    // Ignore.
  }
}

export function getSessionToken(scope: SessionScope): string | null {
  if (scope === 'admin') return readStoredSession('admin')?.token ?? null
  return readStoredSession('team')?.token ?? null
}

/* ------------------------- session invalidation bus ------------------------ */

type SessionInvalidHandler = (scope: SessionScope, code: AppErrorCode | null) => void

let invalidHandler: SessionInvalidHandler | null = null

/** Registered by the auth providers; called when the server rejects a session. */
export function setSessionInvalidHandler(handler: SessionInvalidHandler | null): void {
  invalidHandler = handler
}

export function notifySessionInvalid(scope: SessionScope, code: AppErrorCode): void {
  invalidHandler?.(scope, code)
}
