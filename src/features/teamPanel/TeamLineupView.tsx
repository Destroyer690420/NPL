import { useMemo, useState } from 'react'
import { Search, Users, X } from 'lucide-react'
import type { TeamLineupPlayer } from '@/services/team'
import { LoadingBlock } from '@/components/ui/Feedback'

export interface TeamLineupViewProps {
  players: TeamLineupPlayer[]
  loading?: boolean
}

function resolvePlayerImage(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null
  const trimmed = photoUrl.trim()
  return trimmed || null
}

function LineupPlayerCard({ player }: { player: TeamLineupPlayer }) {
  const [imgSrc, setImgSrc] = useState<string | null>(() => resolvePlayerImage(player.photoUrl))
  const [hasTriedLocal, setHasTriedLocal] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)

  const cleanName = player.name.trim()
  const initials = (cleanName.slice(0, 2) || '??').toUpperCase()

  function handleImageError() {
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

  return (
    <div className="group flex flex-col items-center rounded-2xl border border-line-strong bg-gradient-to-b from-[#141926] via-[#10141e] to-[#0c0f18] p-3 text-center shadow-lg transition-all duration-200 hover:-translate-y-1 hover:border-accent/50 hover:shadow-[0_8px_25px_rgba(245,175,25,0.15)]">
      {/* Player Photo / PFP */}
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line/60 bg-[#090d18] shadow-inner flex items-center justify-center">
        {imgSrc && !imgFailed ? (
          <img
            src={imgSrc}
            alt={cleanName}
            onError={handleImageError}
            className="size-full object-cover object-top select-none transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-[#161d2d] to-[#0a0f1b] text-center select-none">
            <span className="font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black text-accent/80">
              {initials}
            </span>
          </div>
        )}
      </div>

      {/* Player Name */}
      <div className="mt-3 w-full px-1">
        <p
          title={cleanName}
          className="truncate font-['Outfit',sans-serif] text-sm sm:text-base font-bold text-white transition-colors group-hover:text-accent"
        >
          {cleanName}
        </p>
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Available
        </span>
      </div>
    </div>
  )
}

export function TeamLineupView({ players, loading = false }: TeamLineupViewProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return players
    return players.filter((player) => player.name.toLowerCase().includes(term))
  }, [players, search])

  if (loading && players.length === 0) {
    return (
      <div className="py-12">
        <LoadingBlock label="Loading auction lineup…" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="rounded-2xl border border-line-strong bg-gradient-to-br from-[#181c26] via-[#12151f] to-[#14101e] p-5 sm:p-6 shadow-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-accent shadow-[0_0_8px_rgba(245,175,25,0.6)]" aria-hidden />
              <p className="text-[11px] font-bold uppercase tracking-wider text-accent-light">Player Pool</p>
            </div>
            <h1 className="mt-1 font-['Outfit',sans-serif] text-2xl sm:text-3xl font-black text-white">
              Auction Lineup
            </h1>
            <p className="mt-1 text-xs text-ink-muted">
              All players currently available in the live auction.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-muted/60 px-3 py-1.5 text-xs font-bold text-white shadow-inner">
              <Users className="size-3.5 text-accent" aria-hidden />
              <span>{players.length} Available</span>
            </span>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mt-5">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players by name…"
            className="w-full rounded-xl border border-line-strong bg-[#0b0e15] py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-ink-muted/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-muted hover:text-white"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Players Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface-muted/30 py-12 text-center">
          <Users className="mx-auto size-10 text-ink-muted/50" aria-hidden />
          <p className="mt-3 text-base font-bold text-white">No players found</p>
          <p className="mt-1 text-xs text-ink-muted">
            {search ? `No available players matching "${search}"` : 'There are currently no players available in the auction.'}
          </p>
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="mt-3 text-xs font-bold text-accent hover:underline cursor-pointer"
            >
              Clear search
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
          {filtered.map((player) => (
            <LineupPlayerCard key={player.id} player={player} />
          ))}
        </div>
      )}
    </div>
  )
}
