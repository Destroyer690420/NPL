import { appErrorMessage, isAppErrorCode, type AppErrorCode } from '@shared/errors'

export interface FriendlyError {
  code: AppErrorCode
  message: string
  hint?: string
  /** Present for rate limited errors. */
  retryAfterSeconds?: number
  /** True when retrying later may help. */
  retryable: boolean
}

/** Codes that mean the session itself is no longer valid. */
export const SESSION_INVALID_CODES: readonly AppErrorCode[] = [
  'unauthenticated',
  'session-expired',
  'session-revoked',
  'team-inactive',
]

export function isSessionInvalidCode(code: AppErrorCode): boolean {
  return SESSION_INVALID_CODES.includes(code)
}

/**
 * Converts any thrown value into a friendly, non-sensitive message.
 * Never surfaces stack traces, secrets or raw server internals.
 *
 * The Supabase transport (edge function envelope and read RPCs) carries the
 * machine-readable app code directly — as `details.code` in the envelope, as a
 * raw `message` string from the database functions, or as `.code` on a
 * `CallError`. Anything else falls back to `unknown`, with fetch failures
 * mapped to `network`.
 */
export function toFriendlyError(error: unknown): FriendlyError {
  const fallback: FriendlyError = { code: 'unknown', ...appErrorMessage('unknown'), retryable: true }
  if (!error) return fallback

  const value = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    name?: unknown
    retryAfterSeconds?: unknown
  }

  const details = (value.details ?? {}) as { code?: unknown; retryAfterSeconds?: unknown }
  // Errors that are already friendly (`CallError`) carry the app code directly
  // in `.code`; prefer that over any transport mapping.
  const directCode = isAppErrorCode(value.code) ? value.code : null
  const rawMessage = typeof value.message === 'string' ? value.message.trim() : ''
  // Postgres functions raise the app code as the raw message (e.g. 'session-expired').
  const messageCode = isAppErrorCode(rawMessage) ? rawMessage : null
  const appCode = isAppErrorCode(details.code) ? details.code : directCode ?? messageCode

  let code: AppErrorCode = appCode ?? 'unknown'
  if (code === 'unknown') {
    const name = typeof value.name === 'string' ? value.name : ''
    if (name === 'FunctionsFetchError' || name === 'TypeError' || name === 'AbortError') {
      code = 'network'
    }
  }
  const info = appErrorMessage(code)

  const retryAfterFromDetails =
    typeof details.retryAfterSeconds === 'number' && details.retryAfterSeconds > 0
      ? Math.ceil(details.retryAfterSeconds)
      : undefined
  const retryAfterFromError =
    typeof value.retryAfterSeconds === 'number' && value.retryAfterSeconds > 0
      ? Math.ceil(value.retryAfterSeconds)
      : undefined
  const retryAfterSeconds = retryAfterFromDetails ?? retryAfterFromError

  // A human readable server supplied message wins when we only have a generic code.
  const serverMessage =
    rawMessage !== '' && !isAppErrorCode(rawMessage) && rawMessage.length < 200 ? rawMessage : undefined

  const useServerMessage = code === 'invalid-argument' || code === 'failed-precondition'

  return {
    code,
    message: useServerMessage && serverMessage ? serverMessage : info.message,
    hint: info.hint,
    retryAfterSeconds,
    retryable: code !== 'permission-denied' && code !== 'not-admin',
  }
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  const friendly = toFriendlyError(error)
  return friendly.message || fallback
}

export { appErrorMessage }
export type { AppErrorCode }
