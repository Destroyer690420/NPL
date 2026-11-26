import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { BookOpen, Coffee, Crown, Home, LogOut, Menu, RefreshCw, Star, Trophy, Users, X } from 'lucide-react'
import { useTeamAuth } from '@/auth/TeamAuthProvider'
import { useTeamDoc, useTeamEvent, useTeamLineup, useTeamPurchases, useTeamSquadMeta } from '@/data/hooks'
import { currency, points as formatPoints } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isStar } from '@/lib/playerBadges'
import { computeCaptainPoints } from '@shared/money'
import type { PurchaseDoc } from '@shared/types'
import { selectTeamCaptain } from '@/services/team'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Pill } from '@/components/ui/StatusPill'
import { PlayerAvatar } from '@/components/ui/PlayerAvatar'
import { useToast } from '@/components/ui/Toast'
import { SpotlightPlayerCard } from '@/features/auction/SpotlightPlayerCard'
import { SoldPlayerCelebration } from '@/features/auction/SoldPlayerCelebration'
import { StartingInCountdownScreen } from '@/features/auction/StartingInCountdownScreen'
import { AuctionBreakScreen } from '@/features/auction/AuctionBreakScreen'
import { TeamLineupView } from './TeamLineupView'
import { TeamRulesView } from './TeamRulesView'
import { subscribeToAuctionRealtime } from '@/lib/realtime'

/**
 * The private team panel: one team's purse, spend, points and roster, live.
 * Reads are limited server-side to this team's own documents and are
 * re-validated against the server session on every read.
 */
export function TeamPanelPage() {
  const auth = useTeamAuth()
  const context = auth.context
  const toast = useToast()

  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const activeTab: 'home' | 'lineup' | 'rules' =
    rawTab === 'lineup' ? 'lineup' : rawTab === 'rules' ? 'rules' : 'home'

  function setActiveTab(tab: 'home' | 'lineup' | 'rules') {
    const next = new URLSearchParams(searchParams)
    if (tab === 'home') {
      next.delete('tab')
    } else {
      next.set('tab', tab)
    }
    setSearchParams(next, { replace: true })
  }

  const team = useTeamDoc(context?.eventId ?? null, context?.teamId ?? null)
  const eventLive = useTeamEvent(context?.eventId ?? null)
  const purchases = useTeamPurchases(context?.eventId ?? null, context?.teamId ?? null, 200)
  const lineup = useTeamLineup(context?.eventId ?? null)
  const squadMeta = useTeamSquadMeta(context?.eventId ?? null, context?.teamId ?? null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [captainCandidate, setCaptainCandidate] = useState<PurchaseDoc | null>(null)
  const [savingCaptain, setSavingCaptain] = useState(false)
  const [optimisticCaptain, setOptimisticCaptain] = useState<{
    captainPlayerId: string
    totalPoints: number
  } | null>(null)

  const squadMetaById = useMemo(
    () => new Map(squadMeta.data.map((m) => [m.playerId, m])),
    [squadMeta.data],
  )

  useEffect(() => {
    if (
      optimisticCaptain &&
      team.data?.captainPlayerId === optimisticCaptain.captainPlayerId &&
      team.data?.totalPoints === optimisticCaptain.totalPoints
    ) {
      setOptimisticCaptain(null)
    }
  }, [team.data?.captainPlayerId, team.data?.totalPoints, optimisticCaptain])

  useEffect(() => {
    if (!eventLive.data?.captainSelectionEnabled) {
      setCaptainCandidate(null)
    }
  }, [eventLive.data?.captainSelectionEnabled])

  // Subscribes to real-time auction broadcasts for instantaneous card display
  useEffect(() => {
    if (!context?.eventId) return
    const unsubscribe = subscribeToAuctionRealtime(context.eventId)
    return unsubscribe
  }, [context?.eventId])

  // A revoked/expired session (or a deactivated team) surfaces as a read
  // failure; end the local session so the PIN screen explains what happened.
  useEffect(() => {
    const failure = team.error ?? purchases.error
    if (!failure) return
    if (
      failure.code === 'permission-denied' ||
      failure.code === 'session-expired' ||
      failure.code === 'session-revoked' ||
      failure.code === 'unauthenticated'
    ) {
      void auth.signOut()
    }
  }, [team.error, purchases.error, auth])

  useEffect(() => {
    if (!sidebarOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sidebarOpen])

  if (!context) return <LoadingBlock label="Loading your team…" />

  const currencyLabel = context.currencyLabel
  const teamData = team.data
  const fromCache = team.fromCache || purchases.fromCache
  const confirmed = purchases.data.filter((purchase) => purchase.status === 'confirmed')
  const teamDisplayName = teamData?.name || context.teamName

  const isEliminated = Boolean(eventLive.data?.eliminatedTeamIds?.includes(context.teamId))
  const isRound2Eligible =
    (eventLive.data?.currentRound ?? 0) === 2 &&
    !isEliminated &&
    eventLive.data?.status !== 'finalized'
  const canSelectCaptain = Boolean(eventLive.data?.captainSelectionEnabled && isRound2Eligible)
  const effectiveCaptainId = optimisticCaptain?.captainPlayerId ?? teamData?.captainPlayerId ?? null
  const displayedTeamPoints = optimisticCaptain?.totalPoints ?? teamData?.totalPoints ?? 0

  function isPurchaseStar(purchase: PurchaseDoc): boolean {
    const meta = squadMetaById.get(purchase.playerId)
    return isStar(meta?.star ?? purchase.playerStarSnapshot)
  }

  function purchaseRoleLabel(purchase: PurchaseDoc): string | null {
    const meta = squadMetaById.get(purchase.playerId)
    return meta?.role ?? purchase.playerRoleSnapshot ?? null
  }

  async function handleConfirmCaptain() {
    if (!captainCandidate) return
    setSavingCaptain(true)
    try {
      const res = await selectTeamCaptain(captainCandidate.playerId)
      setOptimisticCaptain({
        captainPlayerId: res.captainPlayerId,
        totalPoints: res.totalPoints,
      })
      setCaptainCandidate(null)
      toast.push({
        kind: 'success',
        message: `${res.captainPlayerName} appointed Captain (${res.multiplier}×)!`,
        detail: `Captain points: ${formatPoints(res.basePoints)} → ${formatPoints(res.captainPoints)} pts`,
      })
    } catch (err) {
      toast.push({ kind: 'error', message: isCallError(err) ? err.message : errorMessage(err) })
    } finally {
      setSavingCaptain(false)
    }
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-6 sm:px-6">
      {/* Top Navbar */}
      <header className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-line-strong bg-surface-elevated/90 px-4 py-3 shadow-xl backdrop-blur-md sm:px-5">
        <div className="flex min-w-0 items-center">
          <span className="truncate font-['Outfit',sans-serif] text-base sm:text-lg font-black tracking-wide text-white">
            {teamDisplayName}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="flex size-9 items-center justify-center rounded-xl border border-line-strong bg-surface-muted/80 text-ink-muted transition-all hover:border-accent hover:bg-surface-muted hover:text-white active:scale-95 cursor-pointer"
        >
          <Menu className="size-4.5" aria-hidden />
        </button>
      </header>

      {/* Sidebar Overlay and Drawer */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />

          {/* Drawer Panel */}
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Team menu"
            className="relative z-10 flex h-full w-full max-w-xs flex-col border-l border-line-strong bg-[#0e121a] p-5 shadow-2xl sm:max-w-sm"
          >
            {/* Header: Auction name on top */}
            <div className="flex items-start justify-between border-b border-line pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-4 w-1 rounded-full bg-accent shadow-[0_0_8px_rgba(245,175,25,0.6)]" aria-hidden />
                  <p className="text-[11px] font-bold uppercase tracking-wider text-accent-light">Auction</p>
                </div>
                <h2 className="mt-1 text-lg font-black tracking-tight text-white">{context.eventName}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {context.eventStatus === 'active' ? (
                    <Pill tone="success">Auction live</Pill>
                  ) : context.eventStatus === 'finalized' ? (
                    <Pill tone="neutral">Finalized</Pill>
                  ) : (
                    <Pill tone="warning">Not started</Pill>
                  )}
                  {fromCache ? (
                    <Pill tone="warning" className="gap-1">
                      <RefreshCw className="size-3 animate-spin" aria-hidden />
                      Updating…
                    </Pill>
                  ) : (
                    <Pill tone="success">Live</Pill>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close menu"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink-muted transition-colors hover:text-white cursor-pointer"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            {/* Content / Options */}
            <div className="flex-1 space-y-4 overflow-y-auto py-5">
              {/* Navigation Pages: Home & Lineup */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted px-1">Navigation</p>
                
                {/* 1. Home Page Button */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('home')
                    setSidebarOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left transition-all cursor-pointer border',
                    activeTab === 'home'
                      ? 'border-accent/50 bg-accent/15 text-accent shadow-[0_0_15px_rgba(245,175,25,0.15)] font-bold'
                      : 'border-line/60 bg-surface-muted/40 text-ink-muted hover:border-line-strong hover:bg-surface-muted hover:text-white',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Home
                      className={cn('size-4.5', activeTab === 'home' ? 'text-accent' : 'text-ink-muted')}
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-bold text-white leading-tight">Home</p>
                      <p className="text-[11px] text-ink-muted leading-tight mt-0.5">Team purse & your squad</p>
                    </div>
                  </div>
                  {activeTab === 'home' ? (
                    <span className="size-2 rounded-full bg-accent animate-pulse" />
                  ) : null}
                </button>

                {/* 2. Lineup Page Button */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('lineup')
                    setSidebarOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left transition-all cursor-pointer border',
                    activeTab === 'lineup'
                      ? 'border-accent/50 bg-accent/15 text-accent shadow-[0_0_15px_rgba(245,175,25,0.15)] font-bold'
                      : 'border-line/60 bg-surface-muted/40 text-ink-muted hover:border-line-strong hover:bg-surface-muted hover:text-white',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Users
                      className={cn('size-4.5', activeTab === 'lineup' ? 'text-accent' : 'text-ink-muted')}
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-bold text-white leading-tight">Lineup</p>
                      <p className="text-[11px] text-ink-muted leading-tight mt-0.5">Available auction players</p>
                    </div>
                  </div>
                  {lineup.data.length > 0 ? (
                    <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                      {lineup.data.length}
                    </span>
                  ) : activeTab === 'lineup' ? (
                    <span className="size-2 rounded-full bg-accent animate-pulse" />
                  ) : null}
                </button>

                {/* 3. Rules Page Button */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('rules')
                    setSidebarOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left transition-all cursor-pointer border',
                    activeTab === 'rules'
                      ? 'border-accent/50 bg-accent/15 text-accent shadow-[0_0_15px_rgba(245,175,25,0.15)] font-bold'
                      : 'border-line/60 bg-surface-muted/40 text-ink-muted hover:border-line-strong hover:bg-surface-muted hover:text-white',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <BookOpen
                      className={cn('size-4.5', activeTab === 'rules' ? 'text-accent' : 'text-ink-muted')}
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-bold text-white leading-tight">Rules</p>
                      <p className="text-[11px] text-ink-muted leading-tight mt-0.5">Round, elimination &amp; captain rules</p>
                    </div>
                  </div>
                  {activeTab === 'rules' ? (
                    <span className="size-2 rounded-full bg-accent animate-pulse" />
                  ) : null}
                </button>
              </div>
            </div>

            {/* Bottom: Sign out button */}
            <div className="border-t border-line pt-4">
              <Button
                variant="secondary"
                block
                size="lg"
                icon={<LogOut className="size-4" aria-hidden />}
                onClick={() => {
                  setSidebarOpen(false)
                  void auth.signOut()
                }}
              >
                Sign out
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Main Page Area: Render Break Screen, Countdown Screen, Lineup, or Home Dashboard */}
      {eventLive.data?.break?.active && activeTab === 'home' ? (
        <AuctionBreakScreen
          breakState={eventLive.data.break}
          eventName={context.eventName}
          onViewLineup={() => setActiveTab('lineup')}
        />
      ) : eventLive.data?.countdown?.targetTime && activeTab === 'home' ? (
        <StartingInCountdownScreen
          countdown={eventLive.data.countdown}
          eventName={context.eventName}
          onViewLineup={() => setActiveTab('lineup')}
        />
      ) : activeTab === 'lineup' ? (
        <>
          {eventLive.data?.break?.active ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              <div className="flex items-center gap-2">
                <Coffee className="size-4 shrink-0 text-amber-400" />
                <span className="font-bold">Auction Intermission Active — "We will be back soon"</span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setActiveTab('home')}>
                Return to Break Screen
              </Button>
            </div>
          ) : eventLive.data?.countdown?.targetTime ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-accent" />
                </span>
                <span className="font-bold">Auction countdown is ticking down</span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setActiveTab('home')}>
                Return to Countdown
              </Button>
            </div>
          ) : null}
          <TeamLineupView players={lineup.data} loading={lineup.loading} />
        </>
      ) : activeTab === 'rules' ? (
        <TeamRulesView />
      ) : (
        <>
          {eventLive.data?.eliminatedTeamIds?.includes(context.teamId) ? (
            <div className="mb-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              <p className="font-bold text-rose-300">Eliminated in Round 1</p>
              <p className="mt-0.5 text-xs text-rose-200/80">
                {eventLive.data.round1Results?.results.find((r) => r.teamId === context.teamId)?.missingSummary ||
                  'Your team did not meet the Round 1 qualification criteria and cannot bid in Round 2.'}
              </p>
            </div>
          ) : null}

          {teamData ? (
            <div className="overflow-hidden rounded-2xl border border-line-strong bg-gradient-to-br from-[#181c26] via-[#12151f] to-[#1c101d] p-6 shadow-2xl">
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                    Remaining purse
                  </p>
                  <span className="text-xs font-semibold text-accent-light">
                    {teamData.startingPurse > 0
                      ? `${Math.round((teamData.remainingPurse / teamData.startingPurse) * 100)}% left`
                      : '0%'}
                  </span>
                </div>
                <p className="mt-1 text-4xl font-extrabold tabular-nums tracking-tight text-white sm:text-5xl">
                  {currency(teamData.remainingPurse, currencyLabel)}
                </p>
                <p className="mt-1.5 text-xs text-ink-muted">
                  Started with <span className="text-ink font-medium">{currency(teamData.startingPurse, currencyLabel)}</span> · spent{' '}
                  <span className="text-ink font-medium">{currency(teamData.totalSpent, currencyLabel)}</span>
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-muted/80">
                  <div
                    className="h-full rounded-full bg-accent shadow-[0_0_12px_rgba(245,175,25,0.8)] transition-all duration-500"
                    style={{
                      width: `${
                        teamData.startingPurse > 0
                          ? Math.min(100, Math.max(0, Math.round((teamData.remainingPurse / teamData.startingPurse) * 100)))
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
              <div className="mt-6 grid grid-cols-3 divide-x divide-line rounded-xl border border-line/60 bg-surface-muted/30">
                <div className="px-3 py-3.5 text-center sm:px-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Points</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-white sm:text-2xl">
                    {formatPoints(displayedTeamPoints)}
                  </p>
                </div>
                <div className="px-3 py-3.5 text-center sm:px-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Players</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-white sm:text-2xl">{teamData.playerCount}</p>
                </div>
                <div className="px-3 py-3.5 text-center sm:px-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Spent</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-white sm:text-2xl">
                    {currency(teamData.totalSpent, currencyLabel)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <Card>
              <CardBody>
                <LoadingBlock label="Loading your purse…" />
              </CardBody>
            </Card>
          )}

          {canSelectCaptain ? (
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-accent/60 bg-gradient-to-r from-accent/15 via-amber-500/10 to-transparent px-4 py-3.5 shadow-[0_0_24px_rgba(245,175,25,0.14)]">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-accent/50 bg-accent/20 text-accent">
                <Crown className="size-4.5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-black uppercase tracking-wide text-accent">
                  Captain Selection Unlocked
                </p>
                <p className="mt-0.5 text-xs text-ink-muted leading-relaxed">
                  Click any player&apos;s photo in your squad below to choose your Round 2 Captain (
                  <strong className="text-white">2×</strong> points, or{' '}
                  <strong className="text-amber-300">2.5×</strong> for ★ Star players).
                </p>
              </div>
            </div>
          ) : null}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-accent" aria-hidden />
                Your squad
              </CardTitle>
              <span className="text-xs font-semibold text-ink-muted">{confirmed.length} confirmed</span>
            </CardHeader>
            {purchases.loading ? (
              <CardBody>
                <LoadingBlock label="Loading roster…" />
              </CardBody>
            ) : confirmed.length === 0 ? (
              <EmptyState
                icon={<Trophy className="size-8 text-accent/60" aria-hidden />}
                title="No players yet"
                description="When your team buys a player, they appear here instantly with the price you paid."
              />
            ) : (
              <ul className="divide-y divide-line">
                {confirmed.map((purchase) => {
                  const isCaptain = Boolean(effectiveCaptainId && purchase.playerId === effectiveCaptainId)
                  const starPlayer = isPurchaseStar(purchase)
                  const roleLabel = purchaseRoleLabel(purchase)
                  const displayPoints = isCaptain
                    ? computeCaptainPoints(purchase.playerPointsSnapshot, starPlayer)
                    : purchase.playerPointsSnapshot

                  return (
                    <li
                      key={purchase.id}
                      className={cn(
                        'flex items-center gap-3.5 px-4 py-3.5 transition-colors sm:px-5',
                        isCaptain ? 'bg-accent/10' : 'hover:bg-surface-muted/20',
                      )}
                    >
                      {canSelectCaptain ? (
                        <button
                          type="button"
                          onClick={() => setCaptainCandidate(purchase)}
                          aria-label={`Choose ${purchase.playerNameSnapshot} as captain`}
                          title="Tap photo to choose as Captain"
                          className={cn(
                            'group relative shrink-0 rounded-full p-0.5 transition-transform active:scale-95 cursor-pointer',
                            isCaptain
                              ? 'ring-2 ring-accent shadow-[0_0_15px_rgba(245,175,25,0.5)]'
                              : 'hover:ring-2 hover:ring-accent/70',
                          )}
                        >
                          <PlayerAvatar
                            name={purchase.playerNameSnapshot}
                            photoUrl={purchase.playerPhotoUrlSnapshot}
                            size="md"
                          />
                          <span
                            className={cn(
                              'absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border text-[10px] font-black shadow',
                              isCaptain
                                ? 'border-black bg-accent text-black'
                                : 'border-accent/70 bg-[#121620] text-accent opacity-90 group-hover:opacity-100',
                            )}
                          >
                            {isCaptain ? 'C' : <Crown className="size-2.5" aria-hidden />}
                          </span>
                        </button>
                      ) : (
                        <div className="relative shrink-0">
                          <PlayerAvatar
                            name={purchase.playerNameSnapshot}
                            photoUrl={purchase.playerPhotoUrlSnapshot}
                            size="md"
                          />
                          {isCaptain ? (
                            <span
                              title="Team Captain"
                              className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-black bg-accent text-[10px] font-black text-black shadow"
                            >
                              C
                            </span>
                          ) : null}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-bold text-white">{purchase.playerNameSnapshot}</p>
                          {isCaptain ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-black">
                              <Crown className="size-2.5" aria-hidden />
                              Captain ({starPlayer ? '2.5×' : '2×'})
                            </span>
                          ) : null}
                          {starPlayer ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                              <Star className="size-2.5 fill-amber-300" aria-hidden />
                              Star
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          <span className={cn('font-semibold', isCaptain ? 'text-accent' : 'text-sky-400')}>
                            {formatPoints(displayPoints)} pts
                          </span>
                          {isCaptain ? (
                            <span className="ml-1.5 text-[11px] text-ink-muted">
                              (base {formatPoints(purchase.playerPointsSnapshot)})
                            </span>
                          ) : null}
                          {roleLabel ? <span className="ml-1.5 text-ink-muted">· {roleLabel}</span> : null}
                        </p>
                      </div>
                      <p className="text-base font-extrabold tabular-nums text-accent">
                        {currency(purchase.finalPrice, currencyLabel)}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* Choose Captain Modal (only reachable when admin unlocks Captain Selection in Round 2) */}
          <Dialog
            open={captainCandidate !== null && canSelectCaptain}
            onClose={() => !savingCaptain && setCaptainCandidate(null)}
            title="Appoint Team Captain"
            description="Only your Captain receives the points multiplier (2× regular, 2.5× Star Player). All other players keep their base points."
            size="sm"
            footer={
              captainCandidate ? (
                <>
                  <Button
                    variant="ghost"
                    disabled={savingCaptain}
                    onClick={() => setCaptainCandidate(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    loading={savingCaptain}
                    icon={<Crown className="size-4" aria-hidden />}
                    onClick={() => void handleConfirmCaptain()}
                  >
                    {effectiveCaptainId === captainCandidate.playerId
                      ? 'Keep as Captain'
                      : 'Choose as Captain'}
                  </Button>
                </>
              ) : undefined
            }
          >
            {captainCandidate ? (
              (() => {
                const candStar = isPurchaseStar(captainCandidate)
                const candMult = candStar ? '2.5×' : '2×'
                const boosted = computeCaptainPoints(captainCandidate.playerPointsSnapshot, candStar)
                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3.5 rounded-xl border border-line-strong bg-surface-muted/50 p-3.5">
                      <PlayerAvatar
                        name={captainCandidate.playerNameSnapshot}
                        photoUrl={captainCandidate.playerPhotoUrlSnapshot}
                        size="lg"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-base font-extrabold text-white">
                          {captainCandidate.playerNameSnapshot}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {candStar ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-200">
                              <Star className="size-3 fill-amber-300" aria-hidden />
                              Star Player ({candMult})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                              Regular Captain ({candMult})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-xl border border-accent/35 bg-accent/10 p-3.5 text-center">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                          Base Points
                        </p>
                        <p className="mt-0.5 font-['Outfit',sans-serif] text-2xl font-black text-white tabular-nums">
                          {formatPoints(captainCandidate.playerPointsSnapshot)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-accent">
                          Captain Points ({candMult})
                        </p>
                        <p className="mt-0.5 font-['Outfit',sans-serif] text-2xl font-black text-accent tabular-nums">
                          {formatPoints(boosted)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })()
            ) : null}
          </Dialog>
        </>
      )}

      {/* Live Auction Spotlight Player Card - remains active across all views */}
      <SpotlightPlayerCard
        spotlight={eventLive.data?.spotlightPlayer ?? null}
        currencyLabel={currencyLabel}
      />

      {/* Sold Player Celebration Animation Overlay - plays on every team screen when a player is sold */}
      <SoldPlayerCelebration currencyLabel={currencyLabel} />
    </div>
  )
}
