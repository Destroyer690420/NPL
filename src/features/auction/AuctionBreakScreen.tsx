import type { AuctionBreak } from '@shared/types'
import { Clock, Coffee, Sparkles, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface AuctionBreakScreenProps {
  breakState: AuctionBreak
  eventName?: string
  onViewLineup?: () => void
}

export function AuctionBreakScreen({
  breakState,
  eventName = 'Auction',
  onViewLineup,
}: AuctionBreakScreenProps) {
  return (
    <div className="relative min-h-[82vh] flex flex-col items-center justify-center px-4 py-8 text-center select-none overflow-hidden rounded-3xl border border-line-strong bg-gradient-to-b from-[#121624] via-[#0d101a] to-[#080a11] shadow-2xl">
      {/* Dynamic ambient diagonal lighting */}
      <div
        className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-35deg, transparent, transparent 24px, rgba(245,175,25,0.3) 24px, rgba(245,175,25,0.3) 30px)',
        }}
      />

      {/* Ambient glows */}
      <div className="absolute -top-32 -left-20 h-96 w-96 rounded-full bg-amber-500/20 blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-sky-500/15 blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,175,25,0.15)_0%,transparent_65%)] pointer-events-none" />

      {/* Top Event Badge */}
      <div className="relative z-10 mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-1.5 shadow-[0_0_20px_rgba(245,175,25,0.25)]">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
        </span>
        <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-widest text-amber-300">
          {eventName} · Intermission
        </span>
      </div>

      {/* Center Animated Icon Emblem */}
      <div className="relative z-10 mb-6 flex justify-center">
        <div className="relative flex size-24 sm:size-28 items-center justify-center rounded-3xl border-2 border-accent/60 bg-gradient-to-br from-[#1c2233] to-[#111624] shadow-[0_0_40px_rgba(245,175,25,0.35)]">
          <div className="absolute -inset-1 rounded-3xl bg-accent/20 blur-sm animate-pulse" />
          <Coffee className="relative size-12 sm:size-14 text-accent animate-bounce" />
        </div>
      </div>

      {/* Core Message */}
      <div className="relative z-10 max-w-lg space-y-3 px-2">
        <div className="inline-flex items-center gap-1.5 text-accent-light">
          <Sparkles className="size-4" />
          <p className="font-['Outfit',sans-serif] text-xs sm:text-sm font-extrabold uppercase tracking-[0.25em] drop-shadow-[0_0_8px_rgba(245,175,25,0.7)]">
            Auction Intermission
          </p>
          <Sparkles className="size-4" />
        </div>
        <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-tight text-white font-['Outfit',sans-serif] drop-shadow-[0_2px_15px_rgba(0,0,0,0.9)]">
          {breakState.message || 'We will be back soon'}
        </h1>
        <p className="text-sm sm:text-base text-ink-muted leading-relaxed max-w-md mx-auto">
          The auctioneer has called a short break. Please remain connected — live bidding will resume right here on your screen automatically.
        </p>
      </div>

      {/* Resume Time / Estimated Return if provided */}
      {breakState.resumeTime ? (
        <div className="relative z-10 mt-6 inline-flex items-center gap-2 rounded-2xl border border-accent/50 bg-accent/15 px-5 py-2.5 shadow-[0_0_20px_rgba(245,175,25,0.2)]">
          <Clock className="size-4.5 text-accent animate-spin" style={{ animationDuration: '6s' }} />
          <span className="font-['Outfit',sans-serif] text-sm sm:text-base font-bold text-white">
            Estimated Return:{' '}
            <span className="text-accent font-extrabold">{breakState.resumeTime}</span>
          </span>
        </div>
      ) : null}

      {/* Realtime Live Sync status */}
      <div className="relative z-10 mt-8 flex items-center justify-center gap-2 text-xs font-semibold text-ink-muted">
        <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
        <span>Connected to Live Session · Resumes in real-time</span>
      </div>

      {/* Quick Option to browse player lineup while on break */}
      {onViewLineup ? (
        <div className="relative z-10 mt-6">
          <Button
            variant="secondary"
            icon={<Users className="size-4 text-accent" />}
            onClick={onViewLineup}
            className="border-accent/40 hover:border-accent hover:bg-accent/15"
          >
            Browse Auction Lineup During Break
          </Button>
        </div>
      ) : null}
    </div>
  )
}
