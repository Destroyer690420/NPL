import type { z } from 'zod'
import type { AppErrorCode } from '../../_shared/errors.ts'
import { firstIssueMessage } from '../../_shared/schemas.ts'
import { ALLOWED_ORIGINS } from './config.ts'
import { AppFunctionError, fail, invalidArgument, toFunctionError } from './errors.ts'
import { supabase } from './supabase.ts'

/**
 * Handler framework for the Edge Function.
 *
 * Authorization is centralised here: admin descriptors require a valid admin
 * session token, team descriptors a valid team session token, public
 * descriptors nothing. Session tokens are validated by the database
 * (`session_resolve`), so the raw token never needs to be trusted blindly.
 */

export interface AdminContext {
  uid: string
  role: 'admin' | 'superAdmin'
  email: string | null
  appCheckVerified: boolean
  ip: string | null
}

export interface TeamContext {
  uid: string
  eventId: string
  teamId: string
  sessionId: string
}

/**
 * A registered handler. The concrete input/context types live on the options
 * object each handler is defined with; the registry only needs a uniform,
 * variance-free shape.
 */
export interface Descriptor<S extends z.ZodType = z.ZodType> {
  kind: 'admin' | 'public' | 'team'
  schema: S
  handler: (input: unknown, context: unknown) => Promise<unknown>
}

export interface CommonOptions {
  secrets?: unknown[]
  memory?: string
  timeoutSeconds?: number
  region?: string
  maxInstances?: number
}

export interface AdminCallableOptions<S extends z.ZodType> extends CommonOptions {
  schema: S
  handler: (input: z.output<S>, context: AdminContext) => Promise<unknown>
}

export interface PublicCallableOptions<S extends z.ZodType> extends CommonOptions {
  schema: S
  handler: (input: z.output<S>, context: { ip: string | null }) => Promise<unknown>
}

export interface TeamCallableOptions<S extends z.ZodType> extends CommonOptions {
  schema: S
  handler: (input: z.output<S>, context: TeamContext) => Promise<unknown>
}

function asDescriptor<S extends z.ZodType>(
  kind: Descriptor['kind'],
  schema: S,
  handler: (input: never, context: never) => Promise<unknown>,
): Descriptor<S> {
  return {
    kind,
    schema,
    handler: handler as unknown as Descriptor<S>['handler'],
  }
}

export function adminCallable<S extends z.ZodType>(
  options: AdminCallableOptions<S>,
): Descriptor<S> {
  return asDescriptor('admin', options.schema, options.handler as (input: never, context: never) => Promise<unknown>)
}

export function publicCallable<S extends z.ZodType>(
  options: PublicCallableOptions<S>,
): Descriptor<S> {
  return asDescriptor('public', options.schema, options.handler as (input: never, context: never) => Promise<unknown>)
}

export function teamCallable<S extends z.ZodType>(options: TeamCallableOptions<S>): Descriptor<S> {
  return asDescriptor('team', options.schema, options.handler as (input: never, context: never) => Promise<unknown>)
}

/* ------------------------------- sessions --------------------------------- */

interface SessionLookup {
  id: string
  data: Record<string, unknown>
}

async function resolveSession(token: string): Promise<SessionLookup | null> {
  if (!token || token.length < 20) return null
  const { data, error } = await supabase.rpc('session_resolve', { p_token: token })
  if (error) {
    throw new AppFunctionError('unavailable', 'The sign-in could not be verified. Please try again.')
  }
  if (!data) return null
  return data as SessionLookup
}

function isExpired(expiresAt: unknown): boolean {
  const seconds = (expiresAt as { seconds?: unknown } | null)?.seconds
  if (typeof seconds !== 'number') return false
  return seconds * 1000 <= Date.now()
}

export async function buildAdminContext(token: string, ip: string | null): Promise<AdminContext> {
  const session = await resolveSession(token)
  if (!session) fail('unauthenticated')
  const data = session.data
  if (data.kind !== 'admin') fail('not-admin')
  if (data.revoked === true) fail('session-revoked')
  if (isExpired(data.expiresAt)) fail('session-expired')
  return {
    uid: typeof data.uid === 'string' ? data.uid : 'organizer',
    role: data.role === 'admin' ? 'admin' : 'superAdmin',
    email: null,
    appCheckVerified: false,
    ip,
  }
}

export async function buildTeamContext(token: string, _ip: string | null): Promise<TeamContext> {
  const session = await resolveSession(token)
  if (!session) fail('unauthenticated')
  const data = session.data
  if (data.kind !== 'team') {
    fail('not-admin', 'This endpoint is only available to team sessions.')
  }
  if (data.revoked === true) fail('session-revoked')
  if (isExpired(data.expiresAt)) fail('session-expired')
  if (typeof data.eventId !== 'string' || typeof data.teamId !== 'string') fail('unauthenticated')
  return {
    uid: `team_${data.teamId}_${session.id}`.slice(0, 120),
    eventId: data.eventId,
    teamId: data.teamId,
    sessionId: session.id,
  }
}

/* ------------------------------- invocation -------------------------------- */

export interface ErrorEnvelope {
  ok: false
  error: { code: string; message: string; retryAfterSeconds?: number }
}

export interface SuccessEnvelope {
  ok: true
  data: unknown
}

export interface InvokeOptions {
  token: string | null
  ip: string | null
}

export async function invokeCallable(
  name: string,
  descriptor: Descriptor,
  input: unknown,
  options: InvokeOptions,
): Promise<SuccessEnvelope | ErrorEnvelope> {
  try {
    const parsed = descriptor.schema.safeParse(input ?? {})
    if (!parsed.success) throw invalidArgument(firstIssueMessage(parsed.error))

    let context: unknown
    if (descriptor.kind === 'admin') {
      context = await buildAdminContext(options.token ?? '', options.ip)
    } else if (descriptor.kind === 'team') {
      context = await buildTeamContext(options.token ?? '', options.ip)
    } else {
      context = { ip: options.ip }
    }

    const data = await descriptor.handler(parsed.data, context)
    return { ok: true, data: data ?? null }
  } catch (error) {
    const appError = toFunctionError(error, { action: name })
    const retryAfterSeconds = appError.details?.retryAfterSeconds
    const envelope: ErrorEnvelope = {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(typeof retryAfterSeconds === 'number' ? { retryAfterSeconds } : {}),
      },
    }
    return envelope
  }
}

/** Retry-After aware rate limit error. */
export function rateLimited(retryAfterMs: number, code: AppErrorCode = 'rate-limited'): never {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  fail(code, 'Too many attempts. Please wait and try again.', { retryAfterSeconds })
}

export { ALLOWED_ORIGINS }
