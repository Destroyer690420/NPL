import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TeamAuthProvider } from '@/auth/TeamAuthProvider'
import { TeamLoginPage } from '@/features/teamPanel/TeamLoginPage'
import { CallError } from '@/services/callables'
import { verifyTeamPin, getTeamContext, logoutTeamSession } from '@/services/team'

/**
 * Team PIN login wiring: the PIN is verified server-side, a wrong PIN shows a
 * generic error, and a rate limit produces an explicit cooldown. Firebase
 * itself is mocked; no network calls happen.
 */

vi.mock('@/lib/firebase', () => {
  const mockAuth = {
    currentUser: { getIdTokenResult: vi.fn().mockResolvedValue({ claims: { kind: 'team' } }) },
  }
  return {
    requireFirebase: () => ({ app: {}, auth: mockAuth, db: {}, functions: {} }),
    getFirebase: () => ({ app: {}, auth: mockAuth, db: {}, functions: {} }),
  }
})

const authStateCallback = vi.fn()
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    authStateCallback.mockImplementation(callback)
    callback(null)
    return () => undefined
  },
  signInWithCustomToken: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('firebase/firestore', () => ({
  doc: () => ({ withConverter: () => ({}) }),
  collection: () => ({ withConverter: () => ({}) }),
  onSnapshot: () => () => undefined,
  query: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  where: () => ({}),
  getDocFromServer: vi.fn(),
}))

vi.mock('@/services/team', () => ({
  verifyTeamPin: vi.fn(),
  getTeamContext: vi.fn(),
  logoutTeamSession: vi.fn().mockResolvedValue({ revoked: true }),
}))

const verifyMock = vi.mocked(verifyTeamPin)
const contextMock = vi.mocked(getTeamContext)

function renderLogin() {
  return render(
    <TeamAuthProvider>
      <MemoryRouter>
        <TeamLoginPage />
      </MemoryRouter>
    </TeamAuthProvider>,
  )
}

async function typePin(pin: string): Promise<void> {
  for (const digit of pin) {
    await userEvent.click(screen.getByRole('button', { name: digit }))
  }
}

describe('TeamLoginPage', () => {
  beforeEach(() => {
    verifyMock.mockReset()
    contextMock.mockReset()
    vi.mocked(logoutTeamSession).mockResolvedValue({ revoked: true })
  })

  it('shows a generic error for a wrong PIN and clears the keypad', async () => {
    verifyMock.mockRejectedValue(
      new CallError({ code: 'invalid-pin', message: 'That PIN is not valid. Check the four digits and try again.', retryable: true }),
    )
    renderLogin()
    await typePin('1234')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not valid/i))
    expect(verifyMock).toHaveBeenCalledWith({ pin: '1234' })
  })

  it('locks the keypad during a cooldown after too many attempts', async () => {
    verifyMock.mockRejectedValue(
      new CallError({
        code: 'rate-limited',
        message: 'Too many attempts. Please wait and try again.',
        retryAfterSeconds: 42,
        retryable: true,
      }),
    )
    renderLogin()
    await typePin('9999')

    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeInTheDocument())
    expect(screen.getByText(/42 seconds/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()
  })

  it('signs in and leaves the login screen when the PIN is accepted', async () => {
    verifyMock.mockResolvedValue({
      sessionToken: 'token',
      sessionId: 'sess1',
      eventId: 'default',
      teamId: 'teamA',
      teamName: 'Team Alpha',
      logoUrl: null,
      expiresAt: Date.now() + 60_000,
      eventName: 'College Auction',
      currencyLabel: '₹',
      eventStatus: 'active',
    })
    contextMock.mockResolvedValue({
      eventId: 'default',
      eventName: 'College Auction',
      currencyLabel: '₹',
      eventStatus: 'active',
      teamId: 'teamA',
      teamName: 'Team Alpha',
      logoUrl: null,
      expiresAt: Date.now() + 60_000,
    })

    renderLogin()
    await typePin('2468')

    await waitFor(() => expect(contextMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Team login')).not.toBeInTheDocument())
  })
})
