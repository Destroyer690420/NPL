import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut, type User } from 'firebase/auth'
import { requireFirebase } from '@/lib/firebase'
import { toFriendlyError, type FriendlyError } from '@/lib/errors'
import { getTeamContext, logoutTeamSession, verifyTeamPin, type TeamContextResult } from '@/services/team'

/**
 * Team session authentication.
 *
 * `verifyTeamPin` checks the PIN server-side and mints a Firebase Auth custom
 * token bound to one {eventId, teamId, sessionId}. On reload the session is
 * re-validated with `getTeamContext` (which re-checks the session document),
 * and an expiry timer signs the team out locally right when the server-side
 * session ends.
 */

export type TeamAuthStatus = 'loading' | 'signedOut' | 'signedIn'

export interface TeamAuthValue {
  status: TeamAuthStatus
  context: TeamContextResult | null
  /** Set when a session ends unexpectedly (expired/revoked/deactivated). */
  sessionMessage: string | null
  /** Verifies the PIN and signs in. Throws `CallError` for the UI. */
  signIn: (pin: string) => Promise<void>
  signOut: () => Promise<void>
  clearSessionMessage: () => void
}

const TeamAuthContext = createContext<TeamAuthValue | null>(null)

export function useTeamAuth(): TeamAuthValue {
  const value = useContext(TeamAuthContext)
  if (!value) throw new Error('useTeamAuth must be used inside <TeamAuthProvider>.')
  return value
}

export function TeamAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TeamAuthStatus>('loading')
  const [context, setContext] = useState<TeamContextResult | null>(null)
  const [sessionMessage, setSessionMessage] = useState<string | null>(null)
  const signingIn = useRef(false)
  const generation = useRef(0)

  const endSessionLocally = useCallback((message: string | null) => {
    generation.current += 1
    setContext(null)
    setStatus('signedOut')
    if (message) setSessionMessage(message)
  }, [])

  const hydrate = useCallback(
    async (user: User): Promise<void> => {
      const run = generation.current
      try {
        const token = await user.getIdTokenResult()
        if (token.claims.kind !== 'team') {
          // A non-team account (for example an admin) is signed in on this
          // browser; the team panel simply treats it as signed out.
          setContext(null)
          setStatus('signedOut')
          return
        }
        const result = await getTeamContext()
        if (generation.current !== run) return
        setContext(result)
        setStatus('signedIn')
      } catch (error) {
        if (generation.current !== run) return
        const friendly = toFriendlyError(error)
        const expired = friendly.code === 'session-expired'
        const revoked = friendly.code === 'session-revoked' || friendly.code === 'team-inactive'
        if (expired || revoked || friendly.code === 'permission-denied' || friendly.code === 'unauthenticated') {
          const { auth } = requireFirebase()
          await firebaseSignOut(auth).catch(() => undefined)
          endSessionLocally(friendly.message)
        } else {
          // Transient failure (network): keep the user signed in and let the
          // panel show a connection problem; reads will retry automatically.
          setStatus('signedOut')
          setSessionMessage(friendly.message)
        }
      }
    },
    [endSessionLocally],
  )

  useEffect(() => {
    const { auth } = requireFirebase()
    let active = true

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active) return
      if (!user) {
        setContext(null)
        setStatus('signedOut')
        return
      }
      if (signingIn.current) return
      setStatus('loading')
      void hydrate(user)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [hydrate])

  // Local expiry timer: end the session exactly when the server-side session ends.
  useEffect(() => {
    if (status !== 'signedIn' || !context?.expiresAt) return
    const remaining = context.expiresAt - Date.now()
    if (remaining <= 0) {
      void (async () => {
        const { auth } = requireFirebase()
        await firebaseSignOut(auth).catch(() => undefined)
        endSessionLocally('Your team session expired. Please enter your PIN again.')
      })()
      return
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        const { auth } = requireFirebase()
        await firebaseSignOut(auth).catch(() => undefined)
        endSessionLocally('Your team session expired. Please enter your PIN again.')
      })()
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [status, context?.expiresAt, endSessionLocally])

  const signIn = useCallback(
    async (pin: string) => {
      const { auth } = requireFirebase()
      generation.current += 1
      signingIn.current = true
      setSessionMessage(null)
      try {
        await verifyTeamPin({ pin }).then(async (result) => {
          await signInWithCustomToken(auth, result.sessionToken)
        })
        const user = auth.currentUser
        if (!user) throw new Error('The team session could not be established.')
        await hydrate(user)
      } finally {
        signingIn.current = false
      }
    },
    [hydrate],
  )

  const signOut = useCallback(async () => {
    const { auth } = requireFirebase()
    generation.current += 1
    await logoutTeamSession().catch(() => undefined)
    await firebaseSignOut(auth).catch(() => undefined)
    setContext(null)
    setStatus('signedOut')
  }, [])

  const value = useMemo<TeamAuthValue>(
    () => ({
      status,
      context,
      sessionMessage,
      signIn,
      signOut,
      clearSessionMessage: () => setSessionMessage(null),
    }),
    [status, context, sessionMessage, signIn, signOut],
  )

  return <TeamAuthContext.Provider value={value}>{children}</TeamAuthContext.Provider>
}

export type { FriendlyError }
