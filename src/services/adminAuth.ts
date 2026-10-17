import type { AdminRole } from '@shared/types'
import { callFunction } from './callables'
import { writeStoredSession } from './session'

/**
 * Interim shared-credential admin login.
 *
 * The browser sends the ID/password to the `adminLogin` action of the
 * `auction-api` edge function; the server verifies them (constant-time, rate
 * limited) and creates a database session. The opaque 256-bit token returned
 * to the client is the only credential it holds — the database stores just its
 * hash. Credentials are never checked client-side.
 */

interface AdminLoginPayload {
  token: string
  sessionId: string
  expiresAt: number
  role: AdminRole
  usingDefaultCredentials: boolean
}

export interface AdminLoginResult {
  /** True while the deployment still uses the built-in admin/admin defaults. */
  usingDefaultCredentials: boolean
  role: AdminRole
  displayName: string
  expiresAt: number
}

/** Logs in and stores the session token. Throws `CallError`. */
export async function adminLogin(adminId: string, password: string): Promise<AdminLoginResult> {
  const payload = await callFunction<{ adminId: string; password: string }, AdminLoginPayload>(
    'adminLogin',
    { adminId, password },
  )
  const role: AdminRole = payload.role === 'superAdmin' ? 'superAdmin' : 'admin'
  const displayName = adminId.trim() || 'Organizer'
  writeStoredSession('admin', {
    token: payload.token,
    expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : null,
    role,
    displayName,
  })
  return {
    usingDefaultCredentials: payload.usingDefaultCredentials,
    role,
    displayName,
    expiresAt: payload.expiresAt,
  }
}
