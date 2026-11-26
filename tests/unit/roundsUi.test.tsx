import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { Round1ResultsStage, Round2FinalResultsStage } from '@/features/auction/RoundResultsViews'
import { RoundControlsBar } from '@/features/auction/RoundControlsBar'
import { ToastProvider } from '@/components/ui/Toast'
import { makeEvent, makePlayer, makeTeam } from '@shared/fixtures'
import type { RoundSnapshot } from '@shared/types'

vi.mock('@/services/admin', () => ({
  startRound1: vi.fn(),
  endRound1: vi.fn(),
  startRound2: vi.fn(),
  endRound2: vi.fn(),
}))

describe('Round1ResultsStage', () => {
  it('displays Eliminated Teams with missed criteria and Qualified Teams advancing to Round 2', () => {
    const snapshot: RoundSnapshot = {
      round: 1,
      endedAt: '2026-11-26T12:00:00.000Z',
      poolSize: 187,
      qualifiedTeamIds: ['t-q'],
      eliminatedTeamIds: ['t-e'],
      results: [
        {
          teamId: 't-q',
          teamName: 'Royals',
          qualified: true,
          playerCount: 11,
          batCount: 4,
          bowlCount: 4,
          arCount: 2,
          wkCount: 1,
          totalPoints: 95.5,
          totalSpent: 800_000_000,
          remainingPurse: 200_000_000,
          missingPlayers: 0,
          missingBat: 0,
          missingBowl: 0,
          missingAr: 0,
          missingWk: 0,
          missingReasons: [],
          missingSummary: '',
        },
        {
          teamId: 't-e',
          teamName: 'Warriors',
          qualified: false,
          playerCount: 9,
          batCount: 4,
          bowlCount: 4,
          arCount: 1,
          wkCount: 0,
          totalPoints: 70,
          totalSpent: 600_000_000,
          remainingPurse: 400_000_000,
          missingPlayers: 2,
          missingBat: 0,
          missingBowl: 0,
          missingAr: 0,
          missingWk: 1,
          missingReasons: ['2 more players', '1 WK'],
          missingSummary: 'Needs 2 more players, 1 WK',
        },
      ],
    }

    render(<Round1ResultsStage snapshot={snapshot} eventName="NPL 2026" />)

    expect(screen.getByText(/Eliminated Teams/i)).toBeInTheDocument()
    expect(screen.getByText('Warriors')).toBeInTheDocument()
    expect(screen.getByText('Needs 2 more players, 1 WK')).toBeInTheDocument()
    expect(screen.getByText(/Advancing to Round 2/i)).toBeInTheDocument()
    expect(screen.getByText('Royals')).toBeInTheDocument()
  })
})

describe('Round2FinalResultsStage', () => {
  it('highlights the #1 ranked qualified team as NPL Winner and lists disqualified teams separately', () => {
    const snapshot: RoundSnapshot = {
      round: 2,
      endedAt: '2026-11-26T15:00:00.000Z',
      poolSize: 132,
      qualifiedTeamIds: ['t-win', 't-2'],
      eliminatedTeamIds: ['t-dq'],
      results: [
        {
          teamId: 't-win',
          teamName: 'Titans',
          qualified: true,
          playerCount: 11,
          batCount: 4,
          bowlCount: 4,
          arCount: 2,
          wkCount: 1,
          totalPoints: 102.5,
          totalSpent: 1_100_000_000,
          remainingPurse: 150_000_000,
          missingPlayers: 0,
          missingBat: 0,
          missingBowl: 0,
          missingAr: 0,
          missingWk: 0,
          missingReasons: [],
          missingSummary: '',
        },
        {
          teamId: 't-2',
          teamName: 'Knights',
          qualified: true,
          playerCount: 11,
          batCount: 3,
          bowlCount: 5,
          arCount: 2,
          wkCount: 1,
          totalPoints: 98,
          totalSpent: 1_000_000_000,
          remainingPurse: 250_000_000,
          missingPlayers: 0,
          missingBat: 0,
          missingBowl: 0,
          missingAr: 0,
          missingWk: 0,
          missingReasons: [],
          missingSummary: '',
        },
        {
          teamId: 't-dq',
          teamName: 'Strikers',
          qualified: false,
          playerCount: 10,
          batCount: 3,
          bowlCount: 4,
          arCount: 2,
          wkCount: 1,
          totalPoints: 85,
          totalSpent: 900_000_000,
          remainingPurse: 350_000_000,
          missingPlayers: 1,
          missingBat: 0,
          missingBowl: 0,
          missingAr: 0,
          missingWk: 0,
          missingReasons: ['1 more player'],
          missingSummary: 'Needs 1 more player',
        },
      ],
    }

    render(<Round2FinalResultsStage snapshot={snapshot} eventName="NPL 2026" currencyLabel="₹" />)

    expect(screen.getByText(/NPL WINNER/i)).toBeInTheDocument()
    expect(screen.getAllByText('Titans').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Knights')).toBeInTheDocument()
    expect(screen.getByText(/Disqualified Teams/i)).toBeInTheDocument()
    expect(screen.getByText('Strikers')).toBeInTheDocument()
    expect(screen.getByText('Needs 1 more player')).toBeInTheDocument()
  })
})

describe('RoundControlsBar', () => {
  it('opens confirmation modal before ending Round 1 and enables Start Round 2 after Round 1 ends', async () => {
    const teams = [makeTeam('t1', { name: 'Titans' })]
    const players = [makePlayer('p1', { name: 'Rohit Sharma', role: 'Batter', points: 9 })]

    const { rerender } = render(
      <MemoryRouter>
        <ToastProvider>
          <RoundControlsBar
            eventId="default"
            event={makeEvent({ roundPhase: 'not_started', currentRound: 0 })}
            players={players}
            teams={teams}
          />
        </ToastProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Start Round 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start Round 2' })).toBeDisabled()

    rerender(
      <MemoryRouter>
        <ToastProvider>
          <RoundControlsBar
            eventId="default"
            event={makeEvent({ roundPhase: 'round1_active', currentRound: 1, roundPoolPlayerIds: ['p1'] })}
            players={players}
            teams={teams}
          />
        </ToastProvider>
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'End Round 1' }))
    expect(screen.getByText('End Round 1?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm End Round 1' })).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <ToastProvider>
          <RoundControlsBar
            eventId="default"
            event={makeEvent({
              roundPhase: 'round1_ended',
              currentRound: 1,
              qualifiedTeamIds: ['t1'],
            })}
            players={players}
            teams={teams}
          />
        </ToastProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Start Round 2' })).toBeEnabled()
  })
})
