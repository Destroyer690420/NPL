import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { errorMessage, toFriendlyError } from '@/lib/errors'
import { adminLogin } from '@/services/adminAuth'
import { readAdminResource } from '@/services/reads'
import {
  clearStoredSession,
  readStoredSession,
  setSessionInvalidHandler,
} from '@/services/session'
import type { AdminRole } from '@shared/types'

/**
 * Admin authentication (interim shared-credential design).
 *
 * `adminLogin` verifies the configured admin ID/password server-side and
 * creates a database session; the browser only ever stores the opaque session
 * token. This provider restores the stored session on load, validates it in
 * the background, and signs out the moment the server rejects it. It never
 * checks credentials itself.
 */

export type AdminAuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'notAuthorized'

export interface AdminAuthValue {
  status: AdminAuthStatus
  role: AdminRole | null
  /** Display label for the signed-in operator. */
  displayName: string
  /** When the session ends (epoch ms), when known. */
  expiresAt: number | null
  /** Signs in with the shared admin ID/password; throws a friendly error on failure. */
  signIn: (adminId: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null)

export function useAdminAuth(): AdminAuthValue {
  const value = useContext(AdminAuthContext)
  if (!value) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>.')
  return value
}

/**
 * True when the last successful login used the built-in admin/admin defaults.
 * Persisted so the warning banner survives reloads; cleared on sign-out.
 */
const DEFAULT_CREDS_KEY = 'auction:admin:usingDefaultCredentials'

export function isUsingDefaultAdminCredentials(): boolean {
  try {
    return window.localStorage.getItem(DEFAULT_CREDS_KEY) === 'true'
  } catch {
    return false
  }
}

function setDefaultCredsFlag(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(DEFAULT_CREDS_KEY, 'true')
    else window.localStorage.removeItem(DEFAULT_CREDS_KEY)
  } catch {
    // Storage unavailable (private mode); the banner simply will not show.
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminAuthStatus>('loading')
  const [role, setRole] = useState<AdminRole | null>(null)
  const [displayName, setDisplayName] = useState('Organizer')
  const [expiresAt, setExpiresAt] = useState<number | null>(null)

  const endSession = useCallback(() => {
    clearStoredSession('admin')
    setRole(null)
    setDisplayName('Organizer')
    setExpiresAt(null)
    setStatus('signedOut')
  }, [])

  // A rejected admin session (expired, revoked or a non-admin token) signs the
  // console out immediately, wherever the failing call happened.
  useEffect(() => {
    setSessionInvalidHandler((scope) => {
      if (scope === 'admin') endSession()
    })
    return () => setSessionInvalidHandler(null)
  }, [endSession])

  useEffect(() => {
    let active = true
    const stored = readStoredSession('admin')
    if (!stored) {
      setStatus('signedOut')
      return
    }

    setRole(stored.role)
    setDisplayName(stored.displayName)
    setExpiresAt(stored.expiresAt)
    setStatus('signedIn')

    // Validate in the background: revoked/stale sessions are cleaned up on
    // load, without blocking the console on a healthy reload.
    void readAdminResource('events').catch((error) => {
      if (!active) return
      const code = toFriendlyError(error).code
      if (
        code === 'unauthenticated' ||
        code === 'session-expired' ||
        code === 'session-revoked' ||
        code === 'not-admin'
      ) {
        endSession()
      }
    })

    return () => {
      active = false
    }
  }, [endSession])

  const value = useMemo<AdminAuthValue>(
    () => ({
      status,
      role,
      displayName,
      expiresAt,
      signIn: async (adminId, password) => {
        const result = await adminLogin(adminId, password)
        setDefaultCredsFlag(result.usingDefaultCredentials)
        setRole(result.role)
        setDisplayName(result.displayName)
        setExpiresAt(typeof result.expiresAt === 'number' ? result.expiresAt : null)
        setStatus('signedIn')
      },
      signOut: async () => {
        setDefaultCredsFlag(false)
        endSession()
      },
    }),
    [status, role, displayName, expiresAt, endSession],
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

/** Friendly text for a failed sign-in (never says which field was wrong). */
export function signInErrorMessage(error: unknown): string {
  return errorMessage(error, 'Admin ID or password is incorrect.')
}

export { errorMessage }
