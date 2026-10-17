import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-start justify-between gap-4', className)}>
      <div>
        <div className="flex items-center gap-2.5">
          <span className="h-5 w-1 rounded-full bg-accent shadow-[0_0_8px_rgba(245,175,25,0.6)]" aria-hidden />
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
        </div>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  )
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn('text-xs font-bold uppercase tracking-wider text-ink-muted', className)}>
      {children}
    </h2>
  )
}
