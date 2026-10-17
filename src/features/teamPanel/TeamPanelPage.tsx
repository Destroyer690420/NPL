import { useEffect } from 'react'
import { LogOut, RefreshCw, Trophy, Users } from 'lucide-react'
import { useTeamAuth } from '@/auth/TeamAuthProvider'
import { useTeamDoc, useTeamPurchases } from '@/data/hooks'
import { currency, formatDateTime, points as formatPoints } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Pill } from '@/components/ui/StatusPill'

/**
 * The private team panel: one team's purse, spend, points and roster, live.
 * Reads are limited server-side to this team's own documents and are
 * re-validated against the server session on every read.
 */
export function TeamPanelPage() {
  const auth = useTeamAuth()
  const context = auth.context

  const team = useTeamDoc(context?.eventId ?? null, context?.teamId ?? null)
  const purchases = useTeamPurchases(context?.eventId ?? null, context?.teamId ?? null, 200)

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

  if (!context) return <LoadingBlock label="Loading your team…" />

  const currencyLabel = context.currencyLabel
  const teamData = team.data
  const fromCache = team.fromCache || purchases.fromCache
  const confirmed = purchases.data.filter((purchase) => purchase.status === 'confirmed')

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-3.5">
        {context.logoUrl ? (
          <img
            src={context.logoUrl}
            alt=""
            className="size-12 rounded-xl border border-line-strong object-cover shadow-md"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span className="flex size-12 items-center justify-center rounded-xl border border-line-strong bg-surface-muted text-base font-bold text-accent shadow-md">
            {context.teamName.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-4 w-1 rounded-full bg-accent shadow-[0_0_8px_rgba(230,0,110,0.6)]" aria-hidden />
            <h1 className="truncate text-xl font-bold tracking-tight text-white">{context.teamName}</h1>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <span>{context.eventName}</span>
            <span className="text-line-strong">•</span>
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
        <Button
          variant="secondary"
          size="sm"
          icon={<LogOut className="size-3.5" aria-hidden />}
          onClick={() => void auth.signOut()}
        >
          Sign out
        </Button>
      </header>

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
                className="h-full rounded-full bg-accent shadow-[0_0_12px_rgba(230,0,110,0.8)] transition-all duration-500"
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
                {purchase.playerPhotoUrlSnapshot ? (
                  <img
                    src={purchase.playerPhotoUrlSnapshot}
                    alt=""
                    className="size-11 rounded-xl border border-line-strong object-cover shadow-sm"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none'
                    }}
                  />
                ) : (
                  <span className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface-muted text-sm font-bold text-accent">
                    {purchase.playerNameSnapshot.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">{purchase.playerNameSnapshot}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    <span className="font-semibold text-sky-400">{formatPoints(purchase.playerPointsSnapshot)} pts</span> · {formatDateTime(purchase.createdAt)}
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

      <p className="mt-6 text-center text-xs text-ink-muted">
        This page is private to your team. Only your purse, points and roster are visible — never
        other teams' data.
      </p>
    </div>
  )
}
