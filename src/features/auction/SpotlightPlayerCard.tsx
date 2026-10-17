import { useEffect, useState } from 'react'
import { Radio, ShoppingCart, X, XCircle } from 'lucide-react'
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
 * Live auction player card.
 *
 * Appears on everyone's screen in real-time when an admin spotlights a player.
 * Shows player photo, name, points and base price.
 * Can be dismissed locally by team users, but automatically closes for everyone
 * as soon as the player is sold or closed by admin.
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

  // Reset local dismissal whenever a new player is spotlighted
  useEffect(() => {
    if (spotlight?.spotlightId && spotlight.spotlightId !== dismissedId) {
      // New spotlight opened!
      setDismissedId(null)
    }
  }, [spotlight?.spotlightId])

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

  // If dismissed locally, render the compact floating bar (or hide if admin is recording purchase)
  if (isDismissed) {
    if (hideModal && isAdmin) return null
    return (
      <aside
        aria-label="Current auction player"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-2xl border border-accent/50 bg-[#121620]/95 px-3.5 py-2.5 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-2"
      >
        <div className="relative">
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent animate-ping" />
          <PlayerAvatar name={spotlight.name} photoUrl={spotlight.photoUrl} size="sm" />
        </div>
        <div className="text-left">
          <p className="text-xs font-bold text-white leading-tight">{spotlight.name}</p>
          <p className="text-[11px] font-semibold text-accent leading-tight mt-0.5">
            {currency(spotlight.basePrice, currencyLabel)} · {formatPoints(spotlight.points)} pts
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-3xl border-2 border-accent/40 bg-gradient-to-b from-[#161c28] via-[#10141e] to-[#0c0f17] p-6 shadow-[0_0_50px_rgba(245,175,25,0.25)] text-center animate-in zoom-in-95 duration-200">
        {/* Close button (local dismissal) */}
        <button
          type="button"
          onClick={() => setDismissedId(spotlight.spotlightId)}
          aria-label="Dismiss card"
          className="absolute top-4 right-4 rounded-xl p-2 text-ink-muted hover:text-white hover:bg-surface-muted transition-colors cursor-pointer"
        >
          <X className="size-5" aria-hidden />
        </button>

        {/* Live Badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/15 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-accent shadow-sm">
          <span className="size-2 rounded-full bg-accent animate-ping" />
          <Radio className="size-3.5 text-accent animate-pulse" aria-hidden />
          Live Auction
        </div>

        {/* Player Avatar */}
        <div className="relative mx-auto mt-5 inline-block">
          <div className="absolute -inset-1 rounded-3xl bg-gradient-to-tr from-accent via-amber-300 to-yellow-500 opacity-60 blur-md animate-pulse" />
          <PlayerAvatar
            name={spotlight.name}
            photoUrl={spotlight.photoUrl}
            size="2xl"
            className="relative shadow-2xl"
          />
        </div>

        {/* Player Name */}
        <h2
          id="spotlight-player-name"
          className="mt-4 text-2xl sm:text-3xl font-black tracking-tight text-white"
        >
          {spotlight.name}
        </h2>

        {/* Stats Row */}
        <div className="mt-5 grid grid-cols-2 divide-x divide-line rounded-2xl border border-line-strong bg-surface-muted/80 p-3.5 shadow-inner">
          <div className="px-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Base Price</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-accent">
              {currency(spotlight.basePrice, currencyLabel)}
            </p>
          </div>
          <div className="px-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Points</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-sky-400">
              {formatPoints(spotlight.points)}
            </p>
          </div>
        </div>

        {/* Actions */}
        {isAdmin ? (
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Button
              variant="dangerOutline"
              size="md"
              icon={<XCircle className="size-4" aria-hidden />}
              loading={adminClosing}
              onClick={() => void handleAdminClose()}
              className="w-full sm:w-auto"
            >
              Close card (Unsold)
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<ShoppingCart className="size-4" aria-hidden />}
              onClick={() => {
                setDismissedId(spotlight.spotlightId)
                onSell?.(spotlight.playerId)
              }}
              className="w-full sm:w-auto"
            >
              Sell player
            </Button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setDismissedId(spotlight.spotlightId)}
              className="w-full"
            >
              Dismiss card
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
