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
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-5 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        {context.logoUrl ? (
          <img
            src={context.logoUrl}
            alt=""
            className="size-11 rounded-full border border-line object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span className="flex size-11 items-center justify-center rounded-full bg-charcoal text-sm font-semibold text-white">
            {context.teamName.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-ink">{context.teamName}</h1>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {context.eventName}
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
          </p>
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
        <Card className="overflow-hidden">
          <div className="bg-charcoal px-5 py-5 text-white">
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/60">
              Remaining purse
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight">
              {currency(teamData.remainingPurse, currencyLabel)}
            </p>
            <p className="mt-1 text-xs text-white/60">
              Started with {currency(teamData.startingPurse, currencyLabel)} · spent{' '}
              {currency(teamData.totalSpent, currencyLabel)}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-accent"
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
          <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
            <div className="px-4 py-3.5 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted">Points</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                {formatPoints(teamData.totalPoints)}
              </p>
            </div>
            <div className="px-4 py-3.5 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted">Players</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{teamData.playerCount}</p>
            </div>
            <div className="px-4 py-3.5 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted">Spent</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                {currency(teamData.totalSpent, currencyLabel)}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <LoadingBlock label="Loading your purse…" />
          </CardBody>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-muted" aria-hidden />
            Your squad
          </CardTitle>
          <span className="text-xs text-muted">{confirmed.length} confirmed</span>
        </CardHeader>
        {purchases.loading ? (
          <CardBody>
            <LoadingBlock label="Loading roster…" />
          </CardBody>
        ) : confirmed.length === 0 ? (
          <EmptyState
            icon={<Trophy className="size-8" aria-hidden />}
            title="No players yet"
            description="When your team buys a player, they appear here instantly with the price you paid."
          />
        ) : (
          <ul className="divide-y divide-line">
            {confirmed.map((purchase) => (
              <li key={purchase.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                {purchase.playerPhotoUrlSnapshot ? (
                  <img
                    src={purchase.playerPhotoUrlSnapshot}
                    alt=""
                    className="size-10 rounded-full border border-line object-cover"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none'
                    }}
                  />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-full bg-info-soft text-sm font-semibold text-ink-soft">
                    {purchase.playerNameSnapshot.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{purchase.playerNameSnapshot}</p>
                  <p className="text-xs text-muted">
                    {formatPoints(purchase.playerPointsSnapshot)} points · {formatDateTime(purchase.createdAt)}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-accent">
                  {currency(purchase.finalPrice, currencyLabel)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-5 text-center text-xs text-muted">
        This page is private to your team. Only your purse, points and roster are visible — never
        other teams' data.
      </p>
    </div>
  )
}
