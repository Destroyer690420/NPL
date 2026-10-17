import { isAppErrorCode, type AppErrorCode } from '@shared/errors'
import { toFriendlyError, isSessionInvalidCode, type FriendlyError } from '@/lib/errors'
import { auctionFunctionName } from '@/lib/config'
import { requireSupabase } from '@/lib/supabase'
import { getSessionToken, notifySessionInvalid, type SessionScope } from './session'

/**
 * Typed wrapper around the Supabase edge function transport (`auction-api`).
 *
 * Every server failure is converted into a `CallError` carrying a
 * machine-readable code plus user-facing copy, so UI code can react to codes
 * (for example `invalid-pin`, `rate-limited`) without ever parsing messages.
 * The wire envelope is `{ok:true,data}` or `{ok:false,error:{code,message}}`.
 */

export class CallError extends Error implements FriendlyError {
  readonly code: AppErrorCode
  readonly hint?: string
  readonly retryAfterSeconds?: number
  readonly retryable: boolean

  constructor(friendly: FriendlyError) {
    super(friendly.message)
    this.name = 'CallError'
    this.code = friendly.code
    this.hint = friendly.hint
    this.retryAfterSeconds = friendly.retryAfterSeconds
    this.retryable = friendly.retryable
  }
}

export function isCallError(error: unknown): error is CallError {
  return error instanceof CallError
}

interface ApiErrorPayload {
  code?: unknown
  message?: unknown
  retryAfterSeconds?: unknown
}

interface ApiEnvelope<T> {
  ok?: unknown
  data?: T
  error?: ApiErrorPayload
}

/** Actions that need no token at all (the credentials themselves are the check). */
const PUBLIC_ACTIONS = new Set(['adminLogin', 'verifyTeamPin'])
/** Actions authenticated by the team session token; everything else is admin. */
const TEAM_ACTIONS = new Set(['getTeamContext', 'logoutTeamSession'])

function scopeForAction(name: string): SessionScope | null {
  if (PUBLIC_ACTIONS.has(name)) return null
  return TEAM_ACTIONS.has(name) ? 'team' : 'admin'
}

function errorFromPayload(payload: ApiErrorPayload, scope: SessionScope | null): CallError {
  const code: AppErrorCode = isAppErrorCode(payload.code) ? payload.code : 'unknown'
  const error = new CallError(
    toFriendlyError({
      code,
      message: payload.message,
      retryAfterSeconds: payload.retryAfterSeconds,
    }),
  )
  if (scope && isSessionInvalidCode(code)) notifySessionInvalid(scope, code)
  return error
}

/** Extracts the JSON envelope from a non-2xx edge function response, if any. */
async function readHttpErrorBody(error: unknown): Promise<ApiEnvelope<unknown> | null> {
  const context = (error as { context?: unknown })?.context
  if (context instanceof Response) {
    try {
      return (await context.json()) as ApiEnvelope<unknown>
    } catch {
      return null
    }
  }
  return null
}

/** Calls an edge function action and returns its typed payload. Throws `CallError`. */
export async function callFunction<Input extends object, Output>(
  name: string,
  input: Input,
): Promise<Output> {
  let supabase
  try {
    supabase = requireSupabase()
  } catch (error) {
    throw new CallError(toFriendlyError(error))
  }

  const scope = scopeForAction(name)
  const token = scope ? getSessionToken(scope) : null
  if (scope && !token) {
    throw new CallError(toFriendlyError({ code: 'unauthenticated' }))
  }

  let result: { data: unknown; error: unknown }
  try {
    result = (await supabase.functions.invoke(auctionFunctionName, {
      body: { action: name, input, token },
    })) as { data: unknown; error: unknown }
  } catch {
    throw new CallError(toFriendlyError({ code: 'network' }))
  }

  const envelope = result.data as ApiEnvelope<Output> | null
  if (result.error || envelope === null || typeof envelope !== 'object') {
    // A non-2xx response (function boot failure or platform outage). The
    // function itself always answers HTTP 200 with an envelope, so an HTTP
    // error still gets a chance to carry one.
    const body = await readHttpErrorBody(result.error)
    if (body?.ok === false && body.error) throw errorFromPayload(body.error, scope)
    throw new CallError(toFriendlyError({ code: 'unavailable' }))
  }

  if (envelope.ok !== true) {
    if (envelope.error) throw errorFromPayload(envelope.error, scope)
    throw new CallError(toFriendlyError({ code: 'unavailable' }))
  }

  return envelope.data as Output
}
