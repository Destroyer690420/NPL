import { onCall, type CallableRequest, type CallableOptions } from 'firebase-functions/v2/https'
import type { SecretParam } from 'firebase-functions/params'
import type { z } from 'zod'
import { firstIssueMessage } from '../shared/schemas'
import type { AppErrorCode } from '../shared/errors'
import { ALLOWED_ORIGINS, ENFORCE_APP_CHECK, FUNCTIONS_REGION, allowedCors } from './config'
import { fail, invalidArgument, toHttpsError } from './errors'

/**
 * Shared callable wrappers. Authorization is centralised here so that a
 * privileged operation can never be exposed without an admin check.
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

function tokenOf(request: CallableRequest): Record<string, unknown> {
  return (request.auth?.token ?? {}) as Record<string, unknown>
}

function emailOf(request: CallableRequest): string | null {
  const token = tokenOf(request)
  return typeof token.email === 'string' && token.email.includes('@') ? token.email : null
}

export function clientIp(request: CallableRequest): string | null {
  const raw = request.rawRequest as
    | { ip?: string; headers?: Record<string, string | string[] | undefined> }
    | undefined
  const headers = raw?.headers ?? {}
  const forwarded = headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0] ?? null
  return raw?.ip ?? null
}

/**
 * Requires a signed-in Firebase Auth user with the `admin` or `superAdmin`
 * custom claim. Claims are only ever set server-side: the `adminLogin`
 * callable mints the admin claim (interim shared credentials), and team
 * sessions get their own scoped claim from `verifyTeamPin`.
 */
export function requireAdmin(request: CallableRequest): AdminContext {
  const auth = request.auth
  if (!auth) fail('unauthenticated')

  const token = tokenOf(request)
  const firebase = token.firebase as { sign_in_provider?: string } | undefined
  if (firebase?.sign_in_provider === 'anonymous') fail('not-admin')

  const isSuperAdmin = token.superAdmin === true || token.role === 'superAdmin'
  const isAdmin = isSuperAdmin || token.role === 'admin' || token.admin === true
  if (!isAdmin) fail('not-admin')

  return {
    uid: auth.uid,
    role: isSuperAdmin ? 'superAdmin' : 'admin',
    email: emailOf(request),
    appCheckVerified: request.app !== undefined,
    ip: clientIp(request),
  }
}

/** Requires a valid team session token minted by `verifyTeamPin`. */
export function requireTeam(request: CallableRequest): TeamContext {
  const auth = request.auth
  if (!auth) fail('unauthenticated')
  const token = tokenOf(request)
  if (token.kind !== 'team' || typeof token.teamId !== 'string' || typeof token.eventId !== 'string') {
    fail('not-admin', 'This endpoint is only available to team sessions.')
  }
  return {
    uid: auth.uid,
    eventId: String(token.eventId),
    teamId: String(token.teamId),
    sessionId: String(token.sessionId ?? ''),
  }
}

export interface AdminCallableOptions<S extends z.ZodType> {
  schema: S
  handler: (input: z.output<S>, context: AdminContext) => Promise<unknown>
  secrets?: SecretParam[]
  memory?: '128MiB' | '256MiB' | '512MiB' | '1GiB'
  timeoutSeconds?: number
  region?: string
}

export function adminCallable<S extends z.ZodType>(options: AdminCallableOptions<S>) {
  return onCall(
    {
      region: options.region ?? FUNCTIONS_REGION,
      cors: allowedCors(),
      enforceAppCheck: ENFORCE_APP_CHECK,
      secrets: options.secrets,
      maxInstances: 20,
      memory: options.memory ?? '256MiB',
      timeoutSeconds: options.timeoutSeconds ?? 60,
    } satisfies CallableOptions,
    async (request): Promise<unknown> => {
      const context = requireAdmin(request)
      const parsed = options.schema.safeParse(request.data)
      if (!parsed.success) throw invalidArgument(firstIssueMessage(parsed.error))
      try {
        return await options.handler(parsed.data as z.output<S>, context)
      } catch (error) {
        throw toHttpsError(error, { operation: 'admin-callable', uid: context.uid })
      }
    },
  )
}

export interface PublicCallableOptions<S extends z.ZodType> {
  schema: S
  handler: (input: z.output<S>, context: { ip: string | null }) => Promise<unknown>
  secrets?: SecretParam[]
  timeoutSeconds?: number
  maxInstances?: number
}

export function publicCallable<S extends z.ZodType>(options: PublicCallableOptions<S>) {
  return onCall(
    {
      region: FUNCTIONS_REGION,
      cors: allowedCors(),
      enforceAppCheck: ENFORCE_APP_CHECK,
      secrets: options.secrets,
      maxInstances: options.maxInstances ?? 30,
      memory: '256MiB',
      timeoutSeconds: options.timeoutSeconds ?? 30,
    } satisfies CallableOptions,
    async (request): Promise<unknown> => {
      const parsed = options.schema.safeParse(request.data)
      if (!parsed.success) throw invalidArgument(firstIssueMessage(parsed.error))
      try {
        return await options.handler(parsed.data as z.output<S>, { ip: clientIp(request) })
      } catch (error) {
        throw toHttpsError(error, { operation: 'public-callable' })
      }
    },
  )
}

export interface TeamCallableOptions<S extends z.ZodType> {
  schema: S
  handler: (input: z.output<S>, context: TeamContext) => Promise<unknown>
}

export function teamCallable<S extends z.ZodType>(options: TeamCallableOptions<S>) {
  return onCall(
    {
      region: FUNCTIONS_REGION,
      cors: allowedCors(),
      enforceAppCheck: ENFORCE_APP_CHECK,
      maxInstances: 20,
      memory: '256MiB',
      timeoutSeconds: 30,
    } satisfies CallableOptions,
    async (request): Promise<unknown> => {
      const context = requireTeam(request)
      const parsed = options.schema.safeParse(request.data)
      if (!parsed.success) throw invalidArgument(firstIssueMessage(parsed.error))
      try {
        return await options.handler(parsed.data as z.output<S>, context)
      } catch (error) {
        throw toHttpsError(error, { operation: 'team-callable', uid: context.uid })
      }
    },
  )
}

/** Retry-After aware rate limit error. */
export function rateLimited(retryAfterMs: number, code: AppErrorCode = 'rate-limited'): never {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  fail(code, 'Too many attempts. Please wait and try again.', { retryAfterSeconds })
}

export { ALLOWED_ORIGINS }
