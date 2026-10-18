import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { AlertTriangle, ArrowRight, Coffee, Play, PlusCircle, Timer, X } from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { usePlayers, usePurchases, useTeams } from '@/data/hooks'
import { currency, formatRelative, points as formatPoints } from '@/lib/format'
import { Card, CardBody, CardHeader, CardTitle, StatCard } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { InputField } from '@/components/ui/Field'
import { EmptyState, Skeleton } from '@/components/ui/Feedback'
import { Pill, PurchaseStatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { setAuctionBreak, setAuctionCountdown, updateEvent } from '@/services/admin'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'

export function DashboardPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const toast = useToast()

  const teams = useTeams(eventId)
  const players = usePlayers(eventId)
  const purchases = usePurchases(eventId, 8)

  // Live Screen Controls State
  const [countdownDialogOpen, setCountdownDialogOpen] = useState(false)
  const [breakDialogOpen, setBreakDialogOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  // Countdown form state
  const [countdownMinutes, setCountdownMinutes] = useState(5)
  const [countdownSeconds, setCountdownSeconds] = useState(0)
  const [countdownMessage, setCountdownMessage] = useState('Auction Starting In')

  // Break form state
  const [breakMessage, setBreakMessage] = useState('We will be back soon')
  const [breakResumeTime, setBreakResumeTime] = useState('')

  // Live ticking timer for admin bar display
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!event?.countdown?.targetTime) return
    const interval = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(interval)
  }, [event?.countdown?.targetTime])

  const countdownDiff = useMemo(() => {
    if (!event?.countdown?.targetTime) return 0
    return Math.max(0, new Date(event.countdown.targetTime).getTime() - now)
  }, [event?.countdown?.targetTime, now])

  const remainingMins = Math.floor(countdownDiff / 60000)
  const remainingSecs = Math.floor((countdownDiff % 60000) / 1000)

  async function handleStartCountdown() {
    const totalSecs = countdownMinutes * 60 + countdownSeconds
    if (totalSecs <= 0) {
      toast.push({ kind: 'error', message: 'Countdown time must be at least 1 second.' })
      return
    }
    setActionBusy(true)
    try {
      const targetTime = new Date(Date.now() + totalSecs * 1000).toISOString()
      await setAuctionCountdown({
        eventId,
        targetTime,
        durationSeconds: totalSecs,
        message: countdownMessage.trim() || 'Auction Starting In',
      })
      setCountdownDialogOpen(false)
      toast.push({
        kind: 'success',
        message: 'Countdown started! Showing "Starting in..." on all team screens.',
      })
    } catch (err) {
      toast.push({ kind: 'error', message: errorMessage(err) })
    } finally {
      setActionBusy(false)
    }
  }

  async function handleCancelCountdown() {
    setActionBusy(true)
    try {
      await setAuctionCountdown({
        eventId,
        targetTime: null,
        durationSeconds: null,
      })
      toast.push({ kind: 'info', message: 'Countdown timer cancelled.' })
    } catch (err) {
      toast.push({ kind: 'error', message: errorMessage(err) })
    } finally {
      setActionBusy(false)
    }
  }

  async function handleStartBreak() {
    setActionBusy(true)
    try {
      await setAuctionBreak({
        eventId,
        active: true,
        message: breakMessage.trim() || 'We will be back soon',
        resumeTime: breakResumeTime.trim() || null,
      })
      setBreakDialogOpen(false)
      toast.push({
        kind: 'success',
        message: 'Break screen activated! All team screens now display "We will be back soon".',
      })
    } catch (err) {
      toast.push({ kind: 'error', message: errorMessage(err) })
    } finally {
      setActionBusy(false)
    }
  }

  async function handleEndBreak() {
    setActionBusy(true)
    try {
      await setAuctionBreak({
        eventId,
        active: false,
      })
      toast.push({ kind: 'success', message: 'Break ended. Team screens returned to live view.' })
    } catch (err) {
      toast.push({ kind: 'error', message: errorMessage(err) })
    } finally {
      setActionBusy(false)
    }
  }

  async function handleStartAuctionNow() {
    setActionBusy(true)
    try {
      if (event?.countdown?.targetTime) {
        await setAuctionCountdown({ eventId, targetTime: null, durationSeconds: null })
      }
      await updateEvent({ eventId, status: 'active' })
      toast.push({ kind: 'success', message: 'The auction is now live!' })
    } catch (err) {
      toast.push({ kind: 'error', message: errorMessage(err) })
    } finally {
      setActionBusy(false)
    }
  }

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
        text: 'The auction has not started yet. You can start the countdown timer or start the auction now.',
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
      {/* Live Auction Broadcast & Screen Intermission Control Bar */}
      <div className="mb-6 rounded-2xl border border-line-strong bg-surface/90 p-4 shadow-xl backdrop-blur-md sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
              </span>
              <p className="text-xs font-black uppercase tracking-wider text-accent">Auction Broadcast & Screens</p>
            </div>
            <h2 className="mt-1 text-lg font-black text-white">Live Screen Controls</h2>
            <p className="text-xs text-ink-muted">
              Display a live "Starting in" countdown or intermission break on all team phones in real time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {event?.countdown?.targetTime ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-2 rounded-xl border border-accent/50 bg-accent/15 px-3.5 py-1.5 shadow-[0_0_15px_rgba(245,175,25,0.2)]">
                  <Timer className="size-4 text-accent animate-pulse" />
                  <span className="text-xs font-bold text-white">
                    {countdownDiff > 0 ? (
                      <>
                        Starting in{' '}
                        <span className="text-accent font-mono font-black tabular-nums">
                          {String(remainingMins).padStart(2, '0')}:{String(remainingSecs).padStart(2, '0')}
                        </span>
                      </>
                    ) : (
                      <span className="text-emerald-400 font-bold">Timer Finished</span>
                    )}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="dangerOutline"
                  loading={actionBusy}
                  onClick={() => void handleCancelCountdown()}
                  icon={<X className="size-3.5" />}
                >
                  Cancel Timer
                </Button>
                {event.status === 'setup' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={actionBusy}
                    onClick={() => void handleStartAuctionNow()}
                    icon={<Play className="size-3.5" />}
                  >
                    Start Auction Now
                  </Button>
                ) : null}
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={<Timer className="size-4 text-accent" />}
                onClick={() => setCountdownDialogOpen(true)}
              >
                Start Timer (Starting in...)
              </Button>
            )}

            {event?.break?.active ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/15 px-3.5 py-1.5 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                  <Coffee className="size-4 text-amber-400 animate-bounce" />
                  <span className="text-xs font-bold text-amber-200">
                    Break Active ({event.break.message})
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  loading={actionBusy}
                  onClick={() => void handleEndBreak()}
                  icon={<Play className="size-3.5" />}
                >
                  End Break & Resume
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={<Coffee className="size-4 text-amber-400" />}
                onClick={() => setBreakDialogOpen(true)}
              >
                Break Screen
              </Button>
            )}
          </div>
        </div>
      </div>

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

      {/* Starting in Countdown Dialog */}
      <Dialog
        open={countdownDialogOpen}
        onClose={() => setCountdownDialogOpen(false)}
        title="Start Auction Countdown"
        description="Set a countdown timer before the auction begins. Every team screen will display a synchronized 'Starting in...' countdown."
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button
              variant="secondary"
              onClick={() => setCountdownDialogOpen(false)}
              disabled={actionBusy}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Timer className="size-4" />}
              loading={actionBusy}
              onClick={() => void handleStartCountdown()}
            >
              Start Countdown
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-ink-soft mb-1.5">
              Quick Duration Presets
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { label: '1 min', mins: 1, secs: 0 },
                { label: '2 min', mins: 2, secs: 0 },
                { label: '3 min', mins: 3, secs: 0 },
                { label: '5 min', mins: 5, secs: 0 },
                { label: '10 min', mins: 10, secs: 0 },
                { label: '15 min', mins: 15, secs: 0 },
              ].map((preset) => {
                const isSelected = countdownMinutes === preset.mins && countdownSeconds === preset.secs
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setCountdownMinutes(preset.mins)
                      setCountdownSeconds(preset.secs)
                    }}
                    className={cn(
                      'rounded-xl border py-2 px-2.5 text-xs font-bold transition-all',
                      isSelected
                        ? 'border-accent bg-accent/20 text-accent shadow-[0_0_12px_rgba(245,175,25,0.25)]'
                        : 'border-line bg-surface-muted/60 text-ink-muted hover:border-line-strong hover:text-white',
                    )}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputField
              label="Minutes"
              type="number"
              min={0}
              max={180}
              value={countdownMinutes}
              onChange={(e) => setCountdownMinutes(Math.max(0, parseInt(e.target.value) || 0))}
            />
            <InputField
              label="Seconds"
              type="number"
              min={0}
              max={59}
              value={countdownSeconds}
              onChange={(e) => setCountdownSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
            />
          </div>

          <InputField
            label="Banner Message"
            placeholder="e.g. Auction Starting In"
            value={countdownMessage}
            onChange={(e) => setCountdownMessage(e.target.value)}
            hint="This header will appear above the countdown clock on every team screen."
          />

          <div className="rounded-xl border border-line bg-surface-muted/40 p-3.5 text-xs text-ink-muted flex items-start gap-2.5">
            <Timer className="size-4 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white">Live Sync Active</p>
              <p className="text-[11px] leading-relaxed mt-0.5">
                When started, teams can still browse the auction lineup by tapping &ldquo;Preview Lineup&rdquo; on the countdown screen.
              </p>
            </div>
          </div>
        </div>
      </Dialog>

      {/* Break / Intermission Dialog */}
      <Dialog
        open={breakDialogOpen}
        onClose={() => setBreakDialogOpen(false)}
        title="Activate Auction Break"
        description="Pause the auction and broadcast an intermission screen to all team screens saying 'We will be back soon'."
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button
              variant="secondary"
              onClick={() => setBreakDialogOpen(false)}
              disabled={actionBusy}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Coffee className="size-4" />}
              loading={actionBusy}
              onClick={() => void handleStartBreak()}
            >
              Activate Break Screen
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <InputField
            label="Screen Message"
            placeholder="We will be back soon"
            value={breakMessage}
            onChange={(e) => setBreakMessage(e.target.value)}
            hint="Main headline shown in large text on all team devices."
          />

          <div>
            <label className="block text-[13px] font-medium text-ink-soft mb-1.5">
              Quick Estimated Return
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: '5 Mins', value: 'in 5 minutes' },
                { label: '10 Mins', value: 'in 10 minutes' },
                { label: '15 Mins', value: 'in 15 minutes' },
                { label: 'Clear', value: '' },
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setBreakResumeTime(chip.value)}
                  className={cn(
                    'rounded-xl border py-2 px-2 text-xs font-bold transition-all',
                    breakResumeTime === chip.value && chip.value !== ''
                      ? 'border-amber-400 bg-amber-400/20 text-amber-300'
                      : 'border-line bg-surface-muted/60 text-ink-muted hover:border-line-strong hover:text-white',
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          <InputField
            label="Estimated Return Note (Optional)"
            placeholder="e.g. in 10 minutes or after tea break"
            value={breakResumeTime}
            onChange={(e) => setBreakResumeTime(e.target.value)}
            hint="Sub-message informing teams when to expect the auction to resume."
          />

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200/90 flex items-start gap-2.5">
            <Coffee className="size-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white">Full Screen Intermission</p>
              <p className="text-[11px] leading-relaxed mt-0.5 text-amber-200/80">
                While on break, all team screens show &ldquo;We will be back soon&rdquo; with smooth animated visual effects and a button to view the player lineup.
              </p>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
