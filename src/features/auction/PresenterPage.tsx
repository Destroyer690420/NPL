import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import {
  Gavel,
  Maximize2,
  Minimize2,
  Music,
  Plane,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { usePlayers, usePurchases, useTeams } from '@/data/hooks'
import type { SoldPlayerAnnouncement, SpotlightPlayer } from '@shared/types'
import { currency, points as formatPoints } from '@/lib/format'
import { isOverseas, isStar } from '@/lib/playerBadges'
import {
  isAuctionAudioUnlocked,
  playIplSoldTune,
  playPlayerIntroCue,
  playStageAmbientMusic,
  stopIplSoldTune,
  stopStageAmbientMusic,
  subscribeAuctionAudioState,
  unlockAuctionAudio,
} from '@/lib/auctionAudio'
import { getSupabase } from '@/lib/supabase'
import { usePlayerImage } from '@/lib/playerImages'
import { StartingInCountdownScreen } from './StartingInCountdownScreen'
import { AuctionBreakScreen } from './AuctionBreakScreen'
import { LiveStandingsStage, Round1ResultsStage, Round2FinalResultsStage } from './RoundResultsViews'
import { buildRoundSnapshot } from '@shared/rounds'
import type { PresenterCommandType } from '@/lib/realtime'
import { Button } from '@/components/ui/Button'

/** Formats base/sold price compactly on one crisp line like broadcast graphics (e.g. ₹2 CR, ₹75 LAKH). */
function formatBroadcastPrice(amount: number | null | undefined, currencyLabel = '₹'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
  if (amount >= 10_000_000) {
    const cr = amount / 10_000_000
    const text = Number.isInteger(cr) ? String(cr) : cr.toFixed(2).replace(/\.?0+$/, '')
    return `${currencyLabel}${text} CR`
  }
  if (amount >= 100_000) {
    const lakh = amount / 100_000
    const text = Number.isInteger(lakh) ? String(lakh) : lakh.toFixed(2).replace(/\.?0+$/, '')
    return `${currencyLabel}${text} LAKH`
  }
  if (amount >= 1_000) {
    const k = amount / 1_000
    const text = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, '')
    return `${currencyLabel}${text}K`
  }
  return currency(amount, currencyLabel).toUpperCase()
}

/** Crisp red warning triangle matching the reference Star Player & Sold graphics. */
function AlertTriangleBadge({ className = 'size-8 sm:size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 32" className={`${className} shrink-0 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]`} aria-hidden="true">
      <path
        d="M16.2 2.4c.8-1.4 2.8-1.4 3.6 0l14.6 25.6c.8 1.4-.2 3.1-1.8 3.1H3.4c-1.6 0-2.6-1.7-1.8-3.1L16.2 2.4z"
        fill="#a8141c"
        stroke="#ef4444"
        strokeWidth="1.2"
      />
      <rect x="16.5" y="10.5" width="3" height="10" rx="1.5" fill="#ffffff" />
      <circle cx="18" cy="24.5" r="1.8" fill="#ffffff" />
    </svg>
  )
}

/** Crisp inline SVG Indian tricolor flag. */
function IndiaFlag({ className = 'h-8 w-12 sm:h-10 sm:w-16' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 24"
      className={`${className} rounded-[3px] shadow-[0_4px_14px_rgba(0,0,0,0.75)] ring-1 ring-white/20 shrink-0`}
      aria-hidden="true"
    >
      <rect width="36" height="8" y="0" fill="#FF9933" />
      <rect width="36" height="8" y="8" fill="#FFFFFF" />
      <rect width="36" height="8" y="16" fill="#138808" />
      <circle cx="18" cy="12" r="2.8" fill="none" stroke="#000080" strokeWidth="0.9" />
      <circle cx="18" cy="12" r="0.6" fill="#000080" />
    </svg>
  )
}

/**
 * Full-bleed curved sweeping studio background matching Image 1 (black left + sweeping gold/crimson waves on right).
 */
function BroadcastBackdrop({ variant }: { variant: 'gold' | 'crimson' }) {
  const isCrimson = variant === 'crimson'
  const cMain = isCrimson ? '#7a0a12' : '#5c5206'
  const cMid = isCrimson ? '#4a050a' : '#3a3303'
  const cBright = isCrimson ? '#b91c1c' : '#96870a'
  const cEdge = isCrimson ? '#dc2626' : '#c2af12'

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`bgGlow-${variant}`} cx="78%" cy="48%" r="60%">
          <stop offset="0%" stopColor={cBright} stopOpacity="0.88" />
          <stop offset="45%" stopColor={cMain} stopOpacity="0.68" />
          <stop offset="82%" stopColor={cMid} stopOpacity="0.28" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={`waveSweep1-${variant}`} x1="100%" y1="0%" x2="25%" y2="100%">
          <stop offset="0%" stopColor={cEdge} stopOpacity="0.62" />
          <stop offset="45%" stopColor={cMain} stopOpacity="0.48" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={`waveSweep2-${variant}`} x1="85%" y1="15%" x2="30%" y2="95%">
          <stop offset="0%" stopColor={cBright} stopOpacity="0.45" />
          <stop offset="60%" stopColor={cMid} stopOpacity="0.32" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={`arcRim-${variant}`} x1="100%" y1="0%" x2="40%" y2="100%">
          <stop offset="0%" stopColor={cEdge} stopOpacity="0.35" />
          <stop offset="50%" stopColor={cEdge} stopOpacity="0.65" />
          <stop offset="100%" stopColor={cEdge} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Pure black base */}
      <rect width="1920" height="1080" fill="#000000" />

      {/* Right sweeping ambient glow */}
      <rect width="1920" height="1080" fill={`url(#bgGlow-${variant})`} />

      {/* Diagonal curved wave body starting mid-top and sweeping down-right */}
      <path
        d="M 760 0 C 980 280, 1140 680, 1240 1080 L 1920 1080 L 1920 0 Z"
        fill={`url(#waveSweep1-${variant})`}
      />

      {/* Secondary overlapping sweeping curve */}
      <path
        d="M 1020 0 C 1220 340, 1320 700, 1460 1080 L 1920 1080 L 1920 0 Z"
        fill={`url(#waveSweep2-${variant})`}
      />

      {/* Soft curved light arc rising across the right half (signature wave highlight in Image 1) */}
      <path
        d="M 1920 110 C 1420 280, 1160 640, 1080 1080 L 1165 1080 C 1255 680, 1495 340, 1920 185 Z"
        fill={`url(#arcRim-${variant})`}
        opacity="0.55"
      />
    </svg>
  )
}

/** Olive-gold 20-point scalloped starburst seal with crisp white rating number & label (matches Image 1). */
function RatingStarburst({ rating, label = 'RATING' }: { rating: number; label?: string }) {
  const points: string[] = []
  const spikes = 20
  const outerR = 49
  const innerR = 39
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (Math.PI * i) / spikes - Math.PI / 2
    const x = 50 + r * Math.cos(angle)
    const y = 50 + r * Math.sin(angle)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }

  return (
    <div className="relative flex size-36 sm:size-44 lg:size-48 xl:size-52 items-center justify-center animate-presenter-seal-pop select-none">
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full drop-shadow-[0_10px_25px_rgba(0,0,0,0.85)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="presenterOliveStarburst" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#948636" />
            <stop offset="50%" stopColor="#7a6e28" />
            <stop offset="100%" stopColor="#5e541c" />
          </linearGradient>
        </defs>
        <polygon
          points={points.join(' ')}
          fill="url(#presenterOliveStarburst)"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1"
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center justify-center text-center leading-none">
        <span className="font-['Outfit',sans-serif] text-5xl sm:text-6xl lg:text-7xl xl:text-[78px] font-black tracking-tight text-white drop-shadow-[0_3px_10px_rgba(0,0,0,0.5)]">
          {formatPoints(rating)}
        </span>
        <span className="mt-1 font-['Outfit',sans-serif] text-xs sm:text-sm lg:text-[15px] font-black uppercase tracking-[0.14em] text-white/95">
          {label}
        </span>
      </div>
    </div>
  )
}

/**
 * Large circular player showcase matching Image 1:
 * - Olive-gold inner circle
 * - Bold yellow rotating circular text ring around the perimeter
 * - Large player portrait whose lower body clips neatly inside the circle while the head pops out the top
 * - Overlapping Rating Starburst on bottom-right
 */
function CircularPlayerShowcase({
  name,
  photoUrl,
  rating,
  ringText,
  circleTone = 'gold',
  size = 'spotlight',
}: {
  name: string
  photoUrl: string | null | undefined
  rating: number
  ringText: string
  circleTone?: 'gold' | 'crimson'
  size?: 'spotlight' | 'sold'
}) {
  const { src, onError } = usePlayerImage(name, photoUrl)

  const initials = (name.trim().slice(0, 2) || '??').toUpperCase()
  const unit = `${ringText} • `
  const repeatCount = Math.max(4, Math.round(66 / unit.length))
  const repeated = `${Array.from({ length: repeatCount }, () => ringText).join(' • ')} •`
  const fillCircle =
    circleTone === 'crimson'
      ? 'radial-gradient(circle at 50% 45%, #7c1820 0%, #4b0d12 72%, #2c0609 100%)'
      : 'radial-gradient(circle at 50% 45%, #7b6f17 0%, #584e0d 72%, #3a3406 100%)'

  const boxStyle =
    size === 'sold'
      ? { width: 'clamp(330px, 57vh, 600px)', height: 'clamp(330px, 57vh, 600px)' }
      : { width: 'clamp(340px, 64vh, 660px)', height: 'clamp(340px, 64vh, 660px)' }

  return (
    <div
      className="relative flex items-center justify-center select-none shrink-0"
      style={boxStyle}
    >
      {/* Filled circular backing (matches Image 1 olive-gold disc) */}
      <div
        className="absolute inset-[9%] rounded-full shadow-[0_0_60px_rgba(0,0,0,0.85)]"
        style={{ background: fillCircle }}
      />

      {/* Rotating yellow circular text ring (STAR PLAYER STAR PLAYER ...) */}
      {/* Rotating yellow circular text ring filling the full 360° circle */}
      <div
        className="pointer-events-none absolute inset-0 animate-presenter-spin-slow will-change-transform"
        style={{ transformOrigin: 'center center' }}
      >
        <svg
          viewBox="0 0 400 400"
          className="size-full"
          aria-hidden="true"
        >
          <defs>
            <path
              id={`ringTextPath-${circleTone}`}
              d="M 200, 200 m -174, 0 a 174,174 0 1,1 348,0 a 174,174 0 1,1 -348,0"
            />
          </defs>
          <text
            fill="#fde047"
            fontSize="21"
            fontWeight="900"
            letterSpacing="2.4"
            fontFamily="Outfit, sans-serif"
          >
            <textPath
              href={`#ringTextPath-${circleTone}`}
              startOffset="0%"
              textLength="1075"
              lengthAdjust="spacing"
            >
              {repeated}
            </textPath>
          </text>
        </svg>
      </div>

      {/* Player Portrait: bottom half clipped neatly to the inner circle, head unclipped at top */}
      <div
        className="relative z-10 flex h-full w-full items-end justify-center animate-presenter-player-in"
        style={{
          clipPath: 'polygon(-10% -30%, 110% -30%, 100% 54%, 88% 77%, 73% 89%, 50% 91%, 27% 89%, 12% 77%, 0% 54%)',
        }}
      >
        <div
          className="flex h-[92%] w-[88%] items-end justify-center"
        >
          {!src ? (
            <div className="mb-10 flex size-60 sm:size-72 lg:size-80 items-center justify-center rounded-full border-4 border-amber-300/70 bg-black/50">
              <span className="font-['Outfit',sans-serif] text-7xl sm:text-8xl font-black text-amber-200">
                {initials}
              </span>
            </div>
          ) : (
            <img
              src={src}
              alt={name}
              referrerPolicy="no-referrer"
              onError={onError}
              className="h-full w-full object-contain object-bottom scale-[1.14] origin-bottom"
              style={{
                filter: 'drop-shadow(0 12px 28px rgba(0, 0, 0, 0.75))',
              }}
            />
          )}
        </div>
      </div>

      {/* Overlapping Starburst Rating Seal at Bottom-Right */}
      <div className="absolute -bottom-2 -right-2 sm:-bottom-3 sm:-right-3 z-20">
        <RatingStarburst rating={rating} label="RATING" />
      </div>
    </div>
  )
}

const CELEBRATION_SPARKS = [
  { left: '8%', bottom: '8%', size: 6, delay: '0s', dur: '4.2s', color: '#fde047' },
  { left: '16%', bottom: '12%', size: 8, delay: '0.8s', dur: '5.1s', color: '#f5af19' },
  { left: '24%', bottom: '6%', size: 5, delay: '1.6s', dur: '4.4s', color: '#ffffff' },
  { left: '33%', bottom: '15%', size: 7, delay: '0.4s', dur: '4.8s', color: '#fde047' },
  { left: '42%', bottom: '10%', size: 6, delay: '2.1s', dur: '5.3s', color: '#fbbf24' },
  { left: '54%', bottom: '8%', size: 8, delay: '1.1s', dur: '4.5s', color: '#fde047' },
  { left: '63%', bottom: '14%', size: 5, delay: '0.3s', dur: '4.9s', color: '#ffffff' },
  { left: '72%', bottom: '7%', size: 7, delay: '1.9s', dur: '4.3s', color: '#f5af19' },
  { left: '81%', bottom: '12%', size: 6, delay: '0.7s', dur: '5.0s', color: '#fde047' },
  { left: '90%', bottom: '9%', size: 8, delay: '1.4s', dur: '4.6s', color: '#fbbf24' },
  { left: '29%', bottom: '4%', size: 5, delay: '2.6s', dur: '4.7s', color: '#f5af19' },
  { left: '68%', bottom: '5%', size: 6, delay: '2.9s', dur: '5.2s', color: '#fde047' },
] as const

/**
 * Full-screen widescreen Presenter stage matching the reference broadcast design.
 */
export function PresenterPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const players = usePlayers(eventId)
  const teams = useTeams(eventId)
  const purchases = usePurchases(eventId, 5)

  const stageRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [audioUnlocked, setAudioUnlocked] = useState(() => isAuctionAudioUnlocked())
  const [muted, setMuted] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)

  const [soldAnnouncement, setSoldAnnouncement] = useState<SoldPlayerAnnouncement | null>(null)
  const soldAtSpotlightIdRef = useRef<string | null>(null)
  const lastSpotlightIdRef = useRef<string | null>(null)
  const handledSoldIdRef = useRef<string | null>(null)
  const clearedSoldIdRef = useRef<string | null>(null)
  const hideControlsTimerRef = useRef<number | null>(null)

  const [spotlightMeta, setSpotlightMeta] = useState<{
    nationality?: string | null
    role?: string | null
    star?: string | null
  }>({})

  const currencyLabel = event?.currencyLabel ?? '₹'
  const eventName = event?.name || 'Nexturn Premier League'

  useEffect(() => {
    return subscribeAuctionAudioState(setAudioUnlocked)
  }, [])

  const handleUnlockAudio = useCallback(async () => {
    const ok = await unlockAuctionAudio()
    setAudioUnlocked(ok)
  }, [])

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Auto-hide toolbar in fullscreen when mouse is idle
  useEffect(() => {
    if (!isFullscreen) {
      setControlsVisible(true)
      if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current)
      return
    }
    function poke() {
      setControlsVisible(true)
      if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current)
      hideControlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false)
      }, 2200)
    }
    poke()
    window.addEventListener('mousemove', poke)
    return () => {
      window.removeEventListener('mousemove', poke)
      if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current)
    }
  }, [isFullscreen])

  const toggleFullscreen = useCallback(async () => {
    await unlockAuctionAudio()
    if (!document.fullscreenElement) {
      try {
        await (stageRef.current ?? document.documentElement).requestFullscreen()
      } catch {
        // Ignore if blocked
      }
    } else {
      try {
        await document.exitFullscreen()
      } catch {
        // Ignore
      }
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        void toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleFullscreen])

  const spotlight: SpotlightPlayer | null = event?.spotlightPlayer ?? null
  const spotlightRef = useRef<SpotlightPlayer | null>(spotlight)
  spotlightRef.current = spotlight

  const showSoldCelebration = useCallback(
    (announcement: SoldPlayerAnnouncement) => {
      const key = announcement.purchaseId ?? `${announcement.playerId ?? announcement.playerName}:${announcement.soldAt ?? ''}`
      if (clearedSoldIdRef.current === key) return
      handledSoldIdRef.current = key
      soldAtSpotlightIdRef.current = spotlightRef.current?.spotlightId ?? null
      setSoldAnnouncement(announcement)
      if (!muted) {
        void playIplSoldTune()
      }
    },
    [muted],
  )

  const clearSoldCelebration = useCallback(() => {
    setSoldAnnouncement((prev) => {
      if (prev) {
        const key = prev.purchaseId ?? `${prev.playerId ?? prev.playerName}:${prev.soldAt ?? ''}`
        clearedSoldIdRef.current = key
      }
      return null
    })
    stopIplSoldTune()
  }, [])

  // Fallback: if Realtime broadcast was missed across tabs/devices, pick up fresh
  // `lastSoldPlayer` updates from `useEvent` polling so the SOLD screen still shows
  // and keeps playing until the admin draws the next player in Record Purchase.
  useEffect(() => {
    const last = event?.lastSoldPlayer
    if (!last || !last.playerName || !last.teamName) return
    if (event?.spotlightPlayer) return
    const key = last.purchaseId ?? `${last.playerId ?? last.playerName}:${last.soldAt ?? ''}`
    if (handledSoldIdRef.current === key || clearedSoldIdRef.current === key) return
    const soldMs = last.soldAt ? Date.parse(last.soldAt) : NaN
    if (Number.isFinite(soldMs) && Date.now() - soldMs <= 30_000) {
      showSoldCelebration(last)
    } else {
      handledSoldIdRef.current = key
    }
  }, [event?.lastSoldPlayer, event?.spotlightPlayer, showSoldCelebration])

  useEffect(() => {
    function onPlayerSold(e: Event) {
      const custom = e as CustomEvent<SoldPlayerAnnouncement>
      const detail = custom.detail
      if (!detail || !detail.playerName || !detail.teamName) return
      showSoldCelebration(detail)
    }
    window.addEventListener('auction:player_sold', onPlayerSold)
    return () => {
      window.removeEventListener('auction:player_sold', onPlayerSold)
      stopIplSoldTune()
    }
  }, [showSoldCelebration])

  // Keep SOLD screen & music running until the next player appears (or break/countdown starts)
  useEffect(() => {
    const id = spotlight?.spotlightId ?? null
    if (id && id !== lastSpotlightIdRef.current) {
      lastSpotlightIdRef.current = id
      if (id !== soldAtSpotlightIdRef.current) {
        clearSoldCelebration()
      }
      if (!muted) {
        void playPlayerIntroCue()
      }
    } else if (!id) {
      lastSpotlightIdRef.current = null
    }
  }, [spotlight?.spotlightId, muted, clearSoldCelebration])

  useEffect(() => {
    if (event?.break?.active || event?.countdown?.targetTime) {
      clearSoldCelebration()
    }
  }, [event?.break?.active, event?.countdown?.targetTime, clearSoldCelebration])

  useEffect(() => {
    if (event?.roundPhase === 'round1_ended' || event?.roundPhase === 'round2_ended') {
      clearSoldCelebration()
    }
  }, [event?.roundPhase, clearSoldCelebration])

  useEffect(() => {
    function onRoundChange(e: Event) {
      const custom = e as CustomEvent<{ roundPhase?: string }>
      const phase = custom.detail?.roundPhase
      if (phase === 'round1_ended' || phase === 'round2_ended') {
        clearSoldCelebration()
      }
    }
    window.addEventListener('auction:round_change', onRoundChange)
    return () => window.removeEventListener('auction:round_change', onRoundChange)
  }, [clearSoldCelebration])

  useEffect(() => {
    function onPresenterViewChange(e: Event) {
      const custom = e as CustomEvent<{ presenterView?: string }>
      if (custom.detail?.presenterView && custom.detail.presenterView !== 'auto') {
        clearSoldCelebration()
      }
    }
    window.addEventListener('auction:presenter_view_change', onPresenterViewChange)
    return () => window.removeEventListener('auction:presenter_view_change', onPresenterViewChange)
  }, [clearSoldCelebration])

  const lastSoldRef = useRef(event?.lastSoldPlayer ?? null)
  lastSoldRef.current = event?.lastSoldPlayer ?? null

  useEffect(() => {
    function onPresenterCommand(e: Event) {
      const custom = e as CustomEvent<{ command?: PresenterCommandType }>
      const cmd = custom.detail?.command
      if (cmd === 'clear_sold') {
        clearSoldCelebration()
      } else if (cmd === 'replay_last_sold') {
        if (lastSoldRef.current) {
          showSoldCelebration(lastSoldRef.current)
        }
      } else if (cmd === 'toggle_mute') {
        setMuted((m) => !m)
      }
    }
    window.addEventListener('auction:presenter_command', onPresenterCommand)
    return () => window.removeEventListener('auction:presenter_command', onPresenterCommand)
  }, [clearSoldCelebration, showSoldCelebration])

  useEffect(() => {
    if (muted) {
      stopIplSoldTune()
      stopStageAmbientMusic()
    }
  }, [muted])

  useEffect(() => {
    if (!spotlight?.playerId) {
      setSpotlightMeta({})
      return
    }
    const localPlayer = players.data.find((p) => p.id === spotlight.playerId)
    if (localPlayer) {
      setSpotlightMeta({
        nationality: spotlight.nationality ?? localPlayer.nationality,
        role: spotlight.role ?? localPlayer.role,
        star: spotlight.star ?? localPlayer.star,
      })
      return
    }
    if (spotlight.nationality !== undefined || spotlight.role !== undefined || spotlight.star !== undefined) {
      setSpotlightMeta({
        nationality: spotlight.nationality,
        role: spotlight.role,
        star: spotlight.star,
      })
      return
    }
    const sb = getSupabase()
    if (!sb) return
    let active = true
    void sb
      .from('players')
      .select('data')
      .eq('id', spotlight.playerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return
        const d = (data.data ?? {}) as Record<string, unknown>
        setSpotlightMeta({
          nationality: typeof d.nationality === 'string' ? d.nationality : null,
          role: typeof d.role === 'string' ? d.role : null,
          star: typeof d.star === 'string' ? d.star : null,
        })
      })
    return () => {
      active = false
    }
  }, [spotlight?.playerId, spotlight?.nationality, spotlight?.role, spotlight?.star, players.data])

  const totals = useMemo(() => {
    const available = players.data.filter((p) => p.status === 'available').length
    const sold = players.data.filter((p) => p.status === 'sold').length
    const spent = teams.data.reduce((sum, t) => sum + t.totalSpent, 0)
    return {
      teams: teams.data.length,
      available,
      sold,
      total: players.data.length,
      spent,
    }
  }, [players.data, teams.data])

  const soldPlayerRecord = useMemo(() => {
    if (!soldAnnouncement?.playerId) return null
    return players.data.find((p) => p.id === soldAnnouncement.playerId) ?? null
  }, [soldAnnouncement?.playerId, players.data])

  function handleTestSoldAnimation() {
    void unlockAuctionAudio().then(() => {
      const sample = spotlight
        ? {
          purchaseId: `test-${Date.now()}`,
          playerId: spotlight.playerId,
          playerName: spotlight.name,
          playerPhotoUrl: spotlight.photoUrl,
          playerPoints: spotlight.points,
          teamName: teams.data[0]?.name ?? 'TEAM 01',
          finalPrice: Math.max(spotlight.basePrice * 2, 20000000),
          nationality: spotlightMeta.nationality ?? spotlight.nationality,
          role: spotlightMeta.role ?? spotlight.role,
          star: spotlightMeta.star ?? spotlight.star,
        }
        : {
          purchaseId: `test-${Date.now()}`,
          playerName: players.data[0]?.name ?? 'ROHIT SHARMA',
          playerPhotoUrl: players.data[0]?.photoUrl ?? null,
          playerPoints: players.data[0]?.points ?? 9.5,
          teamName: teams.data[0]?.name ?? 'TEAM 01',
          finalPrice: 50000000,
          nationality: players.data[0]?.nationality ?? 'Indian',
          role: players.data[0]?.role ?? 'Batter',
          star: players.data[0]?.star ?? '⭐',
        }
      showSoldCelebration(sample)
    })
  }

  const effectiveNationality = spotlight?.nationality ?? spotlightMeta.nationality ?? null
  const effectiveRole = spotlight?.role ?? spotlightMeta.role ?? null
  const effectiveStar = spotlight?.star ?? spotlightMeta.star ?? null
  const spotlightIsStar = isStar(effectiveStar)
  const spotlightIsOverseas = isOverseas(effectiveNationality)

  const soldData = soldAnnouncement
  const soldStar = isStar(soldData?.star ?? soldPlayerRecord?.star)
  const soldOverseas = isOverseas(soldData?.nationality ?? soldPlayerRecord?.nationality)
  const soldRole = soldData?.role ?? soldPlayerRecord?.role ?? null
  const soldPoints = soldData?.playerPoints ?? soldPlayerRecord?.points ?? 0

  const presenterView = event?.presenterView ?? 'auto'
  const isBreakOrCountdownVisible =
    !soldData &&
    presenterView === 'auto' &&
    !spotlight &&
    Boolean(event?.break?.active || event?.countdown?.targetTime)

  // Start ambient stage music when the Break or Start Timer screen is active on Presenter,
  // and stop it immediately when those screens are closed or muted.
  useEffect(() => {
    if (isBreakOrCountdownVisible && !muted) {
      void playStageAmbientMusic()
    } else {
      stopStageAmbientMusic()
    }
  }, [isBreakOrCountdownVisible, muted, audioUnlocked])

  useEffect(() => {
    return () => {
      stopStageAmbientMusic()
    }
  }, [])
  const liveRound1Snapshot = useMemo(
    () =>
      event?.round1Results ??
      buildRoundSnapshot({
        round: 1,
        teams: teams.data,
        players: players.data,
        poolSize: event?.roundPoolPlayerIds?.length ?? 0,
      }),
    [event?.round1Results, event?.roundPoolPlayerIds?.length, teams.data, players.data],
  )
  const liveRound2Snapshot = useMemo(
    () =>
      event?.round2Results ??
      buildRoundSnapshot({
        round: 2,
        teams: teams.data,
        players: players.data,
        poolSize: event?.roundPoolPlayerIds?.length ?? 0,
        excludedTeamIds: event?.eliminatedTeamIds ?? [],
      }),
    [
      event?.round2Results,
      event?.roundPoolPlayerIds?.length,
      event?.eliminatedTeamIds,
      teams.data,
      players.data,
    ],
  )

  return (
    <div
      ref={stageRef}
      data-presenter-stage="true"
      onClick={() => void handleUnlockAudio()}
      className={`relative w-full overflow-hidden select-none bg-black text-white ${isFullscreen
          ? 'fixed inset-0 z-50 h-dvh w-screen'
          : 'min-h-[calc(100dvh-3.25rem)]'
        }`}
    >
      {/* Discreet Bottom-Right Controls (auto-hides in Fullscreen; keeps top-right broadcast clean) */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute right-4 bottom-4 z-40 flex flex-wrap items-center gap-2 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
      >
        <button
          type="button"
          onClick={() => {
            if (!audioUnlocked) {
              void handleUnlockAudio()
            } else {
              setMuted((m) => !m)
            }
          }}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold backdrop-blur-md transition cursor-pointer ${muted
              ? 'border-rose-500/50 bg-rose-950/80 text-rose-200'
              : audioUnlocked
                ? 'border-emerald-400/50 bg-black/75 text-emerald-300'
                : 'border-amber-400/70 bg-black/80 text-amber-300 animate-pulse'
            }`}
        >
          {muted ? (
            <>
              <VolumeX className="size-3.5" />
              Muted
            </>
          ) : audioUnlocked ? (
            <>
              <Volume2 className="size-3.5" />
              Sound Ready
            </>
          ) : (
            <>
              <Volume2 className="size-3.5" />
              Enable Sound
            </>
          )}
        </button>

        {soldData && !isFullscreen ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={clearSoldCelebration}
          >
            Clear Sold
          </Button>
        ) : null}

        {!isFullscreen ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<Music className="size-3.5 text-accent" />}
            onClick={handleTestSoldAnimation}
          >
            Test Sold + Tune
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="primary"
          icon={isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          onClick={() => void toggleFullscreen()}
        >
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </Button>
      </div>

      {/* =====================================================================
          VIEW 1: PLAYER SOLD ANIMATION (Championship Crimson Celebration)
         ===================================================================== */}
      {soldData ? (
        <div
          key={`sold-${soldData.purchaseId ?? soldData.playerName}`}
          className="relative flex h-full min-h-[inherit] w-full flex-col justify-between overflow-hidden px-6 py-5 sm:px-10 sm:py-7"
        >
          <BroadcastBackdrop variant="crimson" />

          {/* Floating Golden Celebration Sparks */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            {CELEBRATION_SPARKS.map((spark, idx) => (
              <span
                key={idx}
                className="absolute rounded-full animate-presenter-float-spark"
                style={{
                  left: spark.left,
                  bottom: spark.bottom,
                  width: `${spark.size}px`,
                  height: `${spark.size}px`,
                  backgroundColor: spark.color,
                  boxShadow: `0 0 12px ${spark.color}`,
                  animationDelay: spark.delay,
                  animationDuration: spark.dur,
                }}
              />
            ))}
          </div>

          {/* Top Bar (Consistent with Spotlight header) */}
          <header className="relative z-10 flex items-start justify-between">
            <div className="flex flex-col leading-none">
              <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">
                NPL <span className="text-[#f5eb3b]">2026</span>
              </span>
              <span className="mt-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-[0.24em] text-white/75">
                WHERE PASSION MEETS PRECISION
              </span>
            </div>
            <p className="font-['Outfit',sans-serif] text-base sm:text-xl lg:text-2xl font-black uppercase tracking-wide text-white">
              {eventName}
            </p>
          </header>

          {/* Centerpiece SOLD Stage */}
          <div className="relative z-10 my-auto flex flex-col items-center justify-center py-2">
            {/* Center Circular Player Showcase with Breathing Stadium Halo */}
            <div className="relative flex items-center justify-center">
              <div
                className="pointer-events-none absolute -inset-10 rounded-full blur-3xl animate-presenter-halo-breathe"
                style={{
                  background:
                    'radial-gradient(circle, rgba(245, 235, 59, 0.28) 0%, rgba(220, 38, 38, 0.32) 48%, transparent 72%)',
                }}
              />
              <CircularPlayerShowcase
                name={soldData.playerName}
                photoUrl={soldData.playerPhotoUrl}
                rating={soldPoints}
                ringText={soldStar ? 'STAR PLAYER' : 'SOLD OUT'}
                circleTone="crimson"
                size="sold"
              />
            </div>

            {/* Mobile SOLD stamp */}
            <div className="mt-3 flex md:hidden items-center gap-2 rounded-full border border-[#f5eb3b]/80 bg-black/75 px-5 py-1.5 animate-presenter-stamp-slam">
              <Gavel className="size-4 text-[#f5eb3b]" />
              <span className="font-['Outfit',sans-serif] text-xl font-black uppercase tracking-widest text-white">
                SOLD
              </span>
            </div>

            {/* Slanted Yellow Player Name Bar with Shimmer Sweep */}
            <div className="mt-5 flex justify-center w-full animate-presenter-banner-in">
              <div
                className="relative inline-flex w-fit max-w-full items-center justify-center overflow-hidden bg-[#f5eb3b] px-12 sm:px-16 py-2.5 sm:py-3.5 shadow-[0_14px_38px_rgba(0,0,0,0.7)]"
                style={{
                  clipPath: 'polygon(24px 0%, 100% 0%, calc(100% - 24px) 100%, 0% 100%)',
                }}
              >
                <span
                  className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-transparent via-white/55 to-transparent animate-presenter-shimmer-sweep"
                  aria-hidden="true"
                />
                <h1
                  className="relative whitespace-nowrap text-center font-['Outfit',sans-serif] font-black uppercase tracking-tight text-black leading-none"
                  style={{ fontSize: 'clamp(2rem, 4.2vw, 4rem)' }}
                >
                  {soldData.playerName}
                </h1>
              </div>
            </div>

            {/* Unified Acquisition Banner: SOLD TO [TEAM] + [PRICE] */}
            <div className="mt-4 flex justify-center w-full animate-presenter-rise-1">
              <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-3 sm:gap-4 rounded-[30px] bg-white px-5 sm:px-7 py-2.5 sm:py-3 shadow-[0_18px_45px_rgba(0,0,0,0.8)]">
                <span className="rounded-full bg-[#8f0a14] px-4 py-1.5 font-['Outfit',sans-serif] text-xs sm:text-sm font-black uppercase tracking-[0.2em] text-[#f5eb3b]">
                  SOLD TO
                </span>
                <span
                  className="whitespace-nowrap font-['Outfit',sans-serif] font-black uppercase tracking-tight text-black leading-none"
                  style={{ fontSize: 'clamp(1.65rem, 3.2vw, 3.1rem)' }}
                >
                  {soldData.teamName}
                </span>
                {soldData.finalPrice ? (
                  <span className="rounded-full bg-[#090b10] px-5 py-1.5 font-['Outfit',sans-serif] text-xl sm:text-2xl lg:text-3xl font-black uppercase tracking-tight text-[#f5eb3b] tabular-nums shadow-inner">
                    {formatBroadcastPrice(soldData.finalPrice, currencyLabel)}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Subtle Role / Star / Overseas Metadata Strip */}
            {(soldRole || soldStar || soldOverseas) ? (
              <div className="mt-3.5 flex flex-wrap items-center justify-center gap-4 text-xs sm:text-sm font-bold uppercase tracking-[0.18em] text-white/80 animate-presenter-rise-2">
                {soldRole ? <span>{soldRole}</span> : null}
                {soldRole && (soldStar || soldOverseas) ? <span className="text-white/35">•</span> : null}
                {soldStar ? (
                  <span className="inline-flex items-center gap-1.5 text-[#f5eb3b]">
                    <Sparkles className="size-3.5" />
                    STAR PLAYER
                  </span>
                ) : null}
                {soldStar && soldOverseas ? <span className="text-white/35">•</span> : null}
                {soldOverseas ? (
                  <span className="inline-flex items-center gap-1.5 text-sky-300">
                    <Plane className="size-3.5" />
                    OVERSEAS
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="h-4" />
        </div>
      ) : presenterView === 'standings' ? (
        /* ===================================================================
           DIRECTOR OVERRIDE: LIVE TEAM STANDINGS
           =================================================================== */
        <div className="relative flex h-full min-h-[inherit] w-full flex-col overflow-hidden">
          <BroadcastBackdrop variant="gold" />
          <LiveStandingsStage
            teams={teams.data}
            players={players.data}
            eliminatedTeamIds={event?.eliminatedTeamIds ?? []}
            currentRound={event?.currentRound ?? 0}
            eventName={eventName}
            currencyLabel={currencyLabel}
          />
        </div>
      ) : presenterView === 'round1_results' ? (
        /* ===================================================================
           DIRECTOR OVERRIDE: ROUND 1 RESULTS
           =================================================================== */
        <div className="relative flex h-full min-h-[inherit] w-full flex-col overflow-hidden">
          <BroadcastBackdrop variant="crimson" />
          <Round1ResultsStage snapshot={liveRound1Snapshot} eventName={eventName} />
        </div>
      ) : presenterView === 'round2_results' ? (
        /* ===================================================================
           DIRECTOR OVERRIDE: ROUND 2 FINAL RESULTS
           =================================================================== */
        <div className="relative flex h-full min-h-[inherit] w-full flex-col overflow-hidden">
          <BroadcastBackdrop variant="gold" />
          <Round2FinalResultsStage
            snapshot={liveRound2Snapshot}
            eventName={eventName}
            currencyLabel={currencyLabel}
          />
        </div>
      ) : presenterView === 'auto' && spotlight ? (
        /* ===================================================================
           VIEW 2: LIVE PLAYER SPOTLIGHT (Exact Match to Image 1)
           =================================================================== */
        <div
          key={`spotlight-${spotlight.spotlightId}`}
          className="relative flex h-full min-h-[inherit] w-full flex-col justify-between overflow-hidden"
        >
          <BroadcastBackdrop variant="gold" />

          {/* Top Brand Bar (Matches Image 1 Top-Left & Top-Right) */}
          <header className="relative z-10 flex items-start justify-between px-6 pt-5 sm:px-10 sm:pt-7">
            <div className="flex flex-col leading-none">
              <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">
                NPL <span className="text-[#f5eb3b]">2026</span>
              </span>
              <span className="mt-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-[0.24em] text-white/75">
                WHERE PASSION MEETS PRECISION
              </span>
            </div>

            <p className="font-['Outfit',sans-serif] text-base sm:text-xl lg:text-2xl font-black uppercase tracking-wide text-white">
              {eventName}
            </p>
          </header>

          {/* Main Asymmetric Split Stage (Matches Image 1 Proportions & Placement) */}
          <div className="relative z-10 my-auto flex w-full flex-col lg:flex-row items-center justify-between gap-6 lg:gap-0 py-2">
            {/* LEFT SIDE (~42%): Huge Circular Player + Starburst Rating + STAR PLAYER */}
            <div className="flex w-full lg:w-[42%] flex-col items-center justify-center pl-4 sm:pl-8 lg:pl-10 pr-2">
              <CircularPlayerShowcase
                name={spotlight.name}
                photoUrl={spotlight.photoUrl}
                rating={spotlight.points}
                ringText={spotlightIsStar ? 'STAR PLAYER' : 'NEXTURN LEAGUE'}
                circleTone="gold"
                size="spotlight"
              />

              {/* Bottom-left Star Player / Overseas Callout (Matches Image 1: ⚠️ STAR PLAYER ⚠️) */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-4 min-h-[44px] animate-presenter-rise-2">
                {spotlightIsStar ? (
                  <div className="inline-flex items-center gap-3">
                    <AlertTriangleBadge className="size-8 sm:size-10" />
                    <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl lg:text-4xl font-black uppercase tracking-wide text-white drop-shadow-[0_3px_12px_rgba(0,0,0,0.85)]">
                      STAR PLAYER
                    </span>
                    <AlertTriangleBadge className="size-8 sm:size-10" />
                  </div>
                ) : spotlightIsOverseas ? (
                  <div className="inline-flex items-center gap-2.5 text-sky-300">
                    <Plane className="size-7 sm:size-8" />
                    <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black uppercase tracking-wide">
                      OVERSEAS PLAYER
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* RIGHT SIDE (~58%): Auto-sized Slanted Yellow Name Bar + Centered Role/Rating, Base Price Pill & Flag */}
            <div className="flex w-full lg:w-[58%] flex-col items-center text-center space-y-6 sm:space-y-8 px-6 lg:px-10">
              {/* Slanted Yellow Name Banner sized dynamically to player's name */}
              <div className="w-full flex justify-center animate-presenter-banner-in">
                <div
                  className="inline-flex w-fit max-w-full items-center justify-center bg-[#f5eb3b] py-3.5 sm:py-4.5 px-12 sm:px-16 shadow-[0_14px_35px_rgba(0,0,0,0.65)]"
                  style={{
                    clipPath: 'polygon(26px 0%, 100% 0%, calc(100% - 26px) 100%, 0% 100%)',
                  }}
                >
                  <h1
                    className="whitespace-nowrap font-['Outfit',sans-serif] font-black uppercase tracking-tight text-black leading-none"
                    style={{ fontSize: 'clamp(2rem, 4.1vw, 4.2rem)' }}
                  >
                    {spotlight.name}
                  </h1>
                </div>
              </div>

              {/* Centered Info Stack aligned cleanly beneath the yellow name banner */}
              <div className="flex w-full max-w-[780px] flex-col items-center space-y-6 sm:space-y-8">
                {/* Role & Rating Line (Pure white bold uppercase, balanced spacing) */}
                <div className="flex w-full flex-wrap items-center justify-around gap-x-10 gap-y-2 animate-presenter-rise-1">
                  <span
                    className="font-['Outfit',sans-serif] font-bold uppercase tracking-wide text-white"
                    style={{ fontSize: 'clamp(1.6rem, 2.5vw, 2.5rem)' }}
                  >
                    {(effectiveRole || 'PLAYER').toUpperCase()}
                  </span>
                  <span
                    className="font-['Outfit',sans-serif] font-bold uppercase tracking-wide text-white"
                    style={{ fontSize: 'clamp(1.6rem, 2.5vw, 2.5rem)' }}
                  >
                    RATING - {formatPoints(spotlight.points)}
                  </span>
                </div>

                {/* Crisp Single-Line White Base Price Pill */}
                <div className="w-full flex justify-center animate-presenter-rise-2">
                  <div className="inline-flex max-w-full items-center justify-center rounded-[32px] bg-white px-10 sm:px-14 py-4 sm:py-5 shadow-[0_18px_45px_rgba(0,0,0,0.75)]">
                    <span
                      className="whitespace-nowrap font-['Outfit',sans-serif] font-black uppercase tracking-tight text-black leading-none tabular-nums"
                      style={{ fontSize: 'clamp(1.6rem, 3.3vw, 3.35rem)' }}
                    >
                      BASE PRICE - {formatBroadcastPrice(spotlight.basePrice, currencyLabel)}
                    </span>
                  </div>
                </div>

                {/* Country / Flag Row (Centered cleanly beneath Base Price pill like Image 1) */}
                <div className="flex flex-wrap items-center justify-center gap-5 pt-1 animate-presenter-rise-3">
                  {!spotlightIsOverseas ? (
                    <div className="inline-flex items-center gap-4">
                      <IndiaFlag className="h-9 w-14 sm:h-11 sm:w-16" />
                      <span
                        className="font-['Outfit',sans-serif] font-black uppercase tracking-wider text-white"
                        style={{ fontSize: 'clamp(1.75rem, 2.8vw, 2.75rem)' }}
                      >
                        INDIA
                      </span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-3.5">
                      <Plane className="size-8 sm:size-10 text-sky-300" />
                      <span
                        className="font-['Outfit',sans-serif] font-black uppercase tracking-wider text-white"
                        style={{ fontSize: 'clamp(1.75rem, 2.8vw, 2.75rem)' }}
                      >
                        {(effectiveNationality || 'OVERSEAS').toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="h-6" />
        </div>
      ) : presenterView === 'auto' && event?.break?.active ? (
        /* ===================================================================
           VIEW 3: BREAK / INTERMISSION
           =================================================================== */
        <div className="relative h-full p-4 sm:p-8 flex items-center justify-center">
          <BroadcastBackdrop variant="gold" />
          <div className="relative z-10 w-full max-w-5xl">
            <AuctionBreakScreen breakState={event.break} eventName={eventName} />
          </div>
        </div>
      ) : presenterView === 'auto' && event?.countdown?.targetTime ? (
        /* ===================================================================
           VIEW 4: COUNTDOWN SCREEN
           =================================================================== */
        <div className="relative h-full p-4 sm:p-8 flex items-center justify-center">
          <BroadcastBackdrop variant="gold" />
          <div className="relative z-10 w-full max-w-5xl">
            <StartingInCountdownScreen countdown={event.countdown} eventName={eventName} />
          </div>
        </div>
      ) : presenterView === 'auto' && event?.roundPhase === 'round1_ended' ? (
        /* ===================================================================
           VIEW 5A: ROUND 1 RESULTS (Eliminated & Qualified Teams)
           =================================================================== */
        <div className="relative flex h-full min-h-[inherit] w-full flex-col overflow-hidden">
          <BroadcastBackdrop variant="crimson" />
          <Round1ResultsStage snapshot={liveRound1Snapshot} eventName={eventName} />
        </div>
      ) : presenterView === 'auto' && event?.roundPhase === 'round2_ended' ? (
        /* ===================================================================
           VIEW 5B: ROUND 2 FINAL RESULTS LEADERBOARD & NPL WINNER
           =================================================================== */
        <div className="relative flex h-full min-h-[inherit] w-full flex-col overflow-hidden">
          <BroadcastBackdrop variant="gold" />
          <Round2FinalResultsStage
            snapshot={liveRound2Snapshot}
            eventName={eventName}
            currencyLabel={currencyLabel}
          />
        </div>
      ) : (
        /* ===================================================================
           VIEW 6: STANDBY BROADCAST STAGE (Matching Gold-Black Backdrop)
           =================================================================== */
        <div className="relative flex h-full min-h-[inherit] w-full flex-col justify-between px-6 py-8 sm:px-12 sm:py-10">
          <BroadcastBackdrop variant="gold" />

          <header className="relative z-10 flex items-center justify-between">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-amber-400/40 bg-black/60 px-4 py-1.5 backdrop-blur-md">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-widest text-amber-300">
                Presenter Connected · Live Sync Active
              </span>
            </div>
            <p className="font-['Outfit',sans-serif] text-base sm:text-xl font-black uppercase tracking-wider text-white">
              {eventName}
            </p>
          </header>

          <div className="relative z-10 my-auto flex flex-col items-center text-center max-w-4xl mx-auto">
            <p className="font-['Outfit',sans-serif] text-xs sm:text-sm font-black uppercase tracking-[0.35em] text-[#f5eb3b]">
              Official Auction Broadcast
            </p>
            <h1 className="mt-3 font-['Outfit',sans-serif] text-4xl sm:text-6xl lg:text-7xl font-black uppercase tracking-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
              {eventName}
            </h1>
            <p className="mt-4 max-w-xl text-sm sm:text-base text-white/75">
              Select any player in <span className="font-semibold text-white">Record Purchase</span> on your controller laptop to present them live on this screen.
            </p>

            <div className="mt-10 grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Teams</p>
                <p className="mt-1 font-['Outfit',sans-serif] text-3xl font-black tabular-nums text-white">
                  {totals.teams}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Sold</p>
                <p className="mt-1 font-['Outfit',sans-serif] text-3xl font-black tabular-nums text-[#f5eb3b]">
                  {totals.sold}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Available</p>
                <p className="mt-1 font-['Outfit',sans-serif] text-3xl font-black tabular-nums text-white">
                  {totals.available}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Total Spend</p>
                <p className="mt-1 font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black tabular-nums text-emerald-400">
                  {formatBroadcastPrice(totals.spent, currencyLabel)}
                </p>
              </div>
            </div>
          </div>

          <footer className="relative z-10 border-t border-white/10 pt-4">
            {purchases.data.length > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">
                  Latest Sales:
                </span>
                {purchases.data.slice(0, 3).map((p) => (
                  <span
                    key={p.id}
                    className="rounded-full border border-white/15 bg-black/60 px-3.5 py-1 text-xs font-semibold text-white"
                  >
                    {p.playerNameSnapshot} → <span className="text-[#f5eb3b]">{p.teamNameSnapshot}</span> (
                    {formatBroadcastPrice(p.finalPrice, currencyLabel)})
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-center text-xs font-medium text-white/60">
                Tip: Click <span className="font-bold text-white">Fullscreen</span> (or press{' '}
                <kbd className="rounded border border-white/20 px-1.5 py-0.5 text-[10px]">F</kbd>) on your projector laptop to enable sound and maximize the broadcast stage.
              </p>
            )}
          </footer>
        </div>
      )}
    </div>
  )
}
