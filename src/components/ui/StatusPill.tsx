import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { EventStatus, PlayerStatus, PurchaseStatus } from '@shared/types'

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  danger: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  neutral: 'border-line bg-surface-muted/80 text-ink-muted',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
}

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function EventStatusPill({ status }: { status: EventStatus }) {
  if (status === 'active') return <Pill tone="success">Auction live</Pill>
  if (status === 'finalized') return <Pill tone="neutral">Finalized</Pill>
  return <Pill tone="warning">Setup</Pill>
}

export function PlayerStatusPill({ status }: { status: PlayerStatus }) {
  if (status === 'sold') return <Pill tone="success">Sold</Pill>
  if (status === 'withdrawn') return <Pill tone="neutral">Withdrawn</Pill>
  return <Pill tone="info">Available</Pill>
}

export function PurchaseStatusPill({ status }: { status: PurchaseStatus }) {
  if (status === 'reversed') return <Pill tone="danger">Reversed</Pill>
  return <Pill tone="success">Confirmed</Pill>
}
