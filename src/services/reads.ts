import { isAppErrorCode, type AppErrorCode } from '@shared/errors'
import { toPurchaseDoc } from '@shared/convert'
import type { PurchaseDoc } from '@shared/types'
import { toFriendlyError, isSessionInvalidCode } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { CallError } from './callables'
import { getSessionToken, notifySessionInvalid, type SessionScope } from './session'

/**
 * Read transport.
 *
 * All reads go through the three self-validating database functions the anon
 * role may execute: `api_admin_read`, `api_team_read` and `api_public_config`.
 * The token is never trusted client-side; each function re-validates the
 * session row on every call.
 */

export type AdminResource = 'event' | 'events' | 'teams' | 'players' | 'purchases' | 'audit'
export type TeamResource = 'state' | 'context'

/** De-duplicates concurrent identical reads (e.g. two hooks for one resource). */
const inflight = new Map<string, Promise<unknown>>()

function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const promise = run().finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

function requireToken(scope: SessionScope): string {
  const token = getSessionToken(scope)
  if (!token) throw new CallError(toFriendlyError({ code: 'unauthenticated' }))
  return token
}

async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  scope: SessionScope | null,
): Promise<T> {
  let supabase
  try {
    supabase = requireSupabase()
  } catch (error) {
    throw new CallError(toFriendlyError(error))
  }

  let result: { data: unknown; error: { message?: unknown; code?: unknown } | null }
  try {
    result = (await supabase.rpc(fn, args)) as {
      data: unknown
      error: { message?: unknown; code?: unknown } | null
    }
  } catch {
    throw new CallError(toFriendlyError({ code: 'network' }))
  }

  if (result.error) {
    const message = typeof result.error.message === 'string' ? result.error.message.trim() : ''
    const code: AppErrorCode = isAppErrorCode(message) ? message : 'unavailable'
    if (scope && isSessionInvalidCode(code)) notifySessionInvalid(scope, code)
    throw new CallError(toFriendlyError({ code }))
  }

  return result.data as T
}

export function readAdminResource<T>(
  resource: AdminResource,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = requireToken('admin')
  return dedupe(`admin:${resource}:${JSON.stringify(params)}`, () =>
    rpc<T>('api_admin_read', { p_token: token, p_resource: resource, p_params: params }, 'admin'),
  )
}

export function readTeamResource<T>(resource: TeamResource): Promise<T> {
  const token = requireToken('team')
  return dedupe(`team:${resource}`, () => rpc<T>('api_team_read', { p_token: token, p_resource: resource }, 'team'))
}

/** Public, non-sensitive config (no session required). */
export function readPublicConfig(): Promise<Record<string, unknown> | null> {
  return dedupe('public:config', () => rpc<Record<string, unknown> | null>('api_public_config', {}, null))
}

/**
 * Direct one-off read used for reconciliation after a failed submission: does
 * a purchase with this request id already exist on the server?
 */
export async function fetchPurchaseFromServer(
  eventId: string,
  purchaseId: string,
): Promise<PurchaseDoc | null> {
  const rows = await readAdminResource<Array<Record<string, unknown>>>('purchases', { eventId })
  const row = rows.find(
    (entry) => entry.id === purchaseId || entry.requestId === purchaseId,
  )
  if (!row) return null
  const id = typeof row.id === 'string' ? row.id : purchaseId
  return toPurchaseDoc(id, row)
}
