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

/** Maps Firebase SDK errors to app error codes. */
function codeFromFirebase(errorCode: string): AppErrorCode | null {
  switch (errorCode) {
    case 'functions/unauthenticated':
      return 'unauthenticated'
    case 'functions/permission-denied':
      return 'permission-denied'
    case 'functions/resource-exhausted':
      return 'rate-limited'
    case 'functions/not-found':
      return 'not-found'
    case 'functions/already-exists':
      return 'already-exists'
    case 'functions/failed-precondition':
      return 'failed-precondition'
    case 'functions/invalid-argument':
      return 'invalid-argument'
    case 'functions/unavailable':
    case 'unavailable':
    case 'firestore/unavailable':
      return 'network'
    case 'functions/internal':
    case 'functions/unknown':
    case 'internal':
    case 'firestore/internal':
      return 'internal'
    case 'firestore/permission-denied':
      return 'permission-denied'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
    case 'auth/invalid-email':
      return 'unauthenticated'
    case 'auth/too-many-requests':
      return 'rate-limited'
    case 'auth/network-request-failed':
      return 'network'
    default:
      return null
  }
}

/**
 * Converts any thrown value into a friendly, non-sensitive message.
 * Never surfaces stack traces, secrets or raw server internals.
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
  // in `.code`; prefer that over any Firebase transport mapping.
  const directCode = isAppErrorCode(value.code) ? value.code : null
  const appCode = isAppErrorCode(details.code)
    ? details.code
    : directCode ?? (isAppErrorCode(value.message) ? value.message : null)

  const firebaseCode = typeof value.code === 'string' ? codeFromFirebase(value.code) : null
  const code = appCode ?? firebaseCode ?? 'unknown'
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
    typeof value.message === 'string' && !isAppErrorCode(value.message) && value.message.length < 200
      ? value.message
      : undefined

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
