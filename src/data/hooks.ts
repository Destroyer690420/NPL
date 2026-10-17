import { useEffect, useRef, useState } from 'react'
import {
  toAuditLogDoc,
  toEventDoc,
  toPlayerDoc,
  toPublicConfigDoc,
  toPurchaseDoc,
  toTeamDoc,
} from '@shared/convert'
import type {
  AuditLogDoc,
  EventDoc,
  PlayerDoc,
  PublicConfigDoc,
  PurchaseDoc,
  TeamDoc,
} from '@shared/types'
import { pollIntervalMs } from '@/lib/config'
import { toFriendlyError, type FriendlyError } from '@/lib/errors'
import { getSupabase } from '@/lib/supabase'
import { readAdminResource, readPublicConfig, readTeamResource } from '@/services/reads'
import { readStoredSession } from '@/services/session'

/**
 * Live data hooks backed by polling.
 *
 * Every hook re-fetches its read API on an interval (and on tab focus), so
 * dashboards stay current without a realtime channel. The result shape stays
 * `{ data, loading, error, fromCache }`; `fromCache` now means "the last
 * refresh failed — showing the most recent data". Reads are re-validated
 * server-side on every request, and a rejected session signs the user out via
 * the session-invalid handler the auth providers register.
 */

export interface LiveResult<T> {
  data: T
  loading: boolean
  error: FriendlyError | null
  /** The last refresh failed (offline or server unreachable); data is stale. */
  fromCache: boolean
}

type Row = Record<string, unknown>

const NO_TEAMS: TeamDoc[] = []
const NO_PLAYERS: PlayerDoc[] = []
const NO_PURCHASES: PurchaseDoc[] = []
const NO_LOGS: AuditLogDoc[] = []

function rowId(row: Row): string {
  return typeof row.id === 'string' ? row.id : ''
}

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : []
}

function isEqualData<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** TimestampValue ({seconds,nanoseconds}) -> epoch ms for client-side sorting. */
function timestampKey(value: unknown): number {
  if (value && typeof value === 'object') {
    const seconds = (value as { seconds?: unknown }).seconds
    const nanoseconds = (value as { nanoseconds?: unknown }).nanoseconds
    if (typeof seconds === 'number') {
      return seconds * 1000 + (typeof nanoseconds === 'number' ? nanoseconds / 1_000_000 : 0)
    }
  }
  return 0
}

function newestFirst(purchases: PurchaseDoc[]): PurchaseDoc[] {
  return [...purchases].sort((a, b) => timestampKey(b.createdAt) - timestampKey(a.createdAt))
}

function mapTeams(value: unknown): TeamDoc[] {
  return rowsOf(value)
    .map((row) => (rowId(row) ? toTeamDoc(rowId(row), row) : null))
    .filter((team): team is TeamDoc => team !== null)
}

function mapPlayers(value: unknown): PlayerDoc[] {
  return rowsOf(value)
    .map((row) => (rowId(row) ? toPlayerDoc(rowId(row), row) : null))
    .filter((player): player is PlayerDoc => player !== null)
}

function mapPurchases(value: unknown): PurchaseDoc[] {
  return rowsOf(value)
    .map((row) => (rowId(row) ? toPurchaseDoc(rowId(row), row) : null))
    .filter((purchase): purchase is PurchaseDoc => purchase !== null)
}

/** True when this browser holds a team session for the given event (and team). */
function hasTeamSessionFor(eventId: string | null, teamId?: string | null): boolean {
  if (!eventId) return false
  const session = readStoredSession('team')
  if (!session || session.eventId !== eventId) return false
  if (teamId && session.teamId !== teamId) return false
  return true
}

function usePolled<T>(key: string | null, initial: T, fetcher: () => Promise<T>): LiveResult<T> {
  const [state, setState] = useState<LiveResult<T>>({
    data: initial,
    loading: key !== null,
    error: null,
    fromCache: false,
  })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (key === null) {
      setState({ data: initial, loading: false, error: null, fromCache: false })
      return
    }
    if (!getSupabase()) {
      setState({
        data: initial,
        loading: false,
        error: toFriendlyError(new Error('Supabase is not configured.')),
        fromCache: false,
      })
      return
    }

    let active = true
    let haveData = false
    setState({ data: initial, loading: true, error: null, fromCache: false })

    const load = async (): Promise<void> => {
      if (!active || document.hidden) return
      try {
        const value = await fetcherRef.current()
        if (!active) return
        haveData = true
        setState((previous) => {
          if (
            !previous.loading &&
            !previous.error &&
            !previous.fromCache &&
            isEqualData(previous.data, value)
          ) {
            return previous
          }
          return { data: value, loading: false, error: null, fromCache: false }
        })
      } catch (error) {
        if (!active) return
        if (haveData) {
          // Keep showing the last good snapshot; the badge explains that the
          // refresh failed.
          setState((previous) => ({ ...previous, loading: false, error: null, fromCache: true }))
        } else {
          setState({ data: initial, loading: false, error: toFriendlyError(error), fromCache: false })
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), pollIntervalMs)
    const refresh = (): void => {
      if (!document.hidden) void load()
    }
    const onSpotlightChange = (e: Event): void => {
      const custom = e as CustomEvent<{ eventId: string; spotlightPlayer: import('@shared/types').SpotlightPlayer | null }>
      if (!active) return
      setState((previous) => {
        if (!previous.data || typeof previous.data !== 'object') return previous
        const doc = previous.data as Record<string, unknown>
        if ('spotlightPlayer' in doc) {
          return {
            ...previous,
            data: {
              ...doc,
              spotlightPlayer: custom.detail?.spotlightPlayer ?? null,
            } as T,
          }
        }
        return previous
      })
      void load()
    }

    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('auction:spotlight_change', onSpotlightChange)

    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('auction:spotlight_change', onSpotlightChange)
    }
    // The fetcher closes over the same parameters as `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}

/* --------------------------------- event ---------------------------------- */

export function useEvent(eventId: string | null): LiveResult<EventDoc | null> {
  return usePolled(eventId ? `event:${eventId}` : null, null, async () => {
    const row = await readAdminResource<Row | null>('event', { eventId })
    if (!row) return null
    return toEventDoc(rowId(row) || (eventId ?? ''), row)
  })
}

/** Public, non-sensitive config document (`app_config.id = 'app'`). */
export function usePublicConfig(): LiveResult<PublicConfigDoc | null> {
  return usePolled('config/app', null, async () => {
    const row = await readPublicConfig()
    return row ? toPublicConfigDoc(row) : null
  })
}

/* ------------------------------ admin queries ----------------------------- */

export function useTeams(eventId: string | null): LiveResult<TeamDoc[]> {
  return usePolled(eventId ? `teams:${eventId}` : null, NO_TEAMS, async () =>
    mapTeams(await readAdminResource<unknown>('teams', { eventId })),
  )
}

export function usePlayers(eventId: string | null): LiveResult<PlayerDoc[]> {
  return usePolled(eventId ? `players:${eventId}` : null, NO_PLAYERS, async () =>
    mapPlayers(await readAdminResource<unknown>('players', { eventId })),
  )
}

/** Newest-first purchases, capped at `max` documents. */
export function usePurchases(eventId: string | null, max = 50): LiveResult<PurchaseDoc[]> {
  return usePolled(eventId ? `purchases:${eventId}:${max}` : null, NO_PURCHASES, async () => {
    const all = mapPurchases(await readAdminResource<unknown>('purchases', { eventId }))
    return newestFirst(all).slice(0, max)
  })
}

/** Newest-first audit logs (admin-only reads), capped at `max` documents. */
export function useAuditLogs(eventId: string | null, max = 50): LiveResult<AuditLogDoc[]> {
  return usePolled(eventId ? `auditLogs:${eventId}:${max}` : null, NO_LOGS, async () => {
    const value = await readAdminResource<unknown>('audit', { eventId, limit: max })
    return rowsOf(value)
      .map((row) => (rowId(row) ? toAuditLogDoc(rowId(row), row) : null))
      .filter((log): log is AuditLogDoc => log !== null)
      .slice(0, max)
  })
}

/* ------------------------------ team queries ------------------------------ */

/**
 * One team document. The team panel reads it through `api_team_read` (which
 * only ever returns the caller's own team); the admin console reads it from
 * the event team list.
 */
export function useTeamDoc(
  eventId: string | null,
  teamId: string | null,
): LiveResult<TeamDoc | null> {
  return usePolled(eventId && teamId ? `team:${eventId}:${teamId}` : null, null, async () => {
    if (hasTeamSessionFor(eventId, teamId)) {
      const state = await readTeamResource<{ team?: unknown }>('state')
      const row = state.team as Row | undefined
      if (!row || !rowId(row)) return null
      return toTeamDoc(rowId(row), row)
    }
    const teams = mapTeams(await readAdminResource<unknown>('teams', { eventId }))
    return teams.find((team) => team.id === teamId) ?? null
  })
}

/** The team's own purchase history, newest first. */
export function useTeamPurchases(
  eventId: string | null,
  teamId: string | null,
  max = 200,
): LiveResult<PurchaseDoc[]> {
  return usePolled(
    eventId && teamId ? `teamPurchases:${eventId}:${teamId}:${max}` : null,
    NO_PURCHASES,
    async () => {
      if (hasTeamSessionFor(eventId, teamId)) {
        const state = await readTeamResource<{ purchases?: unknown }>('state')
        return newestFirst(mapPurchases(state.purchases)).slice(0, max)
      }
      const all = mapPurchases(await readAdminResource<unknown>('purchases', { eventId }))
      return newestFirst(all.filter((purchase) => purchase.teamId === teamId)).slice(0, max)
    },
  )
}

/**
 * Event document for a team session. Read from `api_team_read('state')`,
 * which returns the event alongside the team's private state without revealing
 * other teams' data.
 */
export function useTeamEvent(eventId: string | null): LiveResult<EventDoc | null> {
  return usePolled(eventId ? `teamEvent:${eventId}` : null, null, async () => {
    if (!eventId) return null
    const state = await readTeamResource<{ event?: unknown }>('state')
    const row = state.event as Row | undefined
    if (!row) return null
    const id = rowId(row) || eventId
    return toEventDoc(id, row)
  })
}
