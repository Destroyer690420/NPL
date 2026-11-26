import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { PresenterPage } from '@/features/auction/PresenterPage'
import { makeEvent, makePlayer, makeTeam } from '@shared/fixtures'
import type { EventDoc } from '@shared/types'

const mockPlayStageAmbientMusic = vi.fn().mockResolvedValue(true)
const mockStopStageAmbientMusic = vi.fn()
const mockPlayIplSoldTune = vi.fn().mockResolvedValue(true)
const mockStopIplSoldTune = vi.fn()

const stableTeams = [makeTeam('t1', { name: 'Team 01' })]
const stablePlayers = [makePlayer('p1', { name: 'Rohit Sharma', role: 'Batter', points: 9 })]
const stablePurchases: never[] = []

let currentEvent: EventDoc = makeEvent({ status: 'active' })

vi.mock('@/lib/auctionAudio', () => ({
  isAuctionAudioUnlocked: () => true,
  subscribeAuctionAudioState: (cb: (ready: boolean) => void) => {
    cb(true)
    return () => {}
  },
  unlockAuctionAudio: vi.fn().mockResolvedValue(true),
  playIplSoldTune: () => mockPlayIplSoldTune(),
  stopIplSoldTune: () => mockStopIplSoldTune(),
  playStageAmbientMusic: () => mockPlayStageAmbientMusic(),
  stopStageAmbientMusic: () => mockStopStageAmbientMusic(),
  playPlayerIntroCue: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/app/AdminEventProvider', () => ({
  useAdminEvent: () => ({
    event: currentEvent,
    eventId: 'default',
    loading: false,
    error: null,
    fromCache: false,
  }),
}))

vi.mock('@/data/hooks', () => ({
  useTeams: () => ({ data: stableTeams, loading: false, error: null, fromCache: false }),
  usePlayers: () => ({ data: stablePlayers, loading: false, error: null, fromCache: false }),
  usePurchases: () => ({ data: stablePurchases, loading: false, error: null, fromCache: false }),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => null,
}))

function PresenterRoutes() {
  return (
    <Routes>
      <Route element={<Outlet context={{ eventId: 'default', admin: null }} />}>
        <Route path="/admin/presenter" element={<PresenterPage />} />
      </Route>
    </Routes>
  )
}

function renderPresenter() {
  return render(
    <MemoryRouter initialEntries={['/admin/presenter']}>
      <PresenterRoutes />
    </MemoryRouter>,
  )
}

describe('PresenterPage stage ambient music', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    currentEvent = makeEvent({ status: 'active', presenterView: 'auto' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays ambient music on the Start Timer screen and stops when timer is cleared', () => {
    currentEvent = makeEvent({
      status: 'active',
      presenterView: 'auto',
      countdown: {
        targetTime: new Date(Date.now() + 120_000).toISOString(),
        durationSeconds: 120,
        startedAt: new Date().toISOString(),
        message: 'Auction Starting In',
      },
    })

    const { rerender } = renderPresenter()
    expect(screen.getByText(/Auction Starting In/i)).toBeInTheDocument()
    expect(mockPlayStageAmbientMusic).toHaveBeenCalledTimes(1)

    currentEvent = makeEvent({
      status: 'active',
      presenterView: 'auto',
      countdown: null,
    })

    rerender(
      <MemoryRouter initialEntries={['/admin/presenter']}>
        <PresenterRoutes />
      </MemoryRouter>,
    )
    expect(mockStopStageAmbientMusic).toHaveBeenCalled()
  })

  it('plays ambient music on the Break screen and stops when break ends', () => {
    currentEvent = makeEvent({
      status: 'active',
      presenterView: 'auto',
      break: {
        active: true,
        message: 'Short Break',
      },
    })

    const { rerender } = renderPresenter()
    expect(screen.getByRole('heading', { name: /Short Break/i })).toBeInTheDocument()
    expect(mockPlayStageAmbientMusic).toHaveBeenCalledTimes(1)

    currentEvent = makeEvent({
      status: 'active',
      presenterView: 'auto',
      break: { active: false, message: '' },
    })

    rerender(
      <MemoryRouter initialEntries={['/admin/presenter']}>
        <PresenterRoutes />
      </MemoryRouter>,
    )
    expect(mockStopStageAmbientMusic).toHaveBeenCalled()
  })
})
