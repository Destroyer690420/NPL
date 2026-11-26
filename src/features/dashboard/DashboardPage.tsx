import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Coffee,
  Eraser,
  ExternalLink,
  Flag,
  Gavel,
  Monitor,
  MonitorPlay,
  PauseCircle,
  Play,
  PlayCircle,
  Radio,
  RotateCcw,
  Search,
  ShieldAlert,
  ShoppingCart,
  SkipForward,
  Sparkles,
  Timer,
  Trophy,
  UserCheck,
  Volume2,
  X,
  XCircle,
} from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { usePlayers, useTeams } from '@/data/hooks'
import { currency, points as formatPoints } from '@/lib/format'
import { findNextUnprocessedIndex, normalizeRole } from '@shared/rounds'
import { ROUND_2_STARTING_PURSE } from '@shared/constants'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { InputField } from '@/components/ui/Field'
import { Combobox, type ComboboxItem } from '@/components/ui/Combobox'
import { useToast } from '@/components/ui/Toast'
import {
  clearSpotlightPlayer,
  endRound1,
  endRound2,
  markPlayerUnsold,
  sendPresenterCommand,
  setAuctionBreak,
  setAuctionCountdown,
  setPresenterView,
  setSpotlightPlayer,
  startRound1,
  startRound2,
  updateEvent,
} from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'

type TileTone = 'default' | 'primary' | 'active' | 'danger' | 'success' | 'info'

interface DirectorTileProps {
  icon: ReactNode
  label: string
  statusText?: string
  badge?: string
  tone?: TileTone
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}

function DirectorSquareTile({
  icon,
  label,
  statusText,
  badge,
  tone = 'default',
  disabled = false,
  loading = false,
  onClick,
}: DirectorTileProps) {
  const toneClasses: Record<TileTone, string> = {
    default:
      'border-line-strong bg-surface/90 text-white hover:border-accent/70 hover:bg-surface-elevated',
    primary:
      'border-accent/70 bg-gradient-to-br from-accent/25 via-accent/15 to-surface text-white hover:border-accent hover:from-accent/35 hover:to-surface-elevated shadow-[0_0_22px_rgba(245,175,25,0.16)]',
    active:
      'border-accent bg-accent/20 text-white shadow-[0_0_26px_rgba(245,175,25,0.28)] ring-1 ring-accent/50',
    danger:
      'border-rose-500/45 bg-rose-950/25 text-rose-100 hover:border-rose-400 hover:bg-rose-950/45',
    success:
      'border-emerald-500/50 bg-emerald-950/25 text-emerald-100 hover:border-emerald-400 hover:bg-emerald-950/40',
    info:
      'border-sky-500/45 bg-sky-950/25 text-sky-100 hover:border-sky-400 hover:bg-sky-950/40',
  }

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        'group relative flex aspect-square w-full flex-col items-center justify-between rounded-2xl border p-3.5 text-center transition-all duration-150 select-none',
        'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer',
        toneClasses[tone],
      )}
    >
      <div className="flex w-full items-center justify-between min-h-[18px]">
        {tone === 'active' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-black">
            <span className="size-1.5 rounded-full bg-black animate-pulse" />
            ON AIR
          </span>
        ) : (
          <span />
        )}
        {badge ? (
          <span className="rounded-md border border-white/15 bg-black/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/85">
            {badge}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col items-center justify-center gap-2 my-auto">
        <div
          className={cn(
            'flex size-11 items-center justify-center rounded-xl border transition-transform duration-150 group-hover:scale-105',
            tone === 'active' || tone === 'primary'
              ? 'border-accent/50 bg-accent/20 text-accent'
              : tone === 'danger'
                ? 'border-rose-400/40 bg-rose-500/15 text-rose-300'
                : tone === 'success'
                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                  : tone === 'info'
                    ? 'border-sky-400/40 bg-sky-500/15 text-sky-300'
                    : 'border-white/10 bg-black/45 text-accent',
          )}
        >
          {icon}
        </div>
        <span className="font-['Outfit',sans-serif] text-xs sm:text-[13px] font-extrabold uppercase tracking-wide leading-tight text-white">
          {loading ? 'Working…' : label}
        </span>
      </div>

      <span className="w-full truncate text-[10px] font-semibold text-ink-muted min-h-[14px]">
        {statusText ?? ''}
      </span>
    </button>
  )
}

export function DashboardPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const navigate = useNavigate()
  const toast = useToast()

  const teams = useTeams(eventId)
  const players = usePlayers(eventId)

  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [countdownDialogOpen, setCountdownDialogOpen] = useState(false)
  const [breakDialogOpen, setBreakDialogOpen] = useState(false)
  const [confirmEndRound, setConfirmEndRound] = useState<1 | 2 | null>(null)
  const [spotlightPickerOpen, setSpotlightPickerOpen] = useState(false)
  const [pickerPlayerId, setPickerPlayerId] = useState<string | null>(null)
  const [presenterMuted, setPresenterMuted] = useState(false)

  // Countdown form state
  const [countdownMinutes, setCountdownMinutes] = useState(5)
  const [countdownSeconds, setCountdownSeconds] = useState(0)
  const [countdownMessage, setCountdownMessage] = useState('Auction Starting In')

  // Break form state
  const [breakMessage, setBreakMessage] = useState('We will be back soon')
  const [breakResumeTime, setBreakResumeTime] = useState('')

  // Live ticking timer
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
  const timerFormatted = `${String(remainingMins).padStart(2, '0')}:${String(remainingSecs).padStart(2, '0')}`

  const roundPhase = event?.roundPhase ?? 'not_started'
  const currentRound = event?.currentRound ?? 0
  const presenterView = event?.presenterView ?? 'auto'
  const currencyLabel = event?.currencyLabel ?? '₹'

  const poolIds = useMemo(() => event?.roundPoolPlayerIds ?? [], [event?.roundPoolPlayerIds])
  const unsoldSet = useMemo(() => new Set(event?.unsoldPlayerIds ?? []), [event?.unsoldPlayerIds])
  const playersById = useMemo(() => new Map(players.data.map((p) => [p.id, p])), [players.data])

  const poolStats = useMemo(() => {
    let sold = 0
    let unsold = 0
    let remaining = 0
    for (const id of poolIds) {
      const p = playersById.get(id)
      if (!p) continue
      if (p.status === 'sold') sold += 1
      else if (unsoldSet.has(id) || p.status === 'withdrawn') unsold += 1
      else remaining += 1
    }
    return {
      total: poolIds.length,
      processed: sold + unsold,
      sold,
      unsold,
      remaining,
    }
  }, [poolIds, playersById, unsoldSet])

  const isRoundActive = roundPhase === 'round1_active' || roundPhase === 'round2_active'
  const nextQueueIndex = useMemo(() => {
    if (!isRoundActive || poolIds.length === 0) return -1
    return findNextUnprocessedIndex(poolIds, playersById, unsoldSet, event?.activePoolIndex ?? 0)
  }, [isRoundActive, poolIds, playersById, unsoldSet, event?.activePoolIndex])

  const nextQueuePlayer =
    nextQueueIndex >= 0 ? (playersById.get(poolIds[nextQueueIndex]!) ?? null) : null

  const pickerItems: ComboboxItem[] = useMemo(() => {
    const list =
      isRoundActive && poolIds.length > 0
        ? poolIds
            .map((id) => playersById.get(id))
            .filter((p): p is NonNullable<typeof p> => p !== undefined)
        : players.data

    return list.map((p, idx) => {
      const roleCode = normalizeRole(p.role)
      return {
        id: p.id,
        label: p.name,
        keywords: `${p.role ?? ''} ${roleCode ?? ''} ${p.externalReference ?? ''}`,
        disabled: p.status !== 'available',
        disabledReason: p.status === 'sold' ? 'Sold' : p.status === 'withdrawn' ? 'Withdrawn' : undefined,
        sublabel: `${isRoundActive && poolIds.length > 0 ? `#${idx + 1} · ` : ''}${p.role ?? 'Player'} · ${formatPoints(p.points)} pts · ${currency(p.basePrice, currencyLabel)}`,
      }
    })
  }, [isRoundActive, poolIds, playersById, players.data, currencyLabel])

  async function runAction(key: string, fn: () => Promise<void>) {
    setActionBusy(key)
    try {
      await fn()
    } catch (err) {
      toast.push({ kind: 'error', message: isCallError(err) ? err.message : errorMessage(err) })
    } finally {
      setActionBusy(null)
    }
  }

  async function handleStartAuction() {
    await runAction('start-auction', async () => {
      if (event?.countdown?.targetTime) {
        await setAuctionCountdown({ eventId, targetTime: null, durationSeconds: null })
      }
      await updateEvent({ eventId, status: 'active', purchasesEnabled: true })
      toast.push({ kind: 'success', message: 'Auction is now LIVE!' })
    })
  }

  async function handleToggleBidding() {
    if (!event) return
    const next = !event.purchasesEnabled
    await runAction('toggle-bidding', async () => {
      await updateEvent({ eventId, purchasesEnabled: next })
      toast.push({
        kind: next ? 'success' : 'info',
        message: next ? 'Bidding resumed.' : 'Bidding paused.',
      })
    })
  }

  async function handleStartRound1() {
    await runAction('start-r1', async () => {
      const res = await startRound1(eventId)
      toast.push({
        kind: 'success',
        message: `Round 1 started (${res.poolSize} players)!`,
        detail: `Queue ordered BAT → BOWL → AR → WK. Master pool (${players.data.length}) kept intact.`,
      })
    })
  }

  async function handleStartRound2() {
    await runAction('start-r2', async () => {
      const res = await startRound2(eventId)
      toast.push({
        kind: 'success',
        message: `Round 2 started (${res.poolSize} players)!`,
        detail: `${res.qualifiedTeamIds?.length ?? 0} qualified teams reset to ${currency(ROUND_2_STARTING_PURSE, currencyLabel)}. ${res.eliminatedTeamIds?.length ?? 0} eliminated teams locked out.`,
      })
    })
  }

  async function handleConfirmEndRound() {
    const target = confirmEndRound
    if (!target) return
    await runAction(`end-r${target}`, async () => {
      if (target === 1) {
        const res = await endRound1(eventId)
        setConfirmEndRound(null)
        toast.push({
          kind: 'success',
          message: 'Round 1 ended — Presenter switched to Round 1 Results.',
          detail: `${res.snapshot.qualifiedTeamIds.length} qualified · ${res.snapshot.eliminatedTeamIds.length} eliminated.`,
        })
      } else {
        const res = await endRound2(eventId)
        setConfirmEndRound(null)
        const winner = res.snapshot.results.find((r) => r.qualified)
        toast.push({
          kind: 'success',
          message: 'Round 2 ended — Presenter switched to Final Results!',
          detail: winner ? `NPL Winner: ${winner.teamName} (${formatPoints(winner.totalPoints)} pts)` : undefined,
        })
      }
    })
  }

  async function handleSwitchView(
    view: 'auto' | 'standby' | 'standings' | 'round1_results' | 'round2_results',
    label: string,
  ) {
    await runAction(`view-${view}`, async () => {
      await setPresenterView(eventId, view)
      toast.push({ kind: 'info', message: `Presenter switched to ${label}.` })
    })
  }

  async function handleStartCountdown() {
    const totalSecs = countdownMinutes * 60 + countdownSeconds
    if (totalSecs <= 0) {
      toast.push({ kind: 'error', message: 'Countdown time must be at least 1 second.' })
      return
    }
    await runAction('timer', async () => {
      const targetTime = new Date(Date.now() + totalSecs * 1000).toISOString()
      await setAuctionCountdown({
        eventId,
        targetTime,
        durationSeconds: totalSecs,
        message: countdownMessage.trim() || 'Auction Starting In',
      })
      setCountdownDialogOpen(false)
      toast.push({ kind: 'success', message: 'Countdown timer started on Presenter & team screens.' })
    })
  }

  async function handleCancelCountdown() {
    await runAction('timer', async () => {
      await setAuctionCountdown({ eventId, targetTime: null, durationSeconds: null })
      toast.push({ kind: 'info', message: 'Countdown timer stopped.' })
    })
  }

  async function handleStartBreak() {
    await runAction('break', async () => {
      await setAuctionBreak({
        eventId,
        active: true,
        message: breakMessage.trim() || 'We will be back soon',
        resumeTime: breakResumeTime.trim() || null,
      })
      setBreakDialogOpen(false)
      toast.push({ kind: 'success', message: 'Break screen is now ON AIR.' })
    })
  }

  async function handleEndBreak() {
    await runAction('break', async () => {
      await setAuctionBreak({ eventId, active: false })
      toast.push({ kind: 'success', message: 'Break ended — returned to live stage.' })
    })
  }

  async function handlePresentNext() {
    if (!nextQueuePlayer) return
    await runAction('present-next', async () => {
      await setSpotlightPlayer(eventId, nextQueuePlayer.id)
      toast.push({
        kind: 'success',
        message: `Queue #${nextQueueIndex + 1}: ${nextQueuePlayer.name} is now ON AIR.`,
      })
    })
  }

  async function handleSpotlightPicked() {
    if (!pickerPlayerId) return
    const target = playersById.get(pickerPlayerId)
    await runAction('pick-spotlight', async () => {
      await setSpotlightPlayer(eventId, pickerPlayerId)
      setSpotlightPickerOpen(false)
      setPickerPlayerId(null)
      toast.push({
        kind: 'success',
        message: `${target?.name ?? 'Player'} is now ON AIR on Presenter.`,
      })
    })
  }

  async function handleMarkUnsold() {
    const targetId = event?.spotlightPlayer?.playerId
    if (!targetId) return
    await runAction('mark-unsold', async () => {
      if (isRoundActive) {
        const res = await markPlayerUnsold(eventId, targetId)
        toast.push({
          kind: res.roundEnded ? 'success' : 'info',
          message: res.roundEnded
            ? 'All pool players processed — round ended!'
            : `${event?.spotlightPlayer?.name} marked unsold.`,
        })
      } else {
        await clearSpotlightPlayer(eventId)
        toast.push({ kind: 'info', message: 'Spotlight cleared.' })
      }
    })
  }

  async function handleClearSpotlight() {
    await runAction('clear-spotlight', async () => {
      await clearSpotlightPlayer(eventId)
      toast.push({ kind: 'info', message: 'Spotlight cleared from Presenter.' })
    })
  }

  const onAirSummary = useMemo(() => {
    if (presenterView === 'standby') return 'Standby Broadcast Stage'
    if (presenterView === 'standings') return 'Live Team Standings'
    if (presenterView === 'round1_results') return 'Round 1 Results'
    if (presenterView === 'round2_results') return 'Round 2 Final Results'
    if (event?.spotlightPlayer) return `Spotlight: ${event.spotlightPlayer.name}`
    if (event?.break?.active) return `Break Screen (${event.break.message})`
    if (event?.countdown?.targetTime) return `Countdown (${timerFormatted})`
    if (roundPhase === 'round1_ended') return 'Round 1 Results'
    if (roundPhase === 'round2_ended') return 'Round 2 Final Results'
    return 'Standby Broadcast Stage'
  }, [presenterView, event?.spotlightPlayer, event?.break, event?.countdown, roundPhase, timerFormatted])

  const canStartAuction = Boolean(event?.status === 'setup' && teams.data.length > 0 && players.data.length > 0)
  const canStartRound1 = roundPhase === 'not_started' && teams.data.length > 0 && players.data.length > 0
  const canStartRound2 = roundPhase === 'round1_ended' && (event?.qualifiedTeamIds?.length ?? 0) > 0

  return (
    <div className="space-y-6">
      {/* Slim Live Telemetry Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent/35 bg-gradient-to-r from-[#171b26] via-[#121620] to-[#1a150e] px-5 py-4 shadow-xl">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-rose-500" />
            </span>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-accent">
              Director Control Console
            </p>
          </div>
          <h1 className="mt-1 font-['Outfit',sans-serif] text-xl sm:text-2xl font-black text-white truncate">
            On Air: <span className="text-accent">{onAirSummary}</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="rounded-xl border border-line-strong bg-black/45 px-3 py-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Round</p>
            <p className="font-['Outfit',sans-serif] text-sm font-black text-white">
              {currentRound === 0 ? 'Pre-Auction' : `Round ${currentRound}`}
            </p>
          </div>
          <div className="rounded-xl border border-line-strong bg-black/45 px-3 py-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Teams</p>
            <p className="font-['Outfit',sans-serif] text-sm font-black text-white tabular-nums">
              {currentRound === 2
                ? `${event?.qualifiedTeamIds?.length ?? 0} / ${teams.data.length}`
                : teams.data.length}
            </p>
          </div>
          <div className="rounded-xl border border-line-strong bg-black/45 px-3 py-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Pool</p>
            <p className="font-['Outfit',sans-serif] text-sm font-black text-accent tabular-nums">
              {isRoundActive && poolStats.total > 0
                ? `${poolStats.processed}/${poolStats.total}`
                : `${players.data.filter((p) => p.status === 'sold').length}/${players.data.length}`}
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 1: AUCTION & ROUND FLOW */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-ink-muted px-1">
          Auction &amp; Round Flow
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          <DirectorSquareTile
            icon={<PlayCircle className="size-5" aria-hidden />}
            label={event?.status === 'active' ? 'Auction Live' : 'Start Auction'}
            statusText={
              event?.status === 'active'
                ? 'Active'
                : event?.status === 'finalized'
                  ? 'Finalized'
                  : 'Activate event'
            }
            tone={event?.status === 'active' ? 'success' : 'primary'}
            disabled={event?.status !== 'setup' || !canStartAuction}
            loading={actionBusy === 'start-auction'}
            onClick={() => void handleStartAuction()}
          />

          <DirectorSquareTile
            icon={
              event?.purchasesEnabled === false ? (
                <Play className="size-5" aria-hidden />
              ) : (
                <PauseCircle className="size-5" aria-hidden />
              )
            }
            label={event?.purchasesEnabled === false ? 'Resume Bidding' : 'Pause Bidding'}
            statusText={event?.purchasesEnabled === false ? 'Sales locked' : 'Sales enabled'}
            tone={event?.purchasesEnabled === false ? 'active' : 'default'}
            disabled={!event || event.status !== 'active'}
            loading={actionBusy === 'toggle-bidding'}
            onClick={() => void handleToggleBidding()}
          />

          <DirectorSquareTile
            icon={<Play className="size-5" aria-hidden />}
            label="Start Round 1"
            badge="187"
            statusText={
              roundPhase === 'not_started'
                ? 'Build R1 pool'
                : currentRound >= 1
                  ? `${poolStats.total || 187} players`
                  : 'Ready'
            }
            tone={
              roundPhase === 'round1_active'
                ? 'active'
                : canStartRound1
                  ? 'primary'
                  : 'default'
            }
            disabled={!canStartRound1}
            loading={actionBusy === 'start-r1'}
            onClick={() => void handleStartRound1()}
          />

          <DirectorSquareTile
            icon={<Flag className="size-5" aria-hidden />}
            label="End Round 1"
            statusText={
              roundPhase === 'round1_active'
                ? `${poolStats.remaining} left`
                : roundPhase === 'round1_ended' || currentRound === 2
                  ? 'Completed'
                  : 'Not started'
            }
            tone={roundPhase === 'round1_active' ? 'danger' : 'default'}
            disabled={roundPhase !== 'round1_active'}
            loading={actionBusy === 'end-r1'}
            onClick={() => setConfirmEndRound(1)}
          />

          <DirectorSquareTile
            icon={<Play className="size-5" aria-hidden />}
            label="Start Round 2"
            badge="132"
            statusText={
              roundPhase === 'round1_ended'
                ? '₹125 Cr reset'
                : roundPhase === 'round2_active'
                  ? 'Live now'
                  : 'After Round 1'
            }
            tone={
              roundPhase === 'round2_active'
                ? 'active'
                : canStartRound2
                  ? 'primary'
                  : 'default'
            }
            disabled={!canStartRound2}
            loading={actionBusy === 'start-r2'}
            onClick={() => void handleStartRound2()}
          />

          <DirectorSquareTile
            icon={<Trophy className="size-5" aria-hidden />}
            label="End Round 2"
            statusText={
              roundPhase === 'round2_active'
                ? `${poolStats.remaining} left`
                : roundPhase === 'round2_ended'
                  ? 'Completed'
                  : 'Not started'
            }
            tone={roundPhase === 'round2_active' ? 'danger' : 'default'}
            disabled={roundPhase !== 'round2_active'}
            loading={actionBusy === 'end-r2'}
            onClick={() => setConfirmEndRound(2)}
          />
        </div>
      </section>

      {/* SECTION 2: PRESENTATION SCREEN VIEWS */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-ink-muted px-1">
          Presentation Screen Views
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7">
          <DirectorSquareTile
            icon={<Radio className="size-5" aria-hidden />}
            label="Auto Live"
            statusText="Follows auction"
            tone={presenterView === 'auto' ? 'active' : 'default'}
            loading={actionBusy === 'view-auto'}
            onClick={() => void handleSwitchView('auto', 'Auto Live Mode')}
          />

          <DirectorSquareTile
            icon={<Monitor className="size-5" aria-hidden />}
            label="Standby Screen"
            statusText="NPL overview"
            tone={presenterView === 'standby' ? 'active' : 'default'}
            loading={actionBusy === 'view-standby'}
            onClick={() => void handleSwitchView('standby', 'Standby Screen')}
          />

          <DirectorSquareTile
            icon={<Timer className="size-5" aria-hidden />}
            label={event?.countdown?.targetTime ? 'Stop Timer' : 'Start Timer'}
            statusText={
              event?.countdown?.targetTime ? `Live ${timerFormatted}` : 'Countdown'
            }
            tone={
              presenterView === 'auto' && event?.countdown?.targetTime
                ? 'active'
                : 'default'
            }
            loading={actionBusy === 'timer'}
            onClick={() => {
              if (event?.countdown?.targetTime) {
                void handleCancelCountdown()
              } else {
                setCountdownDialogOpen(true)
              }
            }}
          />

          <DirectorSquareTile
            icon={<Coffee className="size-5" aria-hidden />}
            label={event?.break?.active ? 'End Break' : 'Break Screen'}
            statusText={event?.break?.active ? 'Intermission live' : 'Back soon'}
            tone={
              presenterView === 'auto' && event?.break?.active
                ? 'active'
                : 'default'
            }
            loading={actionBusy === 'break'}
            onClick={() => {
              if (event?.break?.active) {
                void handleEndBreak()
              } else {
                setBreakDialogOpen(true)
              }
            }}
          />

          <DirectorSquareTile
            icon={<BarChart3 className="size-5" aria-hidden />}
            label="Live Standings"
            statusText={`${teams.data.length} teams`}
            tone={presenterView === 'standings' ? 'active' : 'info'}
            loading={actionBusy === 'view-standings'}
            onClick={() => void handleSwitchView('standings', 'Live Team Standings')}
          />

          <DirectorSquareTile
            icon={<CheckCircle2 className="size-5" aria-hidden />}
            label="Show R1 Results"
            statusText={
              event?.round1Results
                ? `${event.round1Results.qualifiedTeamIds.length}Q / ${event.round1Results.eliminatedTeamIds.length}E`
                : 'R1 qualification'
            }
            tone={
              presenterView === 'round1_results' ||
              (presenterView === 'auto' && roundPhase === 'round1_ended')
                ? 'active'
                : 'default'
            }
            loading={actionBusy === 'view-round1_results'}
            onClick={() => void handleSwitchView('round1_results', 'Round 1 Results')}
          />

          <DirectorSquareTile
            icon={<Trophy className="size-5" aria-hidden />}
            label="Show R2 Results"
            statusText={
              event?.round2Results?.results.find((r) => r.qualified)?.teamName ??
              'Final leaderboard'
            }
            tone={
              presenterView === 'round2_results' ||
              (presenterView === 'auto' && roundPhase === 'round2_ended')
                ? 'active'
                : 'default'
            }
            loading={actionBusy === 'view-round2_results'}
            onClick={() => void handleSwitchView('round2_results', 'Round 2 Final Results')}
          />
        </div>
      </section>

      {/* SECTION 3: LIVE STAGE & PLAYER CONTROLS */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-ink-muted px-1">
          Live Stage &amp; Player Controls
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8">
          <DirectorSquareTile
            icon={<SkipForward className="size-5" aria-hidden />}
            label="Present Next"
            statusText={
              nextQueuePlayer
                ? `#${nextQueueIndex + 1} ${nextQueuePlayer.name}`
                : isRoundActive
                  ? 'Queue complete'
                  : 'Start a round'
            }
            tone={nextQueuePlayer ? 'primary' : 'default'}
            disabled={!nextQueuePlayer}
            loading={actionBusy === 'present-next'}
            onClick={() => void handlePresentNext()}
          />

          <DirectorSquareTile
            icon={<Search className="size-5" aria-hidden />}
            label="Pick Player"
            statusText={
              event?.spotlightPlayer
                ? `Live: ${event.spotlightPlayer.name}`
                : 'Spotlight any'
            }
            tone={event?.spotlightPlayer ? 'active' : 'default'}
            disabled={players.data.every((p) => p.status !== 'available')}
            onClick={() => setSpotlightPickerOpen(true)}
          />

          <DirectorSquareTile
            icon={<XCircle className="size-5" aria-hidden />}
            label="Mark Unsold"
            statusText={
              event?.spotlightPlayer
                ? event.spotlightPlayer.name
                : 'No live card'
            }
            tone={event?.spotlightPlayer ? 'danger' : 'default'}
            disabled={!event?.spotlightPlayer}
            loading={actionBusy === 'mark-unsold'}
            onClick={() => void handleMarkUnsold()}
          />

          <DirectorSquareTile
            icon={<Eraser className="size-5" aria-hidden />}
            label="Clear Spotlight"
            statusText={event?.spotlightPlayer ? 'Hide card' : 'None active'}
            disabled={!event?.spotlightPlayer}
            loading={actionBusy === 'clear-spotlight'}
            onClick={() => void handleClearSpotlight()}
          />

          <DirectorSquareTile
            icon={<X className="size-5" aria-hidden />}
            label="Clear Sold"
            statusText="Hide sold card"
            onClick={() => {
              sendPresenterCommand(eventId, 'clear_sold')
              toast.push({ kind: 'info', message: 'Sent Clear Sold command to Presenter.' })
            }}
          />

          <DirectorSquareTile
            icon={<RotateCcw className="size-5" aria-hidden />}
            label="Replay Sale"
            statusText={
              event?.lastSoldPlayer
                ? event.lastSoldPlayer.playerName
                : 'No recent sale'
            }
            disabled={!event?.lastSoldPlayer}
            onClick={() => {
              sendPresenterCommand(eventId, 'replay_last_sold')
              toast.push({ kind: 'info', message: 'Replaying last sold celebration on Presenter.' })
            }}
          />

          <DirectorSquareTile
            icon={<Volume2 className="size-5" aria-hidden />}
            label={presenterMuted ? 'Unmute Stage' : 'Mute Stage'}
            statusText={presenterMuted ? 'Remote muted' : 'Audio on'}
            tone={presenterMuted ? 'danger' : 'default'}
            onClick={() => {
              setPresenterMuted((m) => !m)
              sendPresenterCommand(eventId, 'toggle_mute')
              toast.push({
                kind: 'info',
                message: presenterMuted ? 'Presenter unmuted.' : 'Presenter muted.',
              })
            }}
          />

          <DirectorSquareTile
            icon={<ShoppingCart className="size-5" aria-hidden />}
            label="Record Sale"
            statusText="Bidding desk"
            tone="success"
            onClick={() => navigate('/admin/purchases/new')}
          />
        </div>
      </section>

      {/* SECTION 4: QUICK STAGE LAUNCHERS */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-ink-muted px-1">
          Screens &amp; Quick Navigation
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          <DirectorSquareTile
            icon={<MonitorPlay className="size-5" aria-hidden />}
            label="Open Presenter"
            statusText="Current tab"
            tone="primary"
            onClick={() => navigate('/admin/presenter')}
          />

          <DirectorSquareTile
            icon={<ExternalLink className="size-5" aria-hidden />}
            label="Projector Window"
            statusText="New tab"
            onClick={() => window.open('/admin/presenter', '_blank', 'noopener')}
          />

          <DirectorSquareTile
            icon={<UserCheck className="size-5" aria-hidden />}
            label="Player Pool"
            statusText={`${players.data.length} master`}
            onClick={() => navigate('/admin/players')}
          />

          <DirectorSquareTile
            icon={<Gavel className="size-5" aria-hidden />}
            label="Teams"
            statusText={`${teams.data.length} squads`}
            onClick={() => navigate('/admin/teams')}
          />

          <DirectorSquareTile
            icon={<Sparkles className="size-5" aria-hidden />}
            label="Transactions"
            statusText="Audit & reversals"
            onClick={() => navigate('/admin/transactions')}
          />

          <DirectorSquareTile
            icon={<ShieldAlert className="size-5" aria-hidden />}
            label="Settings"
            statusText="Config & reset"
            onClick={() => navigate('/admin/settings')}
          />
        </div>
      </section>

      {/* End Round Confirmation Modal */}
      <Dialog
        open={confirmEndRound !== null}
        onClose={() => !actionBusy && setConfirmEndRound(null)}
        title={confirmEndRound === 1 ? 'End Round 1?' : 'End Round 2?'}
        description={
          confirmEndRound === 1
            ? 'Evaluates all teams against the qualification rule (11+ players, 3+ BAT, 3+ BOWL, 1+ AR, 1+ WK) and switches the Presentation Screen to Round 1 Results.'
            : 'Finalizes Round 2, ranks qualified teams by total points (remaining purse tie-breaker), crowns the NPL Winner, and switches the Presentation Screen to Final Results.'
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={Boolean(actionBusy)} onClick={() => setConfirmEndRound(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={actionBusy === `end-r${confirmEndRound}`}
              icon={<ShieldAlert className="size-4" aria-hidden />}
              onClick={() => void handleConfirmEndRound()}
            >
              {confirmEndRound === 1 ? 'Confirm End Round 1' : 'Confirm End Round 2'}
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="size-4 shrink-0 text-amber-400 mt-0.5" aria-hidden />
          <div>
            {poolStats.remaining > 0 ? (
              <p>
                There are still <strong className="text-white">{poolStats.remaining} unprocessed players</strong> in the
                Round {confirmEndRound} queue. Ending now evaluates teams on their current squads.
              </p>
            ) : (
              <p>All players in the Round {confirmEndRound} pool have been processed.</p>
            )}
          </div>
        </div>
      </Dialog>

      {/* Quick Pick Spotlight Player Modal */}
      <Dialog
        open={spotlightPickerOpen}
        onClose={() => setSpotlightPickerOpen(false)}
        title="Put Player on Presenter Spotlight"
        description="Search and push any available player immediately onto the Presentation Screen and all team screens."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSpotlightPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!pickerPlayerId}
              loading={actionBusy === 'pick-spotlight'}
              icon={<Radio className="size-4" aria-hidden />}
              onClick={() => void handleSpotlightPicked()}
            >
              Go Live on Presenter
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Combobox
            items={pickerItems}
            value={pickerPlayerId}
            onChange={setPickerPlayerId}
            placeholder="Search player by name, role, or ID…"
            emptyMessage="No available players match."
            ariaLabel="Select player to spotlight"
          />
        </div>
      </Dialog>

      {/* Starting in Countdown Dialog */}
      <Dialog
        open={countdownDialogOpen}
        onClose={() => setCountdownDialogOpen(false)}
        title="Start Auction Countdown"
        description="Set a countdown timer before the auction begins. Displays on the Presenter Screen and all team devices."
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button
              variant="secondary"
              onClick={() => setCountdownDialogOpen(false)}
              disabled={actionBusy === 'timer'}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Timer className="size-4" />}
              loading={actionBusy === 'timer'}
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
            hint="Header shown above the countdown clock on Presenter & team screens."
          />
        </div>
      </Dialog>

      {/* Break / Intermission Dialog */}
      <Dialog
        open={breakDialogOpen}
        onClose={() => setBreakDialogOpen(false)}
        title="Activate Break Screen"
        description="Pause and display an intermission screen on the Presenter Screen and all team devices."
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button
              variant="secondary"
              onClick={() => setBreakDialogOpen(false)}
              disabled={actionBusy === 'break'}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Coffee className="size-4" />}
              loading={actionBusy === 'break'}
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
          />
        </div>
      </Dialog>
    </div>
  )
}
