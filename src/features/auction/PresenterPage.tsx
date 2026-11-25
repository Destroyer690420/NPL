import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import {
  Maximize2,
  Minimize2,
  Music,
  Plane,
  Radio,
  Star,
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
  subscribeAuctionAudioState,
  unlockAuctionAudio,
} from '@/lib/auctionAudio'
import { getSupabase } from '@/lib/supabase'
import { StartingInCountdownScreen } from './StartingInCountdownScreen'
import { AuctionBreakScreen } from './AuctionBreakScreen'
import { Button } from '@/components/ui/Button'

const SOLD_DISPLAY_MS = 5500
const SOLD_FADE_MS = 400

function resolvePhotoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null
  const trimmed = photoUrl.trim()
  return trimmed || null
}

function tryLocalImageFallback(currentSrc: string): string | null {
  const match = currentSrc.match(/(P\d+\.(?:png|jpg|jpeg|webp))$/i)
  return match ? `/player-images/${match[1]}` : null
}

/** Crisp inline SVG Indian tricolor flag for domestic Indian players. */
function IndiaFlag({ className = 'h-6 w-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 24"
      className={`${className} rounded-[3px] shadow-[0_2px_8px_rgba(0,0,0,0.6)] ring-1 ring-white/25 shrink-0`}
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

/** Golden scalloped 20-point starburst rating seal matching the reference broadcast. */
function RatingStarburst({ rating, label = 'RATING' }: { rating: number; label?: string }) {
  const points: string[] = []
  const spikes = 20
  const outerR = 48
  const innerR = 39
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (Math.PI * i) / spikes - Math.PI / 2
    const x = 50 + r * Math.cos(angle)
    const y = 50 + r * Math.sin(angle)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }

  return (
    <div className="relative flex size-28 sm:size-32 lg:size-36 items-center justify-center animate-presenter-seal-pop select-none">
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full drop-shadow-[0_6px_18px_rgba(0,0,0,0.85)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="presenterStarburstGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="45%" stopColor="#f5af19" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
        </defs>
        <polygon
          points={points.join(' ')}
          fill="url(#presenterStarburstGrad)"
          stroke="#fffbeb"
          strokeWidth="1.5"
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center justify-center text-center leading-none">
        <span className="font-['Outfit',sans-serif] text-3xl sm:text-4xl lg:text-[42px] font-black tracking-tight text-[#090b10]">
          {formatPoints(rating)}
        </span>
        <span className="mt-0.5 font-['Outfit',sans-serif] text-[9px] sm:text-[10px] font-black uppercase tracking-[0.16em] text-[#1c1508]">
          {label}
        </span>
      </div>
    </div>
  )
}

/** Rotating circular badge ring behind the player photo (like the video's circular STAR PLAYER halo). */
function CircularHaloRing({ text }: { text: string }) {
  const repeated = `${text}  •  ${text}  •  ${text}  •  `
  return (
    <svg
      viewBox="0 0 300 300"
      className="pointer-events-none size-[290px] sm:size-[350px] lg:size-[410px] animate-presenter-spin-slow opacity-90"
      aria-hidden="true"
    >
      <defs>
        <path
          id="presenterHaloPath"
          d="M 150, 150 m -124, 0 a 124,124 0 1,1 248,0 a 124,124 0 1,1 -248,0"
        />
      </defs>
      <circle
        cx="150"
        cy="150"
        r="138"
        fill="none"
        stroke="rgba(250, 204, 21, 0.35)"
        strokeWidth="1.5"
        strokeDasharray="6 6"
      />
      <circle
        cx="150"
        cy="150"
        r="110"
        fill="none"
        stroke="rgba(245, 175, 25, 0.45)"
        strokeWidth="2"
      />
      <text
        fill="#fde047"
        fontSize="14"
        fontWeight="900"
        letterSpacing="3.4"
        fontFamily="Outfit, sans-serif"
      >
        <textPath href="#presenterHaloPath" startOffset="0%">
          {repeated}
        </textPath>
      </text>
    </svg>
  )
}

/** Player cutout portrait with local fallback + initial badge fallback. */
function PresenterPlayerPhoto({
  name,
  photoUrl,
  className = '',
}: {
  name: string
  photoUrl: string | null | undefined
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(() => resolvePhotoSrc(photoUrl))
  const [triedLocal, setTriedLocal] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setSrc(resolvePhotoSrc(photoUrl))
    setTriedLocal(false)
    setFailed(false)
  }, [photoUrl, name])

  function onError() {
    if (!triedLocal && src) {
      const local = tryLocalImageFallback(src)
      if (local) {
        setTriedLocal(true)
        setSrc(local)
        return
      }
    }
    setFailed(true)
  }

  const initials = (name.trim().slice(0, 2) || '??').toUpperCase()

  if (!src || failed) {
    return (
      <div
        className={`flex size-56 sm:size-64 lg:size-72 items-center justify-center rounded-full border-4 border-amber-400/80 bg-gradient-to-b from-[#1e263c] to-[#0b101d] shadow-[0_0_50px_rgba(245,175,25,0.45)] ${className}`}
      >
        <span className="font-['Outfit',sans-serif] text-7xl sm:text-8xl font-black text-amber-300">
          {initials}
        </span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      onError={onError}
      className={`h-full w-auto max-w-full object-contain object-bottom select-none ${className}`}
      style={{
        filter:
          'drop-shadow(0 0 12px rgba(254, 240, 138, 0.6)) drop-shadow(0 16px 32px rgba(0, 0, 0, 0.85))',
      }}
    />
  )
}

/**
 * Full-screen widescreen Presenter stage designed for a second projector laptop.
 * Automatically reacts in real time to selections and sales made on the main admin laptop.
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

  const [soldState, setSoldState] = useState<{
    announcement: SoldPlayerAnnouncement
    exiting: boolean
  } | null>(null)
  const soldTimersRef = useRef<{ exit?: number; clear?: number }>({})
  const lastSpotlightIdRef = useRef<string | null>(null)
  const hideControlsTimerRef = useRef<number | null>(null)

  const [spotlightMeta, setSpotlightMeta] = useState<{
    nationality?: string | null
    role?: string | null
    star?: string | null
  }>({})

  const currencyLabel = event?.currencyLabel ?? '₹'
  const eventName = event?.name || 'Nexturn Premier League'

  // Keep track of Web Audio unlock status
  useEffect(() => {
    return subscribeAuctionAudioState(setAudioUnlocked)
  }, [])

  // Unlock audio on first pointer or keyboard interaction anywhere in Presenter
  const handleUnlockAudio = useCallback(async () => {
    const ok = await unlockAuctionAudio()
    setAudioUnlocked(ok)
  }, [])

  // Sync fullscreen state with browser fullscreen API
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Auto-hide toolbar in fullscreen when mouse stops moving
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
      }, 2400)
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

  // Keyboard shortcut: 'F' toggles fullscreen
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        void toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleFullscreen])

  // Trigger SOLD celebration + iconic IPL tune when a player is sold
  const showSoldCelebration = useCallback(
    (announcement: SoldPlayerAnnouncement) => {
      if (soldTimersRef.current.exit) window.clearTimeout(soldTimersRef.current.exit)
      if (soldTimersRef.current.clear) window.clearTimeout(soldTimersRef.current.clear)

      setSoldState({ announcement, exiting: false })
      if (!muted) {
        void playIplSoldTune()
      }

      soldTimersRef.current.exit = window.setTimeout(() => {
        setSoldState((prev) => (prev ? { ...prev, exiting: true } : null))
      }, SOLD_DISPLAY_MS)

      soldTimersRef.current.clear = window.setTimeout(() => {
        setSoldState(null)
      }, SOLD_DISPLAY_MS + SOLD_FADE_MS)
    },
    [muted],
  )

  useEffect(() => {
    const timers = soldTimersRef.current
    function onPlayerSold(e: Event) {
      const custom = e as CustomEvent<SoldPlayerAnnouncement>
      const detail = custom.detail
      if (!detail || !detail.playerName || !detail.teamName) return
      showSoldCelebration(detail)
    }
    window.addEventListener('auction:player_sold', onPlayerSold)
    return () => {
      window.removeEventListener('auction:player_sold', onPlayerSold)
      if (timers.exit) window.clearTimeout(timers.exit)
      if (timers.clear) window.clearTimeout(timers.clear)
    }
  }, [showSoldCelebration])

  const spotlight: SpotlightPlayer | null = event?.spotlightPlayer ?? null

  // Play subtle intro cue when a new player enters the stage
  useEffect(() => {
    const id = spotlight?.spotlightId ?? null
    if (id && id !== lastSpotlightIdRef.current) {
      lastSpotlightIdRef.current = id
      if (!muted) {
        void playPlayerIntroCue()
      }
    } else if (!id) {
      lastSpotlightIdRef.current = null
    }
  }, [spotlight?.spotlightId, muted])

  // Fallback player lookup for nationality / role / star if missing on spotlight
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
    if (!soldState?.announcement.playerId) return null
    return players.data.find((p) => p.id === soldState.announcement.playerId) ?? null
  }, [soldState?.announcement.playerId, players.data])

  function handleTestSoldAnimation() {
    void unlockAuctionAudio().then(() => {
      const sample = spotlight
        ? {
            purchaseId: `test-${Date.now()}`,
            playerId: spotlight.playerId,
            playerName: spotlight.name,
            playerPhotoUrl: spotlight.photoUrl,
            playerPoints: spotlight.points,
            teamName: teams.data[0]?.name ?? 'ROYAL TITANS',
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

  // Resolved fields for current spotlighted player
  const effectiveNationality = spotlight?.nationality ?? spotlightMeta.nationality ?? null
  const effectiveRole = spotlight?.role ?? spotlightMeta.role ?? null
  const effectiveStar = spotlight?.star ?? spotlightMeta.star ?? null
  const spotlightIsStar = isStar(effectiveStar)
  const spotlightIsOverseas = isOverseas(effectiveNationality)

  // Resolved fields for sold celebration
  const soldData = soldState?.announcement ?? null
  const soldStar = isStar(soldData?.star ?? soldPlayerRecord?.star)
  const soldOverseas = isOverseas(soldData?.nationality ?? soldPlayerRecord?.nationality)
  const soldRole = soldData?.role ?? soldPlayerRecord?.role ?? null
  const soldPoints = soldData?.playerPoints ?? soldPlayerRecord?.points ?? 0

  return (
    <div
      ref={stageRef}
      onClick={() => void handleUnlockAudio()}
      className={`relative w-full overflow-hidden select-none bg-[#05060a] text-white ${
        isFullscreen
          ? 'fixed inset-0 z-50 h-dvh w-screen'
          : 'min-h-[calc(100dvh-4.5rem)] rounded-2xl border border-line-strong shadow-2xl'
      }`}
    >
      {/* Floating Control Toolbar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute right-4 top-4 z-40 flex flex-wrap items-center gap-2 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
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
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold backdrop-blur-md transition cursor-pointer ${
            muted
              ? 'border-rose-500/50 bg-rose-950/70 text-rose-200'
              : audioUnlocked
                ? 'border-emerald-400/50 bg-emerald-950/70 text-emerald-200'
                : 'border-amber-400/70 bg-amber-500/20 text-amber-200 animate-pulse'
          }`}
        >
          {muted ? (
            <>
              <VolumeX className="size-3.5" />
              Sound Muted
            </>
          ) : audioUnlocked ? (
            <>
              <Volume2 className="size-3.5" />
              IPL Sound Ready
            </>
          ) : (
            <>
              <Volume2 className="size-3.5" />
              Click to Enable Sound
            </>
          )}
        </button>

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
          VIEW 1: PLAYER SOLD ANIMATION (Crimson-Red Stadium Theme + IPL Tune)
         ===================================================================== */}
      {soldData ? (
        <div
          key={`sold-${soldData.purchaseId ?? soldData.playerName}`}
          className={`relative flex h-full min-h-[inherit] w-full flex-col justify-between px-6 py-6 sm:px-12 sm:py-8 transition-opacity duration-300 ${
            soldState?.exiting ? 'opacity-0' : 'opacity-100'
          }`}
          style={{
            background:
              'radial-gradient(ellipse 75% 65% at 50% 48%, rgba(168, 12, 24, 0.72) 0%, rgba(72, 6, 12, 0.55) 45%, #050507 100%)',
          }}
        >
          {/* Ambient crimson/gold stadium flares */}
          <div className="pointer-events-none absolute -top-24 left-1/4 h-96 w-96 rounded-full bg-red-600/25 blur-3xl animate-pulse" />
          <div className="pointer-events-none absolute -bottom-24 right-1/4 h-96 w-96 rounded-full bg-amber-500/20 blur-3xl animate-pulse" />

          {/* Header Bar */}
          <header className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-amber-400/60 bg-black/50 px-3.5 py-1.5 backdrop-blur-md">
                <span className="font-['Outfit',sans-serif] text-base sm:text-xl font-black tracking-wider text-white">
                  NEXTURN <span className="text-accent">PL</span>
                </span>
              </div>
            </div>
            <p className="font-['Outfit',sans-serif] text-xs sm:text-sm font-black uppercase tracking-[0.28em] text-white/80 pr-48 sm:pr-64">
              {eventName}
            </p>
          </header>

          {/* Centerpiece SOLD Stage */}
          <div className="relative z-10 my-auto flex flex-col items-center justify-center py-4">
            <div className="relative flex w-full max-w-6xl items-center justify-center gap-4 sm:gap-10 lg:gap-16">
              {/* Left SOLD Stamp */}
              <div className="hidden md:flex flex-col items-center animate-presenter-stamp-slam">
                <div className="flex items-center gap-2.5 rounded-2xl border-2 border-amber-400/90 bg-black/70 px-6 py-3 shadow-[0_0_35px_rgba(245,175,25,0.5)] backdrop-blur-md">
                  <span className="text-2xl lg:text-3xl" aria-hidden="true">
                    ⚠️
                  </span>
                  <span className="font-['Outfit',sans-serif] text-3xl lg:text-4xl font-black uppercase tracking-widest text-amber-300">
                    SOLD
                  </span>
                  <span className="text-2xl lg:text-3xl" aria-hidden="true">
                    ⚠️
                  </span>
                </div>
              </div>

              {/* Center Player + Rotating Halo + Starburst Rating */}
              <div className="relative flex h-[280px] sm:h-[340px] lg:h-[390px] w-[300px] sm:w-[360px] lg:w-[420px] items-end justify-center">
                <div className="absolute inset-0 flex items-center justify-center">
                  <CircularHaloRing text={soldStar ? 'STAR PLAYER' : 'SOLD OUT'} />
                </div>

                <div className="relative z-10 flex h-full w-full items-end justify-center pt-4 animate-presenter-player-in">
                  <PresenterPlayerPhoto
                    name={soldData.playerName}
                    photoUrl={soldData.playerPhotoUrl}
                  />
                </div>

                {/* Overlapping Starburst Rating Seal */}
                <div className="absolute -bottom-3 right-2 sm:right-4 z-20">
                  <RatingStarburst rating={soldPoints} label="RATING" />
                </div>
              </div>

              {/* Right SOLD Stamp */}
              <div className="hidden md:flex flex-col items-center animate-presenter-stamp-slam">
                <div className="flex items-center gap-2.5 rounded-2xl border-2 border-amber-400/90 bg-black/70 px-6 py-3 shadow-[0_0_35px_rgba(245,175,25,0.5)] backdrop-blur-md">
                  <span className="text-2xl lg:text-3xl" aria-hidden="true">
                    ⚠️
                  </span>
                  <span className="font-['Outfit',sans-serif] text-3xl lg:text-4xl font-black uppercase tracking-widest text-amber-300">
                    SOLD
                  </span>
                  <span className="text-2xl lg:text-3xl" aria-hidden="true">
                    ⚠️
                  </span>
                </div>
              </div>
            </div>

            {/* Mobile SOLD stamp */}
            <div className="mt-3 flex md:hidden items-center gap-2 rounded-full border border-amber-400 bg-black/75 px-4 py-1 animate-presenter-stamp-slam">
              <span className="font-['Outfit',sans-serif] text-sm font-black uppercase tracking-widest text-amber-300">
                ⚠️ SOLD ⚠️
              </span>
            </div>

            {/* Gold Player Name Banner */}
            <div className="mt-5 w-full max-w-3xl animate-presenter-banner-in">
              <div className="mx-auto w-fit max-w-full rounded-2xl bg-gradient-to-r from-[#fde047] via-[#f5af19] to-[#facc15] px-8 sm:px-14 py-2.5 sm:py-3.5 shadow-[0_12px_35px_rgba(245,175,25,0.45)]">
                <h1 className="truncate text-center font-['Outfit',sans-serif] text-3xl sm:text-5xl lg:text-6xl font-black uppercase tracking-wide text-[#090b10]">
                  {soldData.playerName}
                </h1>
              </div>
            </div>

            {/* White SOLD -> TEAM Banner */}
            <div className="mt-4 w-full max-w-2xl animate-presenter-rise-1">
              <div className="mx-auto w-fit max-w-full rounded-2xl bg-white px-8 sm:px-12 py-2.5 sm:py-3 shadow-[0_14px_40px_rgba(0,0,0,0.75)]">
                <p className="truncate text-center font-['Outfit',sans-serif] text-2xl sm:text-4xl lg:text-5xl font-black uppercase tracking-wide text-[#090b10]">
                  SOLD ➜ {soldData.teamName}
                </p>
              </div>
            </div>

            {/* Final Price & Meta Badges */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 animate-presenter-rise-2">
              {soldData.finalPrice ? (
                <div className="rounded-full border border-emerald-400/70 bg-emerald-950/80 px-6 py-1.5 shadow-[0_0_25px_rgba(16,185,129,0.4)]">
                  <span className="font-['Outfit',sans-serif] text-lg sm:text-2xl font-black tracking-wide text-emerald-300 tabular-nums">
                    FINAL PRICE: {currency(soldData.finalPrice, currencyLabel).toUpperCase()}
                  </span>
                </div>
              ) : null}
              {soldRole ? (
                <span className="rounded-full border border-white/25 bg-black/50 px-4 py-1.5 font-['Outfit',sans-serif] text-sm sm:text-base font-extrabold uppercase tracking-wider text-white/90">
                  {soldRole}
                </span>
              ) : null}
              {soldOverseas ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/60 bg-sky-950/70 px-4 py-1.5 font-['Outfit',sans-serif] text-sm sm:text-base font-extrabold uppercase tracking-wider text-sky-300">
                  <Plane className="size-4" />
                  Overseas
                </span>
              ) : null}
            </div>
          </div>

          {/* Progress Drain Bar */}
          <div className="relative z-10 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gradient-to-r from-amber-300 via-accent to-emerald-400 animate-presenter-progress-sold" />
          </div>
        </div>
      ) : spotlight ? (
        /* ===================================================================
           VIEW 2: LIVE PLAYER SPOTLIGHT (Gold/Black Widescreen Video Layout)
           =================================================================== */
        <div
          key={`spotlight-${spotlight.spotlightId}`}
          className="relative flex h-full min-h-[inherit] w-full flex-col justify-between px-6 py-6 sm:px-12 sm:py-8"
          style={{
            background:
              'radial-gradient(circle at 22% 58%, rgba(245, 175, 25, 0.24) 0%, rgba(120, 75, 10, 0.14) 32%, #050609 70%), radial-gradient(circle at 92% 18%, rgba(245, 175, 25, 0.22) 0%, transparent 45%), #050609',
          }}
        >
          {/* Subtle Broadcast Grid Pattern */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(-30deg, transparent, transparent 28px, #f5af19 28px, #f5af19 30px)',
            }}
          />

          {/* Top Bar */}
          <header className="relative z-10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-amber-400/60 bg-black/50 px-4 py-1.5 backdrop-blur-md shadow-[0_0_20px_rgba(245,175,25,0.2)]">
                <span className="font-['Outfit',sans-serif] text-base sm:text-xl font-black tracking-wider text-white">
                  NEXTURN <span className="text-accent">PREMIER LEAGUE</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 pr-48 sm:pr-72">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/80 bg-amber-500/15 px-4 py-1.5 shadow-[0_0_18px_rgba(245,175,25,0.35)]">
                <Radio className="size-4 text-accent animate-pulse" />
                <span className="font-['Outfit',sans-serif] text-xs sm:text-sm font-black uppercase tracking-widest text-accent">
                  LIVE ON BLOCK
                </span>
              </div>
            </div>
          </header>

          {/* Main Split Widescreen Stage (Matches Attached Video) */}
          <div className="relative z-10 my-auto grid w-full max-w-7xl mx-auto items-center gap-8 lg:grid-cols-12 py-4">
            {/* LEFT COLUMN: Player Cutout + Circular Halo + Starburst Rating + Star Badge */}
            <div className="flex flex-col items-center justify-center lg:col-span-5">
              <div className="relative flex h-[300px] sm:h-[360px] lg:h-[430px] w-full max-w-[420px] items-end justify-center">
                {/* Rotating circular STAR PLAYER / NPL ring */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <CircularHaloRing
                    text={spotlightIsStar ? 'STAR PLAYER' : 'NEXTURN LEAGUE'}
                  />
                </div>

                {/* Warm golden spotlight aura behind player */}
                <div
                  className="pointer-events-none absolute inset-4 rounded-full blur-2xl"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(250, 204, 21, 0.35) 0%, rgba(245, 175, 25, 0.1) 55%, transparent 75%)',
                  }}
                />

                {/* Player Portrait */}
                <div className="relative z-10 flex h-full w-full items-end justify-center pt-4 animate-presenter-player-in">
                  <PresenterPlayerPhoto
                    name={spotlight.name}
                    photoUrl={spotlight.photoUrl}
                  />
                </div>

                {/* Golden Starburst Rating Seal overlapping bottom-right */}
                <div className="absolute -bottom-3 right-2 sm:right-6 z-20">
                  <RatingStarburst rating={spotlight.points} label="RATING" />
                </div>
              </div>

              {/* Below-player Star Player / Overseas Callout */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3 animate-presenter-rise-2">
                {spotlightIsStar ? (
                  <div className="inline-flex items-center gap-2.5 rounded-xl border-2 border-amber-400/90 bg-gradient-to-r from-[#28080a] via-[#1a0b08] to-[#28080a] px-6 py-2 shadow-[0_0_25px_rgba(245,175,25,0.45)]">
                    <Star className="size-5 fill-amber-300 text-amber-300 animate-pulse" />
                    <span className="font-['Outfit',sans-serif] text-lg sm:text-xl font-black uppercase tracking-wider text-white">
                      STAR PLAYER
                    </span>
                    <Star className="size-5 fill-amber-300 text-amber-300 animate-pulse" />
                  </div>
                ) : null}

                {spotlightIsOverseas ? (
                  <div className="inline-flex items-center gap-2 rounded-xl border border-sky-400/70 bg-sky-950/70 px-4 py-2 shadow-[0_0_20px_rgba(56,189,248,0.3)]">
                    <Plane className="size-4 text-sky-300" />
                    <span className="font-['Outfit',sans-serif] text-sm sm:text-base font-black uppercase tracking-wider text-sky-200">
                      OVERSEAS
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* RIGHT COLUMN: Yellow-Gold Name Banner + Category + White Base Price Pill + Flag */}
            <div className="flex flex-col items-center lg:items-start text-center lg:text-left lg:col-span-7 space-y-6">
              {/* Giant Yellow-Gold Player Name Banner */}
              <div className="w-full animate-presenter-banner-in">
                <div className="inline-block max-w-full rounded-2xl bg-gradient-to-r from-[#fde047] via-[#f5af19] to-[#facc15] px-7 sm:px-11 py-3.5 sm:py-4.5 shadow-[0_14px_40px_rgba(245,175,25,0.38)]">
                  <h1 className="font-['Outfit',sans-serif] text-3xl sm:text-5xl lg:text-6xl font-black uppercase tracking-wide text-[#090b10] leading-none">
                    {spotlight.name}
                  </h1>
                </div>
              </div>

              {/* Category / Role & Rating Row */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-10 gap-y-2 animate-presenter-rise-1">
                <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl lg:text-4xl font-extrabold uppercase tracking-wider text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
                  {(effectiveRole || 'PLAYER').toUpperCase()}
                </span>
                <span className="font-['Outfit',sans-serif] text-xl sm:text-2xl lg:text-3xl font-bold uppercase tracking-wider text-amber-300/90">
                  RATING - {formatPoints(spotlight.points)}
                </span>
              </div>

              {/* Prominent White Rounded Base Price Pill */}
              <div className="w-full animate-presenter-rise-2">
                <div className="inline-flex items-center justify-center rounded-[28px] bg-white px-8 sm:px-12 py-4 sm:py-5 shadow-[0_18px_45px_rgba(0,0,0,0.75)]">
                  <span className="font-['Outfit',sans-serif] text-2xl sm:text-4xl lg:text-5xl font-black uppercase tracking-wide text-[#090b10] tabular-nums">
                    BASE PRICE - {currency(spotlight.basePrice, currencyLabel).toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Country / Nationality Badge */}
              <div className="flex items-center justify-center lg:justify-start gap-4 pt-1 animate-presenter-rise-3">
                {!spotlightIsOverseas ? (
                  <div className="inline-flex items-center gap-3.5 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 backdrop-blur-sm">
                    <IndiaFlag className="h-7 w-11" />
                    <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black uppercase tracking-widest text-white">
                      INDIA
                    </span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-3 rounded-xl border border-sky-400/35 bg-sky-950/50 px-5 py-2.5 backdrop-blur-sm">
                    <Plane className="size-6 text-sky-300" />
                    <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black uppercase tracking-widest text-sky-200">
                      {(effectiveNationality || 'OVERSEAS').toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Subtle Footer Strip */}
          <footer className="relative z-10 flex items-center justify-between border-t border-white/10 pt-3 text-xs font-semibold uppercase tracking-widest text-ink-muted">
            <span>{eventName} · Live Auction Stage</span>
            <span>
              {totals.sold} Sold · {totals.available} Remaining
            </span>
          </footer>
        </div>
      ) : event?.break?.active ? (
        /* ===================================================================
           VIEW 3: BREAK / INTERMISSION
           =================================================================== */
        <div className="h-full p-4 sm:p-8 flex items-center justify-center">
          <div className="w-full max-w-5xl">
            <AuctionBreakScreen breakState={event.break} eventName={eventName} />
          </div>
        </div>
      ) : event?.countdown?.targetTime ? (
        /* ===================================================================
           VIEW 4: COUNTDOWN SCREEN
           =================================================================== */
        <div className="h-full p-4 sm:p-8 flex items-center justify-center">
          <div className="w-full max-w-5xl">
            <StartingInCountdownScreen countdown={event.countdown} eventName={eventName} />
          </div>
        </div>
      ) : (
        /* ===================================================================
           VIEW 5: STANDBY BROADCAST STAGE (Waiting for next player)
           =================================================================== */
        <div
          className="relative flex h-full min-h-[inherit] w-full flex-col justify-between px-6 py-8 sm:px-12 sm:py-10"
          style={{
            background:
              'radial-gradient(ellipse 75% 60% at 50% 42%, rgba(245, 175, 25, 0.16) 0%, rgba(16, 20, 32, 0.7) 55%, #05060a 100%)',
          }}
        >
          <header className="relative z-10 flex items-center justify-between">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-1.5">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-widest text-amber-300">
                Presenter Connected · Live Sync Active
              </span>
            </div>
          </header>

          <div className="relative z-10 my-auto flex flex-col items-center text-center max-w-4xl mx-auto">
            <p className="font-['Outfit',sans-serif] text-xs sm:text-sm font-black uppercase tracking-[0.35em] text-accent">
              Official Auction Broadcast
            </p>
            <h1 className="mt-3 font-['Outfit',sans-serif] text-4xl sm:text-6xl lg:text-7xl font-black uppercase tracking-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
              {eventName}
            </h1>
            <p className="mt-4 max-w-xl text-sm sm:text-base text-ink-muted">
              Select any player in <span className="font-semibold text-white">Record Purchase</span> on your controller laptop to present them live on this screen.
            </p>

            {/* Live Auction Counters */}
            <div className="mt-10 grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Teams</p>
                <p className="mt-1 font-['Outfit',sans-serif] text-3xl font-black tabular-nums text-white">
                  {totals.teams}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Sold</p>
                <p className="mt-1 font-['Outfit',sans-serif] text-3xl font-black tabular-nums text-accent">
                  {totals.sold}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Available</p>
                <p className="mt-1 font-['Outfit',sans-serif] text-3xl font-black tabular-nums text-white">
                  {totals.available}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Total Spend</p>
                <p className="mt-1 font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black tabular-nums text-emerald-400">
                  {currency(totals.spent, currencyLabel)}
                </p>
              </div>
            </div>
          </div>

          {/* Recent Sales Strip */}
          <footer className="relative z-10 border-t border-white/10 pt-4">
            {purchases.data.length > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">
                  Latest Sales:
                </span>
                {purchases.data.slice(0, 3).map((p) => (
                  <span
                    key={p.id}
                    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1 text-xs font-semibold text-white"
                  >
                    {p.playerNameSnapshot} → <span className="text-accent">{p.teamNameSnapshot}</span> (
                    {currency(p.finalPrice, currencyLabel)})
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-center text-xs font-medium text-ink-muted">
                Tip: Click <span className="font-bold text-white">Fullscreen</span> (or press <kbd className="rounded border border-white/20 px-1.5 py-0.5 text-[10px]">F</kbd>) on your projector laptop to enable sound and maximize the broadcast stage.
              </p>
            )}
          </footer>
        </div>
      )}
    </div>
  )
}

