import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  MonitorPlay,
  Play,
  ShieldAlert,
  Trophy,
  XCircle,
} from 'lucide-react'
import type { EventDoc, PlayerDoc, TeamDoc } from '@shared/types'
import { ROUND_1_TARGET_TEAMS, ROUND_2_STARTING_PURSE, ROUND_2_TARGET_TEAMS } from '@shared/constants'
import { currency, points as formatPoints } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Pill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { endRound1, endRound2, startRound1, startRound2 } from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'

export interface RoundControlsBarProps {
  eventId: string
  event: EventDoc
  players: readonly PlayerDoc[]
  teams: readonly TeamDoc[]
  compact?: boolean
}

export function RoundControlsBar({
  eventId,
  event,
  players,
  teams,
  compact = false,
}: RoundControlsBarProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmEndRound, setConfirmEndRound] = useState<1 | 2 | null>(null)

  const roundPhase = event.roundPhase ?? 'not_started'
  const currentRound = event.currentRound ?? 0
  const poolIds = useMemo(() => event.roundPoolPlayerIds ?? [], [event.roundPoolPlayerIds])
  const unsoldSet = useMemo(() => new Set(event.unsoldPlayerIds ?? []), [event.unsoldPlayerIds])
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const currencyLabel = event.currencyLabel ?? '₹'

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

  const canStartRound1 = roundPhase === 'not_started' && teams.length > 0 && players.length > 0
  const canStartRound2 =
    roundPhase === 'round1_ended' && (event.qualifiedTeamIds?.length ?? 0) > 0

  async function handleStartRound1() {
    setBusy(true)
    try {
      const res = await startRound1(eventId)
      toast.push({
        kind: 'success',
        message: `Round 1 started with ${res.poolSize} players!`,
        detail: `Queue ordered BAT → BOWL → AR → WK. Master pool (${players.length} players) kept intact.`,
      })
    } catch (err) {
      toast.push({ kind: 'error', message: isCallError(err) ? err.message : errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmEndRound() {
    const target = confirmEndRound
    if (!target) return
    setBusy(true)
    try {
      if (target === 1) {
        const res = await endRound1(eventId)
        setConfirmEndRound(null)
        toast.push({
          kind: 'success',
          message: 'Round 1 ended. Presentation Screen switched to Round 1 Results.',
          detail: `${res.snapshot.qualifiedTeamIds.length} qualified · ${res.snapshot.eliminatedTeamIds.length} eliminated.`,
        })
      } else {
        const res = await endRound2(eventId)
        setConfirmEndRound(null)
        const winner = res.snapshot.results.find((r) => r.qualified)
        toast.push({
          kind: 'success',
          message: 'Round 2 ended! Presentation Screen shows Final Results.',
          detail: winner ? `NPL Winner: ${winner.teamName} (${formatPoints(winner.totalPoints)} pts)` : undefined,
        })
      }
    } catch (err) {
      toast.push({ kind: 'error', message: isCallError(err) ? err.message : errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function handleStartRound2() {
    setBusy(true)
    try {
      const res = await startRound2(eventId)
      toast.push({
        kind: 'success',
        message: `Round 2 started with ${res.poolSize} players!`,
        detail: `${res.qualifiedTeamIds?.length ?? 0} qualified teams reset to ${currency(ROUND_2_STARTING_PURSE, currencyLabel)}. ${res.eliminatedTeamIds?.length ?? 0} eliminated teams locked out.`,
      })
    } catch (err) {
      toast.push({ kind: 'error', message: isCallError(err) ? err.message : errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const r1Results = event.round1Results
  const r2Results = event.round2Results
  const r2Winner = useMemo(
    () => r2Results?.results.find((r) => r.qualified) ?? null,
    [r2Results],
  )

  return (
    <>
      <div className="mb-6 rounded-2xl border border-accent/35 bg-gradient-to-br from-[#191d28] via-[#131722] to-[#1a1510] p-4 shadow-xl sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-accent">
                2-Round Auction Flow
              </span>
              {roundPhase === 'not_started' ? (
                <Pill tone="neutral">Ready for Round 1</Pill>
              ) : roundPhase === 'round1_active' ? (
                <Pill tone="info">Round 1 Live · {poolStats.processed}/{poolStats.total}</Pill>
              ) : roundPhase === 'round1_ended' ? (
                <Pill tone="warning">Round 1 Ended</Pill>
              ) : roundPhase === 'round2_active' ? (
                <Pill tone="info">Round 2 Live · {poolStats.processed}/{poolStats.total}</Pill>
              ) : (
                <Pill tone="success">Round 2 Finalized</Pill>
              )}
            </div>

            {!compact ? (
              <p className="mt-1 text-xs text-ink-muted">
                {roundPhase === 'not_started' &&
                  `Start Round 1 to build a ${ROUND_1_TARGET_TEAMS * 11}-player pool from all ${players.length} master players without deleting master records.`}
                {roundPhase === 'round1_active' &&
                  `Pool: ${poolStats.total} players (${poolStats.sold} sold, ${poolStats.unsold} unsold, ${poolStats.remaining} remaining). Auto-ends when all ${poolStats.total} are processed.`}
                {roundPhase === 'round1_ended' &&
                  `${r1Results?.qualifiedTeamIds.length ?? 0} qualified teams advance to Round 2; ${r1Results?.eliminatedTeamIds.length ?? 0} eliminated. Click Start Round 2 to lock out eliminated teams, reset purses to ${currency(ROUND_2_STARTING_PURSE, currencyLabel)}, and build the ${ROUND_2_TARGET_TEAMS * 11}-player pool.`}
                {roundPhase === 'round2_active' &&
                  `${event.qualifiedTeamIds?.length ?? 0} qualified teams active (${event.eliminatedTeamIds?.length ?? 0} locked out). Pool: ${poolStats.processed}/${poolStats.total} processed.`}
                {roundPhase === 'round2_ended' &&
                  (r2Winner
                    ? `Auction complete! NPL Winner: ${r2Winner.teamName} with ${formatPoints(r2Winner.totalPoints)} pts.`
                    : 'Round 2 complete. View Final Results on the Presentation Screen.')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {roundPhase === 'not_started' ? (
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                disabled={!canStartRound1}
                icon={<Play className="size-3.5" aria-hidden />}
                onClick={() => void handleStartRound1()}
                title={
                  teams.length === 0 || players.length === 0
                    ? 'Add teams and players first'
                    : 'Build 187-player Round 1 pool and start'
                }
              >
                Start Round 1
              </Button>
            ) : null}

            {roundPhase === 'round1_active' ? (
              <Button
                size="sm"
                variant="dangerOutline"
                loading={busy}
                icon={<Flag className="size-3.5" aria-hidden />}
                onClick={() => setConfirmEndRound(1)}
              >
                End Round 1
              </Button>
            ) : null}

            <Button
              size="sm"
              variant={roundPhase === 'round1_ended' ? 'primary' : 'secondary'}
              loading={busy}
              disabled={!canStartRound2}
              icon={<Play className="size-3.5" aria-hidden />}
              onClick={() => void handleStartRound2()}
              title={
                roundPhase !== 'round1_ended'
                  ? 'Enabled after Round 1 ends'
                  : (event.qualifiedTeamIds?.length ?? 0) === 0
                    ? 'No teams qualified in Round 1'
                    : 'Lock out eliminated teams, reset purses to ₹125 Cr, and build 132-player Round 2 pool'
              }
            >
              Start Round 2
            </Button>

            {roundPhase === 'round2_active' ? (
              <Button
                size="sm"
                variant="dangerOutline"
                loading={busy}
                icon={<Flag className="size-3.5" aria-hidden />}
                onClick={() => setConfirmEndRound(2)}
              >
                End Round 2
              </Button>
            ) : null}

            <Link to="/admin/presenter">
              <Button size="sm" variant="ghost" icon={<MonitorPlay className="size-3.5" aria-hidden />}>
                Presenter
              </Button>
            </Link>
          </div>
        </div>

        {(roundPhase === 'round1_active' || roundPhase === 'round2_active') && poolStats.total > 0 ? (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${Math.min(100, Math.round((poolStats.processed / poolStats.total) * 100))}%` }}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
              <span>
                Round {currentRound} Pool: <strong className="text-white">{poolStats.sold}</strong> sold ·{' '}
                <strong className="text-amber-300">{poolStats.unsold}</strong> unsold ·{' '}
                <strong className="text-sky-300">{poolStats.remaining}</strong> remaining
              </span>
              <span className="tabular-nums font-semibold text-white">
                {poolStats.processed} / {poolStats.total} processed
              </span>
            </div>
          </div>
        ) : null}

        {roundPhase === 'round1_ended' && r1Results && !compact ? (
          <div className="mt-3 grid gap-3 border-t border-line/60 pt-3 sm:grid-cols-2">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                <XCircle className="size-3.5" aria-hidden />
                Eliminated Teams ({r1Results.eliminatedTeamIds.length})
              </p>
              {r1Results.eliminatedTeamIds.length === 0 ? (
                <p className="mt-1 text-xs text-rose-200/75">No teams were eliminated in Round 1.</p>
              ) : (
                <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto text-xs">
                  {r1Results.results
                    .filter((r) => !r.qualified)
                    .map((r) => (
                      <li key={r.teamId} className="flex items-center justify-between gap-2 text-rose-200">
                        <span className="truncate font-semibold">{r.teamName}</span>
                        <span className="shrink-0 text-[11px] text-rose-300/90">{r.missingSummary}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Qualified for Round 2 ({r1Results.qualifiedTeamIds.length})
              </p>
              {r1Results.qualifiedTeamIds.length === 0 ? (
                <p className="mt-1 text-xs text-emerald-200/75">No teams met the qualification criteria.</p>
              ) : (
                <p className="mt-1.5 text-xs text-emerald-100/90 leading-relaxed">
                  {r1Results.results
                    .filter((r) => r.qualified)
                    .map((r) => r.teamName)
                    .join(', ')}
                </p>
              )}
            </div>
          </div>
        ) : null}

        {roundPhase === 'round2_ended' && r2Winner && !compact ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Trophy className="size-5 text-accent" aria-hidden />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-accent">NPL Winner</p>
                <p className="text-sm font-black text-white">
                  {r2Winner.teamName} · {formatPoints(r2Winner.totalPoints)} pts
                </p>
              </div>
            </div>
            <Link to="/admin/presenter">
              <Button size="sm" variant="secondary">View Final Leaderboard</Button>
            </Link>
          </div>
        ) : null}
      </div>

      {/* End Round Confirmation Modal */}
      <Dialog
        open={confirmEndRound !== null}
        onClose={() => !busy && setConfirmEndRound(null)}
        title={confirmEndRound === 1 ? 'End Round 1?' : 'End Round 2?'}
        description={
          confirmEndRound === 1
            ? 'This will evaluate all teams against the qualification rule (11+ players, 3+ BAT, 3+ BOWL, 1+ AR, 1+ WK) and display Round 1 Results on the Presentation Screen.'
            : 'This will finalize Round 2, rank qualified teams by total points (remaining purse tie-breaker), crown the NPL Winner, and display the Final Results leaderboard on the Presentation Screen.'
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmEndRound(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
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
                Round {confirmEndRound} queue. Ending the round now evaluates teams using their current squads.
              </p>
            ) : (
              <p>All players in the Round {confirmEndRound} pool have been processed.</p>
            )}
          </div>
        </div>
      </Dialog>
    </>
  )
}
