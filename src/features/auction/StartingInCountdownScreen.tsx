import { useEffect, useMemo, useState } from 'react'
import type { AuctionCountdown } from '@shared/types'
import { Sparkles, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface StartingInCountdownScreenProps {
  countdown: AuctionCountdown
  eventName?: string
  onViewLineup?: () => void
}

export function StartingInCountdownScreen({
  countdown,
  eventName = 'Auction',
  onViewLineup,
}: StartingInCountdownScreenProps) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 250)
    return () => clearInterval(timer)
  }, [])

  const targetMs = useMemo(() => {
    return new Date(countdown.targetTime).getTime()
  }, [countdown.targetTime])

  const startedMs = useMemo(() => {
    return countdown.startedAt ? new Date(countdown.startedAt).getTime() : targetMs - countdown.durationSeconds * 1000
  }, [countdown.startedAt, countdown.durationSeconds, targetMs])

  const diffMs = Math.max(0, targetMs - now)
  const isFinished = diffMs <= 0

  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const totalDurationMs = Math.max(1000, targetMs - startedMs)
  const elapsedMs = Math.min(totalDurationMs, Math.max(0, now - startedMs))
  const progressPercent = Math.min(100, Math.max(0, (elapsedMs / totalDurationMs) * 100))

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="relative min-h-[82vh] flex flex-col items-center justify-center px-4 py-8 text-center select-none overflow-hidden rounded-3xl border border-line-strong bg-gradient-to-b from-[#10141f] via-[#0b0e14] to-[#07090e] shadow-2xl">
      {/* Dynamic diagonal background sports bars */}
      <div
        className="absolute inset-0 pointer-events-none opacity-15"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-35deg, transparent, transparent 24px, rgba(245,175,25,0.3) 24px, rgba(245,175,25,0.3) 30px)',
        }}
      />

      {/* Golden stadium floodlight glows */}
      <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent/25 blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute -top-32 -right-24 h-96 w-96 rounded-full bg-amber-400/20 blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,175,25,0.18)_0%,transparent_70%)] pointer-events-none" />

      {/* Top Header Badge */}
      <div className="relative z-10 mb-6 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 shadow-[0_0_20px_rgba(245,175,25,0.25)]">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
        </span>
        <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-widest text-accent">
          {eventName} · Live Sync
        </span>
      </div>

      {/* Headline Title */}
      <div className="relative z-10 max-w-lg space-y-2">
        <div className="inline-flex items-center gap-1.5 text-accent-light">
          <Sparkles className="size-4 animate-bounce" />
          <p className="font-['Outfit',sans-serif] text-sm sm:text-base font-extrabold uppercase tracking-[0.3em] drop-shadow-[0_0_12px_rgba(245,175,25,0.8)]">
            {countdown.message || 'Auction Starting In'}
          </p>
          <Sparkles className="size-4 animate-bounce" />
        </div>
        <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-tight text-white font-['Outfit',sans-serif] drop-shadow-[0_2px_15px_rgba(0,0,0,0.8)]">
          {isFinished ? 'Starting Now' : 'Get Ready'}
        </h1>
      </div>

      {/* Digital Countdown Timer Clock */}
      <div className="relative z-10 my-8 flex items-center justify-center gap-3 sm:gap-5">
        {hours > 0 ? (
          <>
            <div className="flex flex-col items-center">
              <div className="flex h-20 w-20 sm:h-28 sm:w-28 items-center justify-center rounded-2xl sm:rounded-3xl border-2 border-accent/60 bg-gradient-to-b from-[#1c2230] to-[#121622] shadow-[0_0_30px_rgba(245,175,25,0.35)]">
                <span className="font-['Outfit',sans-serif] text-4xl sm:text-6xl font-black tabular-nums text-white">
                  {pad(hours)}
                </span>
              </div>
              <span className="mt-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-ink-muted">
                Hours
              </span>
            </div>
            <span className="pb-6 font-['Outfit',sans-serif] text-3xl sm:text-5xl font-black text-accent animate-pulse">
              :
            </span>
          </>
        ) : null}

        {/* Minutes */}
        <div className="flex flex-col items-center">
          <div className="flex h-24 w-24 sm:h-32 sm:w-32 items-center justify-center rounded-2xl sm:rounded-3xl border-2 border-accent/60 bg-gradient-to-b from-[#1c2230] to-[#121622] shadow-[0_0_35px_rgba(245,175,25,0.4)]">
            <span className="font-['Outfit',sans-serif] text-5xl sm:text-7xl font-black tabular-nums text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
              {pad(minutes)}
            </span>
          </div>
          <span className="mt-2.5 text-xs sm:text-sm font-bold uppercase tracking-wider text-ink-muted">
            Minutes
          </span>
        </div>

        <span className="pb-6 font-['Outfit',sans-serif] text-4xl sm:text-6xl font-black text-accent animate-pulse">
          :
        </span>

        {/* Seconds */}
        <div className="flex flex-col items-center">
          <div className="flex h-24 w-24 sm:h-32 sm:w-32 items-center justify-center rounded-2xl sm:rounded-3xl border-2 border-accent/70 bg-gradient-to-b from-[#1c2230] to-[#121622] shadow-[0_0_40px_rgba(245,175,25,0.5)]">
            <span className="font-['Outfit',sans-serif] text-5xl sm:text-7xl font-black tabular-nums text-accent drop-shadow-[0_0_20px_rgba(245,175,25,0.8)]">
              {pad(seconds)}
            </span>
          </div>
          <span className="mt-2.5 text-xs sm:text-sm font-bold uppercase tracking-wider text-accent-light">
            Seconds
          </span>
        </div>
      </div>

      {/* Progress Bar towards start */}
      <div className="relative z-10 w-full max-w-md px-4">
        <div className="h-2.5 overflow-hidden rounded-full border border-line-strong bg-surface-muted/80 p-0.5 shadow-inner">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent via-amber-300 to-emerald-400 shadow-[0_0_12px_rgba(245,175,25,0.8)] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-3 text-xs sm:text-sm text-ink-muted">
          {isFinished
            ? 'The countdown has finished. The auctioneer will initiate live bidding momentarily.'
            : 'Prepare your squad strategies! Live bidding begins when the countdown reaches zero.'}
        </p>
      </div>

      {/* Quick Option to browse player lineup while waiting */}
      {onViewLineup ? (
        <div className="relative z-10 mt-8">
          <Button
            variant="secondary"
            icon={<Users className="size-4 text-accent" />}
            onClick={onViewLineup}
            className="border-accent/40 hover:border-accent hover:bg-accent/15"
          >
            Preview Auction Lineup
          </Button>
        </div>
      ) : null}
    </div>
  )
}
