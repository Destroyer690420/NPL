import { useEffect, useRef, useState } from 'react'
import { Plane, Star } from 'lucide-react'
import type { SoldPlayerAnnouncement } from '@shared/types'
import { PlayerAvatar } from '@/components/ui/PlayerAvatar'
import { currency, points as formatPoints } from '@/lib/format'
import { isOverseas, isStar } from '@/lib/playerBadges'

export interface SoldPlayerCelebrationProps {
  currencyLabel?: string
}

/**
 * Cinematic full-screen celebration animation that plays on team screens
 * whenever a player is sold in the live auction. Automatically disappears
 * after ~2 seconds.
 */
export function SoldPlayerCelebration({ currencyLabel = '₹' }: SoldPlayerCelebrationProps) {
  const [announcement, setAnnouncement] = useState<SoldPlayerAnnouncement | null>(null)
  const [visible, setVisible] = useState(false)
  const [isExiting, setIsExiting] = useState(false)

  const exitTimerRef = useRef<number | null>(null)
  const dismissTimerRef = useRef<number | null>(null)

  useEffect(() => {
    function handlePlayerSold(e: Event) {
      const custom = e as CustomEvent<SoldPlayerAnnouncement>
      const data = custom.detail
      if (!data || !data.playerName || !data.teamName) return

      // Clear any pending timers
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current)

      setAnnouncement(data)
      setIsExiting(false)
      setVisible(true)

      // Start smooth exit transition after 4000ms (4 seconds)
      exitTimerRef.current = window.setTimeout(() => {
        setIsExiting(true)
      }, 4000)

      // Clean up completely after transition (4300ms)
      dismissTimerRef.current = window.setTimeout(() => {
        setVisible(false)
        setAnnouncement(null)
        setIsExiting(false)
      }, 4300)
    }

    window.addEventListener('auction:player_sold', handlePlayerSold)
    return () => {
      window.removeEventListener('auction:player_sold', handlePlayerSold)
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current)
    }
  }, [])

  function handleDismiss() {
    if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current)
    setVisible(false)
    setAnnouncement(null)
    setIsExiting(false)
  }

  if (!visible || !announcement) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      onClick={handleDismiss}
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 select-none cursor-pointer transition-opacity duration-300 ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
      }`}
    >
      {/* Dark frosted glass backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

      {/* Stadium spotlight glow behind card */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,175,25,0.32)_0%,rgba(16,185,129,0.12)_45%,transparent_70%)] animate-pulse pointer-events-none" />

      {/* Floodlight angled beams */}
      <div className="absolute -top-20 -left-20 h-96 w-96 rounded-full bg-accent/20 blur-3xl pointer-events-none" />
      <div className="absolute -top-20 -right-20 h-96 w-96 rounded-full bg-accent/20 blur-3xl pointer-events-none" />

      {/* Hero Celebration Card */}
      <div
        className={`relative w-full max-w-md sm:max-w-lg overflow-hidden rounded-3xl border-2 border-accent/70 bg-gradient-to-b from-[#181d28]/98 via-[#10131d]/98 to-[#090c13]/98 p-6 sm:p-8 text-center shadow-[0_0_60px_rgba(245,175,25,0.45),inset_0_1px_2px_rgba(255,255,255,0.25)] ${
          isExiting ? 'animate-sold-exit' : 'animate-sold-pop'
        }`}
        onClick={(e) => {
          // Allow clicking card or backdrop to dismiss early
          e.stopPropagation()
          handleDismiss()
        }}
      >
        {/* Dynamic diagonal sport bars in background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-35deg, transparent, transparent 20px, rgba(245,175,25,0.4) 20px, rgba(245,175,25,0.4) 25px)',
          }}
        />

        {/* Ambient top light line */}
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_15px_rgba(245,175,25,1)]" />

        {/* Top SOLD Badge */}
        <div className="relative inline-flex items-center gap-2 rounded-full border border-accent/80 bg-gradient-to-r from-accent via-amber-300 to-yellow-400 px-4 py-1 shadow-[0_0_20px_rgba(245,175,25,0.7)]">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-black opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-black" />
          </span>
          <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-widest text-black">
            SOLD OUT · HAMMER DOWN
          </span>
        </div>

        {/* Player Avatar */}
        <div className="relative mt-4 flex justify-center">
          <div className="relative">
            <div className="absolute -inset-2 rounded-2xl bg-gradient-to-br from-accent/60 to-emerald-400/40 blur-md opacity-80" />
            <PlayerAvatar
              name={announcement.playerName}
              photoUrl={announcement.playerPhotoUrl}
              size="xl"
              className="relative rounded-2xl ring-4 ring-accent shadow-[0_0_25px_rgba(245,175,25,0.6)]"
            />
          </div>
        </div>

        {/* Player Name */}
        <h3 className="relative mt-3.5 text-2xl sm:text-3xl font-black uppercase tracking-tight text-white font-['Outfit',sans-serif] drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">
          {announcement.playerName}
        </h3>

        {/* Badges: Star Player & Overseas */}
        {(isStar(announcement.star) || isOverseas(announcement.nationality)) ? (
          <div className="relative mt-2 flex items-center justify-center gap-2">
            {isStar(announcement.star) ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/80 bg-amber-500/15 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-amber-300 shadow-[0_0_12px_rgba(245,175,25,0.4)]">
                <Star className="size-3 fill-amber-300 text-amber-300" />
                Star Player
              </span>
            ) : null}
            {isOverseas(announcement.nationality) ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/80 bg-sky-500/15 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.4)]">
                <Plane className="size-3 text-sky-300" />
                Overseas
              </span>
            ) : null}
          </div>
        ) : null}

        {/* SOLD TO Divider */}
        <div className="relative my-2 flex items-center justify-center gap-3">
          <span className="h-0.5 w-12 bg-gradient-to-r from-transparent to-accent" />
          <span className="font-['Outfit',sans-serif] text-[11px] font-black uppercase tracking-[0.25em] text-accent-light drop-shadow-[0_0_8px_rgba(245,175,25,0.8)]">
            SOLD TO
          </span>
          <span className="h-0.5 w-12 bg-gradient-to-l from-transparent to-accent" />
        </div>

        {/* Team Name */}
        <h2 className="relative text-3xl sm:text-4xl font-black uppercase tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-accent to-amber-400 font-['Outfit',sans-serif] drop-shadow-[0_0_30px_rgba(245,175,25,0.7)]">
          {announcement.teamName}
        </h2>

        {/* Final Price & Points Pill */}
        {announcement.finalPrice ? (
          <div className="relative mt-3.5 inline-flex items-center gap-2.5 rounded-xl border border-line-strong bg-surface-muted/90 px-4 py-1.5 shadow-inner">
            <span className="text-sm sm:text-base font-extrabold text-emerald-400 tabular-nums">
              {currency(announcement.finalPrice, currencyLabel)}
            </span>
            {announcement.playerPoints ? (
              <>
                <span className="text-line-strong">·</span>
                <span className="text-xs font-bold text-sky-400 tabular-nums">
                  {formatPoints(announcement.playerPoints)} pts
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Bottom progress drain timer bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/40 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-accent via-amber-300 to-emerald-400 shadow-[0_0_10px_rgba(245,175,25,0.9)] animate-progress-drain" />
        </div>
      </div>
    </div>
  )
}
