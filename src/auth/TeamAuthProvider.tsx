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
import { appErrorMessage } from '@shared/errors'
import { toFriendlyError, type FriendlyError } from '@/lib/errors'
import {
  getTeamContext,
  logoutTeamSession,
  verifyTeamPin,
  type TeamContextResult,
} from '@/services/team'
import {
  clearStoredSession,
  readStoredSession,
  setSessionInvalidHandler,
  writeStoredSession,
} from '@/services/session'

/**
 * Team session authentication.
 *
 * `verifyTeamPin` checks the PIN server-side and issues an opaque session
 * token bound to one {eventId, teamId, sessionId}; only the token hash is
 * stored on the server. On reload the token is re-validated with
 * `getTeamContext`, and an expiry timer signs the team out locally right when
 * the server-side session ends.
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

const EXPIRED_MESSAGE = 'Your team session expired. Please enter your PIN again.'

export function TeamAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TeamAuthStatus>('loading')
  const [context, setContext] = useState<TeamContextResult | null>(null)
  const [sessionMessage, setSessionMessage] = useState<string | null>(null)
  const generation = useRef(0)

  const endSessionLocally = useCallback((message: string | null) => {
    generation.current += 1
    clearStoredSession('team')
    setContext(null)
    setStatus('signedOut')
    if (message) setSessionMessage(message)
  }, [])

  const hydrate = useCallback(async (): Promise<void> => {
    const run = generation.current
    try {
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
        endSessionLocally(friendly.message)
      } else {
        // Transient failure (network): do not discard the stored token; the
        // PIN screen explains the problem and a reload can recover.
        setStatus('signedOut')
        setSessionMessage('Could not reach the auction server. Check your connection and try again.')
      }
    }
  }, [endSessionLocally])

  // A session rejected by any API call (expired/revoked/deactivated) clears
  // the local session right away.
  useEffect(() => {
    setSessionInvalidHandler((scope, code) => {
      if (scope !== 'team') return
      endSessionLocally(code ? appErrorMessage(code).message : EXPIRED_MESSAGE)
    })
    return () => setSessionInvalidHandler(null)
  }, [endSessionLocally])

  useEffect(() => {
    const stored = readStoredSession('team')
    if (!stored) {
      setStatus('signedOut')
      return
    }
    setStatus('loading')
    void hydrate()
  }, [hydrate])

  // Local expiry timer: end the session exactly when the server-side session ends.
  useEffect(() => {
    if (status !== 'signedIn' || !context?.expiresAt) return
    const remaining = context.expiresAt - Date.now()
    if (remaining <= 0) {
      endSessionLocally(EXPIRED_MESSAGE)
      return
    }
    const timer = window.setTimeout(() => endSessionLocally(EXPIRED_MESSAGE), remaining)
    return () => window.clearTimeout(timer)
  }, [status, context?.expiresAt, endSessionLocally])

  const signIn = useCallback(async (pin: string) => {
    generation.current += 1
    setSessionMessage(null)
    const result = await verifyTeamPin({ pin })
    writeStoredSession('team', {
      token: result.sessionToken,
      expiresAt: typeof result.expiresAt === 'number' ? result.expiresAt : null,
      eventId: result.eventId,
      teamId: result.teamId,
    })
    setContext({
      eventId: result.eventId,
      eventName: result.eventName,
      currencyLabel: result.currencyLabel,
      eventStatus: result.eventStatus,
      teamId: result.teamId,
      teamName: result.teamName,
      logoUrl: result.logoUrl,
      expiresAt: typeof result.expiresAt === 'number' ? result.expiresAt : null,
    })
    setStatus('signedIn')
  }, [])

  const signOut = useCallback(async () => {
    generation.current += 1
    await logoutTeamSession().catch(() => undefined)
    clearStoredSession('team')
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
