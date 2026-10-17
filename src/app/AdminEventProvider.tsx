import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useEvent, usePublicConfig, type LiveResult } from '@/data/hooks'
import { DEFAULT_EVENT_ID } from '@shared/constants'
import { defaultEventIdOverride } from '@/lib/config'
import type { EventDoc } from '@shared/types'
import type { FriendlyError } from '@/lib/errors'

/**
 * Resolves the event the admin console is working on: an explicit override
 * (dev), otherwise the configured default event, otherwise the first event id.
 */

export interface AdminEventValue extends Omit<LiveResult<EventDoc | null>, 'data'> {
  eventId: string
  event: EventDoc | null
  /** Switches the console to a different event for this browser session. */
  setEventId: (eventId: string) => void
  /** True when the user picked the event manually in this session. */
  manual: boolean
}

const AdminEventContext = createContext<AdminEventValue | null>(null)

export function useAdminEvent(): AdminEventValue {
  const value = useContext(AdminEventContext)
  if (!value) throw new Error('useAdminEvent must be used inside <AdminEventProvider>.')
  return value
}

export function AdminEventProvider({ children }: { children: ReactNode }) {
  const config = usePublicConfig()
  const [eventId, setEventIdState] = useState<string>(defaultEventIdOverride ?? DEFAULT_EVENT_ID)
  const manual = useRef(false)

  useEffect(() => {
    if (manual.current) return
    const configured = defaultEventIdOverride ?? config.data?.defaultEventId ?? null
    if (configured && configured !== eventId) setEventIdState(configured)
  }, [config.data?.defaultEventId, eventId])

  const live = useEvent(eventId)

  const value = useMemo<AdminEventValue>(
    () => ({
      eventId,
      event: live.data,
      loading: live.loading,
      error: live.error,
      fromCache: live.fromCache,
      setEventId: (next: string) => {
        manual.current = true
        setEventIdState(next)
      },
      manual: manual.current,
    }),
    [eventId, live.data, live.loading, live.error, live.fromCache],
  )

  return <AdminEventContext.Provider value={value}>{children}</AdminEventContext.Provider>
}

export type { FriendlyError }
