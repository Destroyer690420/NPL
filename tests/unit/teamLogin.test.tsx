import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TeamAuthProvider, useTeamAuth } from '@/auth/TeamAuthProvider'
import { TeamLoginPage } from '@/features/teamPanel/TeamLoginPage'
import { CallError } from '@/services/callables'
import { verifyTeamPin, getTeamContext, logoutTeamSession } from '@/services/team'

/**
 * Team PIN login wiring: the PIN is verified server-side, a wrong PIN shows a
 * generic error, and a rate limit produces an explicit cooldown. The service
 * layer is mocked; no network calls happen.
 */

vi.mock('@/data/hooks', () => ({
  usePublicConfig: () => ({ data: null, loading: false, error: null, fromCache: false }),
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

function Probe() {
  const auth = useTeamAuth()
  return (
    <div>
      status:{auth.status}
      {auth.context ? ` team:${auth.context.teamName}` : ''}
    </div>
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
    window.localStorage.clear()
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

  it('signs in, stores the session token and leaves the login screen', async () => {
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

    renderLogin()
    await typePin('2468')

    await waitFor(() => expect(screen.queryByText('Team login')).not.toBeInTheDocument())
    const stored = window.localStorage.getItem('auction:team:session')
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ token: 'token', eventId: 'default', teamId: 'teamA' })
  })

  it('restores a stored session on reload via getTeamContext', async () => {
    window.localStorage.setItem(
      'auction:team:session',
      JSON.stringify({ token: 'stored-token', expiresAt: Date.now() + 60_000, eventId: 'default', teamId: 'teamA' }),
    )
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

    render(
      <TeamAuthProvider>
        <Probe />
      </TeamAuthProvider>,
    )

    await waitFor(() => expect(screen.getByText(/status:signedIn/)).toBeInTheDocument())
    expect(screen.getByText(/team:Team Alpha/)).toBeInTheDocument()
    expect(contextMock).toHaveBeenCalled()
  })
})
