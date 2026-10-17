import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth'
import { requireFirebase } from '@/lib/firebase'
import { errorMessage } from '@/lib/errors'
import { adminLogin } from '@/services/adminAuth'
import type { AdminRole } from '@shared/types'

/**
 * Admin authentication (interim shared-credential design).
 *
 * The `adminLogin` callable verifies the configured admin ID/password
 * server-side and mints a Firebase custom token carrying `role: admin|superAdmin`.
 * This provider only exchanges that token for a session and reads the claim —
 * it never checks credentials itself. When the email/claims flow returns, only
 * `services/adminAuth.ts` changes.
 */

export type AdminAuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'notAuthorized'

export interface AdminAuthValue {
  status: AdminAuthStatus
  user: User | null
  role: AdminRole | null
  /** Display label for the signed-in operator. */
  displayName: string
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

function roleFromClaims(claims: Record<string, unknown>): AdminRole | null {
  if (claims.superAdmin === true || claims.role === 'superAdmin') return 'superAdmin'
  if (claims.admin === true || claims.role === 'admin') return 'admin'
  return null
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
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<AdminRole | null>(null)

  useEffect(() => {
    const { auth } = requireFirebase()
    let active = true

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!active) return
      if (!nextUser) {
        setUser(null)
        setRole(null)
        setStatus('signedOut')
        return
      }
      setUser(nextUser)
      void nextUser
        .getIdTokenResult()
        .then((token) => {
          if (!active) return
          const nextRole = roleFromClaims(token.claims)
          setRole(nextRole)
          setStatus(nextRole ? 'signedIn' : 'notAuthorized')
        })
        .catch(() => {
          if (!active) return
          setRole(null)
          setStatus('notAuthorized')
        })
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const value = useMemo<AdminAuthValue>(
    () => ({
      status,
      user,
      role,
      displayName: user?.displayName || user?.email || 'Organizer',
      signIn: async (adminId, password) => {
        const result = await adminLogin(adminId, password)
        setDefaultCredsFlag(result.usingDefaultCredentials)
      },
      signOut: async () => {
        setDefaultCredsFlag(false)
        const { auth } = requireFirebase()
        await firebaseSignOut(auth)
      },
    }),
    [status, user, role],
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

/** Friendly text for a failed sign-in (never says which field was wrong). */
export function signInErrorMessage(error: unknown): string {
  return errorMessage(error, 'Admin ID or password is incorrect.')
}

export { errorMessage }
