import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Home, LogOut, Menu, RefreshCw, Trophy, Users, X } from 'lucide-react'
import { useTeamAuth } from '@/auth/TeamAuthProvider'
import { useTeamDoc, useTeamEvent, useTeamLineup, useTeamPurchases } from '@/data/hooks'
import { currency, points as formatPoints } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Pill } from '@/components/ui/StatusPill'
import { PlayerAvatar } from '@/components/ui/PlayerAvatar'
import { SpotlightPlayerCard } from '@/features/auction/SpotlightPlayerCard'
import { TeamLineupView } from './TeamLineupView'
import { subscribeToAuctionRealtime } from '@/lib/realtime'

function getTeamInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'TM'
  const words = trimmed.split(/\s+/)
  if (words.length >= 2) {
    return words.slice(0, 3).map((w) => w[0]?.toUpperCase() ?? '').join('')
  }
  if (trimmed.length <= 4) {
    return trimmed.toUpperCase()
  }
  return trimmed.slice(0, 3).toUpperCase()
}

/**
 * The private team panel: one team's purse, spend, points and roster, live.
 * Reads are limited server-side to this team's own documents and are
 * re-validated against the server session on every read.
 */
export function TeamPanelPage() {
  const auth = useTeamAuth()
  const context = auth.context

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'lineup' ? 'lineup' : 'home'

  function setActiveTab(tab: 'home' | 'lineup') {
    const next = new URLSearchParams(searchParams)
    if (tab === 'home') {
      next.delete('tab')
    } else {
      next.set('tab', 'lineup')
    }
    setSearchParams(next, { replace: true })
  }

  const team = useTeamDoc(context?.eventId ?? null, context?.teamId ?? null)
  const eventLive = useTeamEvent(context?.eventId ?? null)
  const purchases = useTeamPurchases(context?.eventId ?? null, context?.teamId ?? null, 200)
  const lineup = useTeamLineup(context?.eventId ?? null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
  const teamInitials = getTeamInitials(context.teamName)

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-6 sm:px-6">
      {/* Top Navbar */}
      <header className="mb-6 flex items-center justify-between rounded-2xl border border-line-strong bg-surface-elevated/90 px-4 py-3 shadow-xl backdrop-blur-md sm:px-5">
        <div className="flex items-center gap-3">
          <span className="font-['Outfit',sans-serif] text-lg font-black tracking-wider text-white uppercase">
            {teamInitials}
          </span>
          <span className="text-line-strong">/</span>
          <span className="text-sm font-bold text-ink-muted capitalize">
            {activeTab === 'home' ? 'Home' : 'Lineup'}
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

      {/* Main Page Area: Render either Lineup or Home Dashboard */}
      {activeTab === 'lineup' ? (
        <TeamLineupView players={lineup.data} loading={lineup.loading} />
      ) : (
        <>
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
                    {formatPoints(teamData.totalPoints)}
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
                {confirmed.map((purchase) => (
                  <li key={purchase.id} className="flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-surface-muted/20 sm:px-5">
                    <PlayerAvatar
                      name={purchase.playerNameSnapshot}
                      photoUrl={purchase.playerPhotoUrlSnapshot}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">{purchase.playerNameSnapshot}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        <span className="font-semibold text-sky-400">{formatPoints(purchase.playerPointsSnapshot)} pts</span>
                      </p>
                    </div>
                    <p className="text-base font-extrabold tabular-nums text-accent">
                      {currency(purchase.finalPrice, currencyLabel)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {/* Live Auction Spotlight Player Card - remains active across all views */}
      <SpotlightPlayerCard
        spotlight={eventLive.data?.spotlightPlayer ?? null}
        currencyLabel={currencyLabel}
      />
    </div>
  )
}
