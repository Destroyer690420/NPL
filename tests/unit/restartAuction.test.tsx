import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { ToastProvider } from '@/components/ui/Toast'
import { makeEvent, makePlayer, makePurchase, makeTeam } from '@shared/fixtures'

const mockRestartAuction = vi.fn().mockResolvedValue({ ok: true, eventId: 'default' })

vi.mock('@/auth/AdminAuthProvider', () => ({
  useAdminAuth: () => ({ role: 'superAdmin' }),
}))

vi.mock('@/app/AdminEventProvider', () => ({
  useAdminEvent: () => ({
    event: makeEvent({ status: 'active', currentRound: 2, roundPhase: 'round2_ended' }),
    eventId: 'default',
    loading: false,
    error: null,
    fromCache: false,
  }),
}))

vi.mock('@/data/hooks', () => ({
  useTeams: () => ({
    data: [makeTeam('t1', { name: 'Team 01' })],
    loading: false,
    error: null,
    fromCache: false,
  }),
  usePlayers: () => ({
    data: [makePlayer('p1', { status: 'sold', soldToTeamId: 't1' })],
    loading: false,
    error: null,
    fromCache: false,
  }),
  usePurchases: () => ({
    data: [makePurchase('pur-1', { playerId: 'p1', teamId: 't1' })],
    loading: false,
    error: null,
    fromCache: false,
  }),
  usePublicConfig: () => ({
    data: { defaultEventId: 'default', eventName: 'NPL', currencyLabel: '₹', eventStatus: 'active', updatedAt: null },
    loading: false,
    error: null,
    fromCache: false,
  }),
}))

vi.mock('@/services/admin', () => ({
  checkEventConsistency: vi.fn(),
  createPlayer: vi.fn(),
  deletePlayersData: vi.fn(),
  deleteTeamsData: vi.fn(),
  deleteTransactionsData: vi.fn(),
  resetEventData: vi.fn(),
  restartAuction: (...args: unknown[]) => mockRestartAuction(...args),
  setDefaultEvent: vi.fn(),
  updateEvent: vi.fn(),
}))

function renderSettings() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/admin/settings']}>
        <Routes>
          <Route element={<Outlet context={{ eventId: 'default', admin: null }} />}>
            <Route path="/admin/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('SettingsPage Restart Auction (keep team names & PINs)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires RESTART confirmation and calls restartAuction to wipe purchases and rounds while keeping teams & PINs', async () => {
    const user = userEvent.setup()
    renderSettings()

    const openBtn = screen.getByRole('button', { name: /Restart auction/i })
    await user.click(openBtn)

    expect(screen.getByText(/Start auction all over again\?/i)).toBeInTheDocument()
    const confirmInput = screen.getByLabelText(/Type RESTART to confirm/i)
    const confirmButtons = screen.getAllByRole('button', { name: /Restart auction/i })
    const modalConfirmBtn = confirmButtons[confirmButtons.length - 1]!
    expect(modalConfirmBtn).toBeDisabled()

    await user.type(confirmInput, 'RESTART')
    expect(modalConfirmBtn).toBeEnabled()

    await user.click(modalConfirmBtn)
    expect(mockRestartAuction).toHaveBeenCalledWith('default')
  })
})
