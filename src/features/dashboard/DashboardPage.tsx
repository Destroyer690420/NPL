import { useMemo } from 'react'
import { Link, useOutletContext } from 'react-router'
import { AlertTriangle, ArrowRight, PlusCircle } from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { usePlayers, usePurchases, useTeams } from '@/data/hooks'
import { currency, formatRelative, points as formatPoints } from '@/lib/format'
import { Card, CardBody, CardHeader, CardTitle, StatCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, Skeleton } from '@/components/ui/Feedback'
import { Pill, PurchaseStatusPill } from '@/components/ui/StatusPill'

export function DashboardPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()

  const teams = useTeams(eventId)
  const players = usePlayers(eventId)
  const purchases = usePurchases(eventId, 8)

  // Totals are derived from the full team and player documents (purchase
  // listeners are intentionally capped, so they are not a totals source).
  const totals = useMemo(() => {
    const list = players.data
    return {
      teamCount: teams.data.length,
      activeTeamCount: teams.data.filter((team) => team.active).length,
      playerCount: list.length,
      availableCount: list.filter((player) => player.status === 'available').length,
      soldCount: list.filter((player) => player.status === 'sold').length,
      totalSpent: teams.data.reduce((sum, team) => sum + team.totalSpent, 0),
      totalPoints: teams.data.reduce((sum, team) => sum + team.totalPoints, 0),
    }
  }, [teams.data, players.data])

  const currencyLabel = event?.currencyLabel ?? '₹'

  const warnings = useMemo(() => {
    const list: Array<{ tone: 'warn' | 'danger'; text: string; to?: string; linkLabel?: string }> = []
    if (!event) return list
    if (event.status === 'setup') {
      list.push({
        tone: 'warn',
        text: 'The auction has not started yet. Teams cannot see live results until you start it in Settings.',
        to: '/admin/settings',
        linkLabel: 'Open settings',
      })
    }
    if (event.status === 'active' && !event.purchasesEnabled) {
      list.push({
        tone: 'warn',
        text: 'Recording purchases is paused. Re-enable it in Settings to keep selling.',
        to: '/admin/settings',
        linkLabel: 'Open settings',
      })
    }
    if (teams.data.length === 0) {
      list.push({ tone: 'warn', text: 'No teams yet. Add teams before selling.', to: '/admin/teams', linkLabel: 'Add team' })
    }
    if (players.data.length === 0) {
      list.push({
        tone: 'warn',
        text: 'No players yet. Add players or import a CSV before selling.',
        to: '/admin/players',
        linkLabel: 'Add players',
      })
    }
    const brokeTeams = teams.data.filter((team) => team.active && team.remainingPurse === 0)
    if (brokeTeams.length > 0) {
      list.push({
        tone: 'warn',
        text: `${brokeTeams.length === 1 ? brokeTeams[0]!.name : `${brokeTeams.length} teams`} no longer ha${brokeTeams.length === 1 ? 's' : 've'} purse left.`,
      })
    }
    return list
  }, [event, teams.data, players.data])

  const loading = teams.loading && players.loading && purchases.loading

  return (
    <div>
      {warnings.length > 0 ? (
        <div className="mb-6 space-y-2.5">
          {warnings.map((warning, index) => (
            <div
              key={index}
              className={
                warning.tone === 'danger'
                  ? 'flex flex-wrap items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-300'
                  : 'flex flex-wrap items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-300'
              }
            >
              <AlertTriangle className="size-4 shrink-0 text-amber-400" aria-hidden />
              <span className="flex-1">{warning.text}</span>
              {warning.to ? (
                <Link to={warning.to} className="text-xs font-bold uppercase tracking-wider text-amber-200 underline underline-offset-4 hover:text-white">
                  {warning.linkLabel ?? 'Open'} →
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Teams" value={formatPoints(totals.teamCount)} hint={`${totals.activeTeamCount} active`} />
        <StatCard label="Players" value={formatPoints(totals.playerCount)} />
        <StatCard label="Available" value={formatPoints(totals.availableCount)} />
        <StatCard label="Sold" value={formatPoints(totals.soldCount)} tone="accent" />
        <StatCard label="Total spend" value={currency(totals.totalSpent, currencyLabel)} tone="accent" />
        <StatCard label="Points sold" value={formatPoints(totals.totalPoints)} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent purchases</CardTitle>
            <Link to="/admin/transactions" className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              View all <ArrowRight className="size-3" aria-hidden />
            </Link>
          </CardHeader>
          {loading ? (
            <CardBody className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardBody>
          ) : purchases.data.length === 0 ? (
            <EmptyState
              title="No purchases yet"
              description="When you sell a player, it appears here instantly."
              action={
                <Link to="/admin/purchases/new">
                  <Button size="sm" icon={<PlusCircle className="size-3.5" aria-hidden />}>
                    Record the first purchase
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {purchases.data.map((purchase) => (
                <li key={purchase.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {purchase.playerNameSnapshot}
                      <span className="font-normal text-muted"> → {purchase.teamNameSnapshot}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {formatPoints(purchase.playerPointsSnapshot)} pts · {formatRelative(purchase.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {currency(purchase.finalPrice, currencyLabel)}
                    </p>
                    <PurchaseStatusPill status={purchase.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Teams overview</CardTitle>
            <Link to="/admin/teams" className="text-xs font-semibold text-ink-muted transition-colors hover:text-accent">
              View all →
            </Link>
          </CardHeader>
          {teams.loading ? (
            <CardBody className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardBody>
          ) : teams.data.length === 0 ? (
            <EmptyState
              title="No teams yet"
              description="Add teams before recording purchases."
              action={
                <Link to="/admin/teams">
                  <Button size="sm">Add team</Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {teams.data.map((team) => (
                <li key={team.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/teams/${team.id}`} className="truncate text-sm font-bold text-white hover:text-accent hover:underline">
                        {team.name}
                      </Link>
                      {!team.active ? <Pill tone="neutral">Inactive</Pill> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {team.playerCount} player{team.playerCount === 1 ? '' : 's'} ·{' '}
                      <span className="font-semibold text-sky-400">{formatPoints(team.totalPoints)} pts</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold tabular-nums text-accent">
                      {currency(team.remainingPurse, currencyLabel)}
                    </p>
                    <p className="text-[11px] text-muted">
                      spent {currency(team.totalSpent, currencyLabel)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
