// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import {
  computeCaptainBonusPoints,
  computeCaptainPoints,
  isStarPlayerFlag,
} from '@shared/money'
import { computeTeamSummary, validateEventConsistency } from '@shared/calculations'
import { planReversal } from '@shared/purchases'
import { evaluateTeamQualification } from '@shared/rounds'
import { makeEvent, makePlayer, makePurchase, makeTeam } from '@shared/fixtures'
import { ToastProvider } from '@/components/ui/Toast'
import { TeamPanelPage } from '@/features/teamPanel/TeamPanelPage'
import type { EventDoc, PurchaseDoc, TeamDoc } from '@shared/types'

const mockSelectTeamCaptain = vi.fn()

let mockEvent: EventDoc = makeEvent({
  status: 'active',
  currentRound: 2,
  roundPhase: 'round2_active',
  captainSelectionEnabled: false,
})
let mockTeam: TeamDoc = makeTeam('t1', {
  name: 'TEAM 01',
  totalPoints: 18,
  playerCount: 2,
})
const mockPurchases: PurchaseDoc[] = [
  makePurchase('pur-1', {
    playerId: 'p-reg',
    teamId: 't1',
    playerNameSnapshot: 'Regular Batter',
    playerPointsSnapshot: 9,
    playerStarSnapshot: null,
    playerRoleSnapshot: 'Batter',
  }),
  makePurchase('pur-2', {
    playerId: 'p-star',
    teamId: 't1',
    playerNameSnapshot: 'Star Allrounder',
    playerPointsSnapshot: 9,
    playerStarSnapshot: 'yes',
    playerRoleSnapshot: 'All Rounder',
  }),
]

vi.mock('@/auth/TeamAuthProvider', () => ({
  useTeamAuth: () => ({
    context: {
      eventId: 'default',
      eventName: 'Nexturn Premier League',
      currencyLabel: '₹',
      eventStatus: 'active',
      teamId: 't1',
      teamName: 'TEAM 01',
      logoUrl: null,
      expiresAt: Date.now() + 3_600_000,
    },
    signOut: vi.fn(),
  }),
}))

vi.mock('@/services/team', () => ({
  selectTeamCaptain: (...args: unknown[]) => mockSelectTeamCaptain(...args),
  getTeamSquadMeta: vi.fn(),
  getTeamLineup: vi.fn(),
}))

vi.mock('@/lib/realtime', () => ({
  subscribeToAuctionRealtime: () => () => {},
}))

vi.mock('@/data/hooks', () => ({
  useTeamDoc: () => ({ data: mockTeam, loading: false, error: null, fromCache: false }),
  useTeamEvent: () => ({ data: mockEvent, loading: false, error: null, fromCache: false }),
  useTeamPurchases: () => ({ data: mockPurchases, loading: false, error: null, fromCache: false }),
  useTeamLineup: () => ({ data: [], loading: false, error: null, fromCache: false }),
  useTeamSquadMeta: () => ({
    data: [
      { playerId: 'p-reg', star: null, role: 'Batter' },
      { playerId: 'p-star', star: 'yes', role: 'All Rounder' },
    ],
    loading: false,
    error: null,
    fromCache: false,
  }),
}))

function renderTeamPanel(initialPath = '/team') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <TeamPanelPage />
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('Captain points calculation & reconciliation', () => {
  it('doubles regular captain points (9 -> 18) and multiplies star captain points by 2.5 (9 -> 22.5)', () => {
    expect(isStarPlayerFlag(null)).toBe(false)
    expect(isStarPlayerFlag('yes')).toBe(true)
    expect(computeCaptainPoints(9, false)).toBe(18)
    expect(computeCaptainBonusPoints(9, false)).toBe(9)
    expect(computeCaptainPoints(9, true)).toBe(22.5)
    expect(computeCaptainBonusPoints(9, true)).toBe(13.5)
  })

  it('increases only the captain points during Round 2 evaluation and reconciles consistency checks', () => {
    const team = makeTeam('t1', {
      name: 'Royals',
      startingPurse: 1_250_000_000,
      totalSpent: 40_000_000,
      remainingPurse: 1_210_000_000,
      playerCount: 11,
      captainPlayerId: 'p-star',
      captainBonusPoints: 13.5,
      // 10 other players at 8 pts + 1 star captain at 9 pts => base 89 + 13.5 bonus = 102.5
      totalPoints: 102.5,
    })

    const squad = [
      ...Array.from({ length: 4 }, (_, i) =>
        makePlayer(`bat-${i}`, {
          role: 'Batter',
          points: 8,
          rating: 8,
          status: 'sold',
          soldToTeamId: 't1',
          purchaseId: `pur-bat-${i}`,
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makePlayer(`bowl-${i}`, {
          role: 'Bowler',
          points: 8,
          rating: 8,
          status: 'sold',
          soldToTeamId: 't1',
          purchaseId: `pur-bowl-${i}`,
        }),
      ),
      makePlayer('ar-1', {
        role: 'All Rounder',
        points: 8,
        rating: 8,
        status: 'sold',
        soldToTeamId: 't1',
        purchaseId: 'pur-ar-1',
      }),
      makePlayer('wk-1', {
        role: 'Wicket Keeper',
        points: 8,
        rating: 8,
        status: 'sold',
        soldToTeamId: 't1',
        purchaseId: 'pur-wk-1',
      }),
      makePlayer('p-star', {
        name: 'Star Captain',
        role: 'All Rounder',
        points: 9,
        rating: 9,
        star: 'yes',
        status: 'sold',
        soldToTeamId: 't1',
        purchaseId: 'pur-star',
      }),
    ]

    const purchases = squad.map((p, idx) =>
      makePurchase(p.purchaseId!, {
        playerId: p.id,
        teamId: 't1',
        playerNameSnapshot: p.name,
        playerPointsSnapshot: p.points,
        playerStarSnapshot: p.star ?? null,
        finalPrice: idx === 0 ? 30_000_000 : 1_000_000,
      }),
    )

    const evalRes = evaluateTeamQualification(team, squad)
    expect(evalRes.qualified).toBe(true)
    expect(evalRes.totalPoints).toBe(102.5)
    expect(evalRes.captainPlayerName).toBe('Star Captain')
    expect(evalRes.captainIsStar).toBe(true)

    const summary = computeTeamSummary(
      team.startingPurse,
      purchases.map((p) => ({ finalPrice: p.finalPrice, points: p.playerPointsSnapshot })),
      13.5,
    )
    expect(summary.totalPoints).toBe(102.5)

    const consistency = validateEventConsistency({
      event: makeEvent({ status: 'active' }),
      teams: [team],
      players: squad,
      purchases,
    })
    expect(consistency.ok).toBe(true)
  })

  it('clears captain bonus cleanly if the captain purchase is reversed', () => {
    const team = makeTeam('t1', {
      startingPurse: 100_000_000,
      totalSpent: 20_000_000,
      remainingPurse: 80_000_000,
      playerCount: 2,
      captainPlayerId: 'p-star',
      captainBonusPoints: 13.5,
      totalPoints: 30.5, // 8 base + 9*2.5 (22.5)
    })
    const player = makePlayer('p-star', {
      points: 9,
      star: 'yes',
      status: 'sold',
      soldToTeamId: 't1',
      purchaseId: 'pur-star',
    })
    const purchase = makePurchase('pur-star', {
      playerId: 'p-star',
      teamId: 't1',
      playerPointsSnapshot: 9,
      finalPrice: 10_000_000,
    })

    const plan = planReversal(
      { eventId: 'default', purchaseId: 'pur-star', reason: 'Operator correction', actorUid: 'admin' },
      { event: makeEvent({ status: 'active' }), purchase, player, team, auditLogId: 'aud-1' },
    )
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.result.teamSummary.totalPoints).toBe(8)
      const teamWrite = plan.writes.find((w) => w.kind === 'team')
      expect(teamWrite?.data.captainPlayerId).toBeNull()
      expect(teamWrite?.data.captainBonusPoints).toBe(0)
    }
  })
})

describe('TeamPanelPage Captain selection & Rules page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEvent = makeEvent({
      status: 'active',
      currentRound: 2,
      roundPhase: 'round2_active',
      captainSelectionEnabled: false,
    })
    mockTeam = makeTeam('t1', {
      name: 'TEAM 01',
      totalPoints: 18,
      playerCount: 2,
      captainPlayerId: null,
      captainBonusPoints: 0,
    })
  })

  it('keeps captain selection disabled until the admin unlocks it in Round 2', () => {
    renderTeamPanel()
    expect(screen.queryByRole('button', { name: /Choose Regular Batter as captain/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Captain Selection Unlocked/i)).not.toBeInTheDocument()
  })

  it('lets Round 2 teams click a squad player photo when unlocked to choose their regular or star captain', async () => {
    const user = userEvent.setup()
    mockEvent = makeEvent({
      status: 'active',
      currentRound: 2,
      roundPhase: 'round2_active',
      captainSelectionEnabled: true,
    })
    mockSelectTeamCaptain.mockResolvedValue({
      ok: true,
      captainPlayerId: 'p-star',
      captainPlayerName: 'Star Allrounder',
      isStar: true,
      multiplier: 2.5,
      basePoints: 9,
      captainPoints: 22.5,
      bonusPoints: 13.5,
      totalPoints: 31.5,
    })

    renderTeamPanel()
    expect(screen.getByText(/Captain Selection Unlocked/i)).toBeInTheDocument()

    // Click Star Allrounder's photo
    await user.click(screen.getByRole('button', { name: /Choose Star Allrounder as captain/i }))
    expect(screen.getByText(/Appoint Team Captain/i)).toBeInTheDocument()
    expect(screen.getByText('22.5')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Choose as Captain/i }))
    expect(mockSelectTeamCaptain).toHaveBeenCalledWith('p-star')
  })

  it('provides a 3rd Rules page covering round, elimination, captain, and star player rules', async () => {
    const user = userEvent.setup()
    renderTeamPanel()

    await user.click(screen.getByRole('button', { name: /Open menu/i }))
    const rulesBtn = screen.getByRole('button', { name: /Rules/i })
    expect(rulesBtn).toBeInTheDocument()

    fireEvent.click(rulesBtn)
    expect(screen.getByText(/Official Auction & Scoring Rules/i)).toBeInTheDocument()
    expect(screen.getByText(/Two-Round Auction Structure/i)).toBeInTheDocument()
    expect(screen.getByText(/Squad Qualification & Elimination Rules/i)).toBeInTheDocument()
    expect(screen.getByText(/Captain & Star Player Rules/i)).toBeInTheDocument()
    expect(screen.getByText(/Example: 9 pts → 18 pts/i)).toBeInTheDocument()
    expect(screen.getByText(/Example: 9 pts \(★ Star\) → 22\.5 pts/i)).toBeInTheDocument()
  })
})
