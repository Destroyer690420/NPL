import { signInWithCustomToken } from 'firebase/auth'
import { requireFirebase } from '@/lib/firebase'
import { callFunction } from './callables'

/**
 * Interim shared-credential admin login.
 *
 * The browser sends the ID/password to the `adminLogin` callable; the server
 * verifies them (constant-time, rate limited) and returns a Firebase custom
 * token carrying the admin claim. The token is then exchanged for a normal
 * Firebase Auth session, exactly like the team PIN flow. Credentials are never
 * checked client-side.
 */

interface AdminLoginPayload {
  token: string
  usingDefaultCredentials: boolean
}

export interface AdminLoginResult {
  /** True while the deployment still uses the built-in admin/admin defaults. */
  usingDefaultCredentials: boolean
}

/** Logs in and establishes the Firebase Auth session. Throws `CallError`. */
export async function adminLogin(adminId: string, password: string): Promise<AdminLoginResult> {
  const payload = await callFunction<{ adminId: string; password: string }, AdminLoginPayload>(
    'adminLogin',
    { adminId, password },
  )
  const { auth } = requireFirebase()
  await signInWithCustomToken(auth, payload.token)
  return { usingDefaultCredentials: payload.usingDefaultCredentials }
}
