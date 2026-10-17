import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { isAppErrorCode, type AppErrorCode } from '../shared/errors'
import { DomainError, isDomainError, type PlannedWrite, type PlanResult } from '../shared/plan'

const HTTP_STATUS_BY_CODE: Partial<Record<AppErrorCode, FunctionsErrorCode>> = {
  unauthenticated: 'unauthenticated',
  'not-admin': 'permission-denied',
  'not-super-admin': 'permission-denied',
  'permission-denied': 'permission-denied',
  'invalid-pin': 'invalid-argument',
  'invalid-pin-format': 'invalid-argument',
  'rate-limited': 'resource-exhausted',
  'session-expired': 'unauthenticated',
  'session-revoked': 'unauthenticated',
  'team-inactive': 'failed-precondition',
  'event-not-found': 'not-found',
  'event-not-active': 'failed-precondition',
  'event-not-started': 'failed-precondition',
  'event-finalized': 'failed-precondition',
  'event-not-ready': 'failed-precondition',
  'event-consistency-failed': 'failed-precondition',
  'player-not-found': 'not-found',
  'player-already-sold': 'failed-precondition',
  'player-withdrawn': 'failed-precondition',
  'player-not-sold': 'failed-precondition',
  'player-status-conflict': 'failed-precondition',
  'player-duplicate-external-id': 'already-exists',
  'player-invalid': 'invalid-argument',
  'team-not-found': 'not-found',
  'team-name-taken': 'already-exists',
  'team-not-selected': 'invalid-argument',
  'team-insufficient-purse': 'failed-precondition',
  'team-roster-full': 'failed-precondition',
  'team-state-inconsistent': 'failed-precondition',
  'team-has-purchases': 'failed-precondition',
  'team-purse-too-low': 'failed-precondition',
  'invalid-price': 'invalid-argument',
  'purchase-not-found': 'not-found',
  'purchase-already-reversed': 'failed-precondition',
  'purchase-reversal-conflict': 'failed-precondition',
  'reason-required': 'invalid-argument',
  'request-conflict': 'aborted',
  'request-id-invalid': 'invalid-argument',
  'purchases-disabled': 'failed-precondition',
  'invalid-argument': 'invalid-argument',
  'not-found': 'not-found',
  'already-exists': 'already-exists',
  'failed-precondition': 'failed-precondition',
  internal: 'internal',
  unavailable: 'unavailable',
  network: 'unavailable',
  unknown: 'internal',
}

export function statusForCode(code: AppErrorCode): FunctionsErrorCode {
  return HTTP_STATUS_BY_CODE[code] ?? 'internal'
}

/** Throws a typed HttpsError carrying the machine readable app error code. */
export function fail(
  code: AppErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): never {
  throw new HttpsError(statusForCode(code), message ?? code, { code, ...(details ?? {}) })
}

/** Throws when a domain plan did not succeed, otherwise returns its writes + result. */
export function unwrapPlan<T>(plan: PlanResult<T>): { result: T; writes: PlannedWrite[] } {
  if (plan.ok) return { result: plan.result, writes: plan.writes }
  throw new HttpsError(statusForCode(plan.code), plan.message ?? plan.code, {
    code: plan.code,
    ...(plan.details ?? {}),
  })
}

/** Converts any thrown value into a safe HttpsError (never leaks internals). */
export function toHttpsError(error: unknown, context?: Record<string, unknown>): HttpsError {
  if (error instanceof HttpsError) return error
  if (isDomainError(error)) {
    return new HttpsError(statusForCode(error.code), error.message, {
      code: error.code,
      ...(error.details ?? {}),
    })
  }
  const data = error as { code?: unknown; message?: unknown } | null
  if (data && isAppErrorCode(data.code)) {
    return new HttpsError(statusForCode(data.code), String(data.message ?? data.code), {
      code: data.code,
    })
  }
  logger.error('Unhandled function error', {
    ...context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  return new HttpsError('internal', 'internal', { code: 'internal' })
}

export function invalidArgument(message: string): HttpsError {
  return new HttpsError('invalid-argument', message, { code: 'invalid-argument', message })
}

export { DomainError }
