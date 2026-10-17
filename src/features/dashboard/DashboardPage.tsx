import { useMemo } from 'react'
import { Link, useOutletContext } from 'react-router'
import { AlertTriangle, ArrowRight, PlusCircle } from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { useAuditLogs, usePlayers, usePurchases, useTeams } from '@/data/hooks'
import { currency, formatRelative, points as formatPoints } from '@/lib/format'
import { SectionTitle } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader, CardTitle, StatCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, Skeleton } from '@/components/ui/Feedback'
import { Pill, PurchaseStatusPill } from '@/components/ui/StatusPill'
import { AUDIT_ACTION_LABELS } from '@/lib/labels'

export function DashboardPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()

  const teams = useTeams(eventId)
  const players = usePlayers(eventId)
  const purchases = usePurchases(eventId, 8)
  const auditLogs = useAuditLogs(eventId, 8)

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
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          {auditLogs.loading ? (
            <CardBody className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </CardBody>
          ) : auditLogs.data.length === 0 ? (
            <EmptyState title="No activity yet" description="Admin actions appear here for the audit trail." />
          ) : (
            <ul className="divide-y divide-line">
              {auditLogs.data.map((log) => (
                <li key={log.id} className="px-4 py-2.5 sm:px-5">
                  <p className="text-[13px] text-ink">
                    {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <Pill tone={log.actorRole === 'system' ? 'neutral' : 'info'}>
                      {log.actorEmail ?? (log.actorRole === 'system' ? 'system' : log.actorUid.slice(0, 8))}
                    </Pill>
                    {formatRelative(log.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <SectionTitle className="mt-8">Teams overview</SectionTitle>
      <div className="mt-3 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {teams.data.map((team) => (
          <Card key={team.id} className="p-4 transition-all hover:border-line-strong hover:bg-surface-elevated/70">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-bold text-white">{team.name}</p>
              {team.active ? null : <Pill tone="neutral">Inactive</Pill>}
            </div>
            <p className="mt-1.5 text-xl font-extrabold tabular-nums text-accent">
              {currency(team.remainingPurse, currencyLabel)}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              spent <span className="text-ink font-medium">{currency(team.totalSpent, currencyLabel)}</span> ·{' '}
              <span className="font-semibold text-sky-400">{formatPoints(team.totalPoints)} pts</span> ·{' '}
              {team.playerCount} player{team.playerCount === 1 ? '' : 's'}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}
