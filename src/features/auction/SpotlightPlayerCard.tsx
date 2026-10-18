import { useEffect, useState } from 'react'
import { ShoppingCart, X, XCircle } from 'lucide-react'
import type { SpotlightPlayer } from '@shared/types'
import { currency, points as formatPoints } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { PlayerAvatar } from '@/components/ui/PlayerAvatar'

export interface SpotlightPlayerCardProps {
  spotlight: SpotlightPlayer | null
  currencyLabel?: string
  isAdmin?: boolean
  hideModal?: boolean
  onAdminClose?: () => Promise<void> | void
  onSell?: (playerId: string) => void
}

/**
 * Splits formatted currency into primary amount and denomination unit
 * e.g. "₹20 lakh" -> { primary: "₹20", secondary: "Lakh" }
 * e.g. "₹2 crore" -> { primary: "₹2", secondary: "Crore" }
 * e.g. "₹500" -> { primary: "₹500", secondary: null }
 */
function getPriceParts(basePrice: number | null | undefined, currencyLabel = '₹') {
  if (basePrice === null || basePrice === undefined || !Number.isFinite(basePrice)) {
    return { primary: '—', secondary: null }
  }
  const formatted = currency(basePrice, currencyLabel).trim()
  const spaceIdx = formatted.indexOf(' ')
  if (spaceIdx > 0) {
    const primary = formatted.slice(0, spaceIdx)
    const secondaryRaw = formatted.slice(spaceIdx + 1).trim()
    const secondary = secondaryRaw.charAt(0).toUpperCase() + secondaryRaw.slice(1)
    return { primary, secondary }
  }
  return { primary: formatted, secondary: null }
}

function resolvePhotoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null
  const trimmed = photoUrl.trim()
  return trimmed || null
}

/**
 * Live auction player card.
 *
 * Reimagined with broadcast aesthetics:
 * - Rounded midnight-navy card with golden amber hairline border & subtle sparkle accent
 * - Glowing "LIVE AUCTION" pill badge with ((•)) broadcast waves
 * - Large player showcase with stadium floodlights, dynamic golden speed slashes, and golden rim aura
 * - Bold 3D metallic gold sports typography for player name
 * - Stacked golden base price and electric cyan points
 */
export function SpotlightPlayerCard({
  spotlight,
  currencyLabel = '₹',
  isAdmin = false,
  hideModal = false,
  onAdminClose,
  onSell,
}: SpotlightPlayerCardProps) {
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const [adminClosing, setAdminClosing] = useState(false)

  const [imgSrc, setImgSrc] = useState<string | null>(() => resolvePhotoSrc(spotlight?.photoUrl))
  const [hasTriedLocal, setHasTriedLocal] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)

  // Reset local dismissal and image state whenever a new player is spotlighted
  useEffect(() => {
    if (spotlight?.spotlightId && spotlight.spotlightId !== dismissedId) {
      setDismissedId(null)
    }
    setImgSrc(resolvePhotoSrc(spotlight?.photoUrl))
    setHasTriedLocal(false)
    setImgFailed(false)
  }, [spotlight?.spotlightId, spotlight?.photoUrl])

  if (!spotlight) return null

  const isDismissed = Boolean(hideModal || (dismissedId && dismissedId === spotlight.spotlightId))

  async function handleAdminClose() {
    if (!onAdminClose) return
    try {
      setAdminClosing(true)
      await onAdminClose()
    } finally {
      setAdminClosing(false)
    }
  }

  function handleImageError() {
    // If remote image fails, attempt local public/player-images fallback if filename is found
    if (!hasTriedLocal && imgSrc) {
      const match = imgSrc.match(/(P\d+\.(?:png|jpg|jpeg|webp))$/i)
      if (match) {
        setHasTriedLocal(true)
        setImgSrc(`/player-images/${match[1]}`)
        return
      }
    }
    setImgFailed(true)
  }

  const priceParts = getPriceParts(spotlight.basePrice, currencyLabel)
  const initials = (spotlight.name.trim().slice(0, 2) || '??').toUpperCase()

  // If dismissed locally, render the compact floating bar (or hide if admin is recording purchase)
  if (isDismissed) {
    if (hideModal && isAdmin) return null
    return (
      <aside
        aria-label="Current auction player"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-3.5 rounded-2xl border border-amber-500/40 bg-[#0c101d]/95 px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.8),0_0_20px_rgba(245,175,25,0.2)] backdrop-blur-md animate-in slide-in-from-bottom-2"
      >
        <div className="relative">
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber-400 animate-ping" />
          <PlayerAvatar
            name={spotlight.name}
            photoUrl={spotlight.photoUrl}
            size="sm"
            className="border-amber-400/50 shadow-[0_0_10px_rgba(245,175,25,0.3)]"
          />
        </div>
        <div className="text-left">
          <p className="text-xs font-bold text-white leading-tight font-['Outfit',sans-serif]">{spotlight.name}</p>
          <p className="text-[11px] font-semibold text-[#f6ad37] leading-tight mt-0.5">
            {currency(spotlight.basePrice, currencyLabel)} · <span className="text-[#00d2ff]">{formatPoints(spotlight.points)} pts</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 ml-1">
          <Button size="sm" variant="secondary" onClick={() => setDismissedId(null)}>
            View card
          </Button>
          {isAdmin ? (
            <Button
              size="sm"
              variant="dangerOutline"
              loading={adminClosing}
              icon={<XCircle className="size-3.5" />}
              onClick={() => void handleAdminClose()}
              aria-label="Close auction for everyone"
            >
              Unsold
            </Button>
          ) : null}
        </div>
      </aside>
    )
  }

  // Full Spotlight Player Card Modal
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spotlight-player-name"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-[420px] rounded-[32px] border border-amber-500/50 bg-gradient-to-b from-[#0c101d] via-[#0d1322] to-[#080b14] p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_35px_rgba(245,175,25,0.18)] text-center animate-in zoom-in-95 duration-200 select-none">
        
        {/* Top Bar with Live Auction Badge and Close Button */}
        <div className="relative flex items-center justify-center">
          {/* Centered Live Auction Pill Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/90 bg-[#1c1508]/90 px-5 py-1.5 shadow-[0_0_18px_rgba(245,158,11,0.5),inset_0_0_8px_rgba(245,158,11,0.2)] backdrop-blur-md">
            {/* ((•)) broadcast wave icon */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4 animate-pulse shrink-0"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="2" fill="#fbbf24" />
              <path d="M8.5 8.5a5 5 0 0 0 0 7" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M5.5 5.5a9.5 9.5 0 0 0 0 13" />
              <path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
            </svg>
            <span className="font-['Outfit',sans-serif] text-xs sm:text-[13px] font-black uppercase tracking-wider text-[#f6ad37]">
              LIVE AUCTION
            </span>
          </div>

          {/* Close button at top-right (local dismissal) */}
          <button
            type="button"
            onClick={() => setDismissedId(spotlight.spotlightId)}
            aria-label="Dismiss card"
            className="absolute right-0 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* Player Image Showcase Box with Stadium & Dynamic Golden Effects */}
        <div className="relative mt-5 h-72 sm:h-80 w-full overflow-hidden rounded-2xl border border-slate-700/60 bg-[#090d18] shadow-inner flex items-center justify-center">
          
          {/* Stadium Background & Dynamic Diagonal Golden Plates SVG */}
          <svg
            className="absolute inset-0 size-full pointer-events-none"
            preserveAspectRatio="none"
            viewBox="0 0 400 320"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              {/* Night Stadium Atmosphere Radial Gradient */}
              <radialGradient id="stadiumSky" cx="50%" cy="40%" r="65%">
                <stop offset="0%" stopColor="#1a253f" />
                <stop offset="50%" stopColor="#0e1526" />
                <stop offset="100%" stopColor="#050811" />
              </radialGradient>

              {/* Left Floodlight Beam */}
              <linearGradient id="floodlightLeft" x1="0%" y1="0%" x2="70%" y2="85%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                <stop offset="25%" stopColor="#fef08a" stopOpacity="0.25" />
                <stop offset="60%" stopColor="#f5af19" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#0a0f1d" stopOpacity="0" />
              </linearGradient>

              {/* Right Floodlight Beam */}
              <linearGradient id="floodlightRight" x1="100%" y1="0%" x2="30%" y2="85%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
                <stop offset="25%" stopColor="#fef08a" stopOpacity="0.25" />
                <stop offset="60%" stopColor="#f5af19" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#0a0f1d" stopOpacity="0" />
              </linearGradient>

              {/* Metallic Gold Gradient for Diagonal Plates */}
              <linearGradient id="goldPlateGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#663c00" />
                <stop offset="25%" stopColor="#b45309" />
                <stop offset="50%" stopColor="#f5af19" />
                <stop offset="75%" stopColor="#fef08a" />
                <stop offset="100%" stopColor="#b45309" />
              </linearGradient>

              {/* Secondary Gold Gradient */}
              <linearGradient id="goldPlateGrad2" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#451a03" />
                <stop offset="35%" stopColor="#d97706" />
                <stop offset="70%" stopColor="#fde047" />
                <stop offset="100%" stopColor="#92400e" />
              </linearGradient>

            </defs>

            {/* Stadium Sky & Stands */}
            <rect width="400" height="320" fill="url(#stadiumSky)" />

            {/* Distant Stadium Crowd / Stands Silhouette */}
            <path
              d="M0 215 Q200 195 400 215 L400 320 L0 320 Z"
              fill="#090d16"
              opacity="0.9"
            />
            <path
              d="M0 235 Q200 218 400 235 L400 320 L0 320 Z"
              fill="#05080f"
            />

            {/* Out-of-focus crowd light speckles */}
            <circle cx="55" cy="220" r="1.5" fill="#fde047" opacity="0.3" />
            <circle cx="105" cy="214" r="1" fill="#38bdf8" opacity="0.3" />
            <circle cx="155" cy="210" r="1.5" fill="#fef08a" opacity="0.25" />
            <circle cx="245" cy="210" r="1" fill="#ffffff" opacity="0.3" />
            <circle cx="295" cy="215" r="1.5" fill="#f5af19" opacity="0.35" />
            <circle cx="345" cy="222" r="1" fill="#38bdf8" opacity="0.25" />

            {/* Left Floodlight Beam Cone Effect */}
            <polygon points="0,0 180,240 60,320 0,160" fill="url(#floodlightLeft)" />

            {/* Right Floodlight Beam Cone Effect */}
            <polygon points="400,0 220,240 340,320 400,160" fill="url(#floodlightRight)" />

            {/* Dynamic Angled Golden Plates - LEFT SIDE */}
            {/* Plate 1: Upper Left Thick Plate */}
            <polygon
              points="-20,150 115,50 145,50 10,150"
              fill="url(#goldPlateGrad)"
              opacity="0.85"
            />
            {/* Plate 2: Lower Left Thick Plate */}
            <polygon
              points="-10,210 90,135 112,135 12,210"
              fill="url(#goldPlateGrad2)"
              opacity="0.75"
            />
            {/* Plate 3: Left Accent Sliver */}
            <polygon
              points="4,95 65,50 75,50 14,95"
              fill="url(#goldPlateGrad)"
              opacity="0.6"
            />

            {/* Dynamic Angled Golden Plates - RIGHT SIDE */}
            {/* Plate 1: Upper Right Thick Plate */}
            <polygon
              points="255,150 390,50 420,50 285,150"
              fill="url(#goldPlateGrad)"
              opacity="0.85"
            />
            {/* Plate 2: Lower Right Thick Plate */}
            <polygon
              points="288,210 388,135 410,135 310,210"
              fill="url(#goldPlateGrad2)"
              opacity="0.75"
            />
            {/* Plate 3: Right Accent Sliver */}
            <polygon
              points="325,95 385,50 395,50 335,95"
              fill="url(#goldPlateGrad)"
              opacity="0.6"
            />
          </svg>

          {/* Intense Radial Golden Backlight Glow around Player Silhouette */}
          <div
            className="absolute inset-0 pointer-events-none flex items-center justify-center"
            style={{
              background:
                'radial-gradient(circle at 50% 36%, rgba(254, 240, 138, 0.75) 0%, rgba(245, 175, 25, 0.5) 26%, rgba(217, 119, 6, 0.18) 55%, transparent 75%)',
            }}
          />

          {/* Player Photo with Golden Contour Rim Light Filter */}
          <div className="relative z-10 flex h-full w-full items-end justify-center pt-3">
            {imgSrc && !imgFailed ? (
              <img
                src={imgSrc}
                alt={spotlight.name}
                onError={handleImageError}
                className="h-full w-auto max-w-[88%] object-contain object-bottom select-none transition-transform duration-300 hover:scale-[1.03]"
                style={{
                  filter:
                    'drop-shadow(0 0 10px rgba(254, 240, 138, 0.95)) drop-shadow(0 0 22px rgba(245, 175, 25, 0.8)) drop-shadow(0 0 45px rgba(217, 119, 6, 0.5))',
                }}
              />
            ) : (
              /* Stylized fallback if photo is absent or failed */
              <div className="flex h-full w-full flex-col items-center justify-end pb-4 text-center select-none">
                <div
                  className="relative flex size-36 sm:size-40 items-center justify-center rounded-3xl border-2 border-amber-400/80 bg-gradient-to-b from-[#1b2438] to-[#0d1322] shadow-[0_0_35px_rgba(245,175,25,0.6)]"
                  style={{
                    filter:
                      'drop-shadow(0 0 14px rgba(254, 240, 138, 0.9)) drop-shadow(0 0 28px rgba(245, 175, 25, 0.7))',
                  }}
                >
                  <span className="font-['Outfit',sans-serif] text-5xl sm:text-6xl font-black text-amber-300">
                    {initials}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Vignette for seamless blend */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#090d18] via-[#090d18]/50 to-transparent pointer-events-none z-10" />
        </div>

        {/* Player Name in 3D Metallic Gold Championship Display Typography */}
        <h2
          id="spotlight-player-name"
          className="mt-5 font-['Outfit',sans-serif] text-3xl sm:text-4xl font-black uppercase tracking-wider text-center leading-tight"
          style={{
            background:
              'linear-gradient(180deg, #fffbeb 0%, #fde047 25%, #f5af19 55%, #c27803 85%, #854d0e 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter:
              'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 16px rgba(245, 175, 25, 0.4))',
          }}
        >
          {spotlight.name}
        </h2>

        {/* Stats Row: Base Price & Points with Middle Divider */}
        <div className="relative mt-5 grid grid-cols-2 py-2">
          {/* Subtle Vertical Divider */}
          <div className="absolute left-1/2 top-1 bottom-1 w-px bg-slate-700/60 -translate-x-1/2" />

          {/* Left Column: Base Price (Stacked into ₹20 and Lakh) */}
          <div className="flex flex-col items-center justify-center px-2 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              BASE PRICE
            </span>
            <div className="mt-1 flex flex-col items-center justify-center font-['Outfit',sans-serif] leading-tight">
              <span
                className="text-3xl sm:text-4xl font-extrabold text-[#f6ad37]"
                style={{ textShadow: '0 0 16px rgba(245, 158, 11, 0.45)' }}
              >
                {priceParts.primary}
              </span>
              {priceParts.secondary ? (
                <span
                  className="text-3xl sm:text-4xl font-extrabold text-[#f6ad37]"
                  style={{ textShadow: '0 0 16px rgba(245, 158, 11, 0.45)' }}
                >
                  {priceParts.secondary}
                </span>
              ) : null}
            </div>
          </div>

          {/* Right Column: Points (Glowing Electric Cyan) */}
          <div className="flex flex-col items-center justify-center px-2 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              POINTS
            </span>
            <div className="mt-1 flex flex-1 items-center justify-center font-['Outfit',sans-serif]">
              <span
                className="text-4xl sm:text-5xl font-extrabold text-[#00d2ff]"
                style={{
                  textShadow:
                    '0 0 16px rgba(0, 210, 255, 0.85), 0 0 32px rgba(0, 210, 255, 0.45)',
                }}
              >
                {formatPoints(spotlight.points)}
              </span>
            </div>
          </div>
        </div>


        {/* Admin Controls */}
        {isAdmin ? (
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              variant="dangerOutline"
              size="md"
              icon={<XCircle className="size-4" aria-hidden />}
              loading={adminClosing}
              onClick={() => void handleAdminClose()}
              className="w-full sm:w-1/2 justify-center border-red-500/40 bg-red-950/20 text-red-300 hover:bg-red-950/40"
            >
              Unsold (Close)
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<ShoppingCart className="size-4 text-black" aria-hidden />}
              onClick={() => {
                setDismissedId(spotlight.spotlightId)
                onSell?.(spotlight.playerId)
              }}
              className="w-full sm:w-1/2 justify-center bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400 text-black font-extrabold shadow-[0_0_20px_rgba(245,175,25,0.4)] hover:brightness-110 border-0"
            >
              Sell player
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
