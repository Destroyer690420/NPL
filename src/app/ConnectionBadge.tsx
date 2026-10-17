import { Cloud, CloudOff, Loader2 } from 'lucide-react'
import { Pill } from '@/components/ui/StatusPill'
import type { FriendlyError } from '@/lib/errors'

/**
 * Connection indicator driven by the polling data hooks.
 * `error` wins, then a failed refresh (cached data), then connecting.
 */
export function ConnectionBadge({
  fromCache,
  loading,
  error,
}: {
  fromCache: boolean
  loading: boolean
  error: FriendlyError | null
}) {
  if (error) {
    return (
      <Pill tone="danger" className="gap-1.5">
        <CloudOff className="size-3" aria-hidden />
        {error.message}
      </Pill>
    )
  }
  if (loading) {
    return (
      <Pill tone="neutral" className="gap-1.5">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Connecting…
      </Pill>
    )
  }
  if (fromCache) {
    return (
      <Pill tone="warning" className="gap-1.5">
        <CloudOff className="size-3" aria-hidden />
        Offline — showing cached data
      </Pill>
    )
  }
  return (
    <Pill tone="success" className="gap-1.5">
      <Cloud className="size-3" aria-hidden />
      Live
    </Pill>
  )
}
