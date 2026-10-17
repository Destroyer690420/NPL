import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentReference,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore'
import { getFirebase, type FirebaseServices } from '@/lib/firebase'
import { toFriendlyError, type FriendlyError } from '@/lib/errors'
import {
  auditLogConverter,
  eventConverter,
  playerConverter,
  publicConfigConverter,
  purchaseConverter,
  teamConverter,
} from './converters'
import type {
  AuditLogDoc,
  EventDoc,
  PlayerDoc,
  PublicConfigDoc,
  PurchaseDoc,
  TeamDoc,
} from '@shared/types'

/**
 * Live Firestore hooks.
 *
 * Every hook returns `{ data, loading, error, fromCache }`. `fromCache` is true
 * while a snapshot is being served from the local cache (offline or still
 * connecting), which the UI surfaces as "Updating…". Listener errors are
 * converted to friendly, non-sensitive messages.
 */

export interface LiveResult<T> {
  data: T
  loading: boolean
  error: FriendlyError | null
  /** Snapshot served from the local cache (offline or still connecting). */
  fromCache: boolean
}

type Emit<T> = (value: T, fromCache: boolean) => void
type Fail = (error: unknown) => void
type Subscribe<T> = (services: FirebaseServices, emit: Emit<T>, fail: Fail) => () => void

const NO_TEAMS: TeamDoc[] = []
const NO_PLAYERS: PlayerDoc[] = []
const NO_PURCHASES: PurchaseDoc[] = []
const NO_LOGS: AuditLogDoc[] = []
const NOOP = () => undefined

function useLive<T>(key: string | null, initial: T, subscribe: Subscribe<T>): LiveResult<T> {
  const [state, setState] = useState<LiveResult<T>>({
    data: initial,
    loading: key !== null,
    error: null,
    fromCache: false,
  })

  useEffect(() => {
    if (key === null) {
      setState({ data: initial, loading: false, error: null, fromCache: false })
      return
    }
    const services = getFirebase()
    if (!services) {
      setState({
        data: initial,
        loading: false,
        error: toFriendlyError(new Error('Firebase is not configured.')),
        fromCache: false,
      })
      return
    }

    setState({ data: initial, loading: true, error: null, fromCache: false })

    let active = true
    const unsubscribe = subscribe(
      services,
      (value, fromCache) => {
        if (active) setState({ data: value, loading: false, error: null, fromCache })
      },
      (error) => {
        if (active) {
          setState((previous) => ({ ...previous, loading: false, error: toFriendlyError(error) }))
        }
      },
    )

    return () => {
      active = false
      unsubscribe()
    }
    // `subscribe` closes over the same parameters as `key`, so re-subscribing
    // on key change is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}

function querySubscribe<T>(build: (services: FirebaseServices) => Query<T> | null): Subscribe<T[]> {
  return (services, emit, fail) => {
    const q = build(services)
    if (!q) return NOOP
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot: QuerySnapshot<T>) => emit(snapshot.docs.map((entry) => entry.data()), snapshot.metadata.fromCache),
      fail,
    )
  }
}

function docSubscribe<T>(build: (services: FirebaseServices) => DocumentReference<T> | null): Subscribe<T | null> {
  return (services, emit, fail) => {
    const ref = build(services)
    if (!ref) return NOOP
    return onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snapshot) => emit(snapshot.data() ?? null, snapshot.metadata.fromCache),
      fail,
    )
  }
}

/* --------------------------------- event ---------------------------------- */

export function useEvent(eventId: string | null): LiveResult<EventDoc | null> {
  return useLive(
    eventId,
    null,
    docSubscribe((services) =>
      eventId ? doc(services.db, 'events', eventId).withConverter(eventConverter) : null,
    ),
  )
}

/** Public, non-sensitive config document (`config/app`). */
export function usePublicConfig(): LiveResult<PublicConfigDoc | null> {
  return useLive(
    'config/app',
    null,
    docSubscribe((services) =>
      doc(services.db, 'config', 'app').withConverter(publicConfigConverter),
    ),
  )
}

/* ------------------------------ admin queries ----------------------------- */

export function useTeams(eventId: string | null): LiveResult<TeamDoc[]> {
  return useLive(
    eventId ? `teams:${eventId}` : null,
    NO_TEAMS,
    querySubscribe((services) =>
      eventId
        ? collection(services.db, 'events', eventId, 'teams').withConverter(teamConverter)
        : null,
    ),
  )
}

export function usePlayers(eventId: string | null): LiveResult<PlayerDoc[]> {
  return useLive(
    eventId ? `players:${eventId}` : null,
    NO_PLAYERS,
    querySubscribe((services) =>
      eventId
        ? collection(services.db, 'events', eventId, 'players').withConverter(playerConverter)
        : null,
    ),
  )
}

/** Newest-first purchases, capped at `max` documents. */
export function usePurchases(eventId: string | null, max = 50): LiveResult<PurchaseDoc[]> {
  return useLive(
    eventId ? `purchases:${eventId}:${max}` : null,
    NO_PURCHASES,
    querySubscribe((services) =>
      eventId
        ? query(
            collection(services.db, 'events', eventId, 'purchases').withConverter(purchaseConverter),
            orderBy('createdAt', 'desc'),
            fsLimit(max),
          )
        : null,
    ),
  )
}

/** Newest-first audit logs (admin-only reads), capped at `max` documents. */
export function useAuditLogs(eventId: string | null, max = 50): LiveResult<AuditLogDoc[]> {
  return useLive(
    eventId ? `auditLogs:${eventId}:${max}` : null,
    NO_LOGS,
    querySubscribe((services) =>
      eventId
        ? query(
            collection(services.db, 'events', eventId, 'auditLogs').withConverter(auditLogConverter),
            orderBy('createdAt', 'desc'),
            fsLimit(max),
          )
        : null,
    ),
  )
}

/* ------------------------------ team queries ------------------------------ */

export function useTeamDoc(
  eventId: string | null,
  teamId: string | null,
): LiveResult<TeamDoc | null> {
  return useLive(
    eventId && teamId ? `team:${eventId}:${teamId}` : null,
    null,
    docSubscribe((services) =>
      eventId && teamId
        ? doc(services.db, 'events', eventId, 'teams', teamId).withConverter(teamConverter)
        : null,
    ),
  )
}

/** The team's own purchase history, newest first. */
export function useTeamPurchases(
  eventId: string | null,
  teamId: string | null,
  max = 200,
): LiveResult<PurchaseDoc[]> {
  return useLive(
    eventId && teamId ? `teamPurchases:${eventId}:${teamId}:${max}` : null,
    NO_PURCHASES,
    querySubscribe((services) =>
      eventId && teamId
        ? query(
            collection(services.db, 'events', eventId, 'purchases').withConverter(purchaseConverter),
            where('teamId', '==', teamId),
            orderBy('createdAt', 'desc'),
            fsLimit(max),
          )
        : null,
    ),
  )
}
