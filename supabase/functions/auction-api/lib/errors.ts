import { isAppErrorCode, type AppErrorCode } from '../../_shared/errors.ts'
import { DomainError, isDomainError, type PlannedWrite, type PlanResult } from '../../_shared/plan.ts'
import { logger } from './logger.ts'

/**
 * Typed application error. The entry point converts it into the JSON error
 * envelope the web client understands (same machine readable codes that the
 * Firebase HttpsError carried).
 */

export class AppFunctionError extends Error {
  readonly code: AppErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: AppErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code)
    this.name = 'AppFunctionError'
    this.code = code
    this.details = details
  }
}

/** Throws a typed application error. */
export function fail(code: AppErrorCode, message?: string, details?: Record<string, unknown>): never {
  throw new AppFunctionError(code, message, details)
}

/** Throws when a domain plan did not succeed, otherwise returns its writes + result. */
export function unwrapPlan<T>(plan: PlanResult<T>): { result: T; writes: PlannedWrite[] } {
  if (plan.ok) return { result: plan.result, writes: plan.writes }
  throw new AppFunctionError(plan.code, plan.message ?? plan.code, plan.details)
}

/** Converts any thrown value into a typed error (never leaks internals). */
export function toFunctionError(error: unknown, context?: Record<string, unknown>): AppFunctionError {
  if (error instanceof AppFunctionError) return error
  if (isDomainError(error)) {
    return new AppFunctionError(error.code, error.message, error.details)
  }
  const data = error as { code?: unknown; message?: unknown } | null
  if (data && isAppErrorCode(data.code)) {
    return new AppFunctionError(data.code, String(data.message ?? data.code))
  }
  logger.error('Unhandled function error', {
    ...context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  return new AppFunctionError('internal', 'internal')
}

export function invalidArgument(message: string): AppFunctionError {
  return new AppFunctionError('invalid-argument', message, { message })
}

export { DomainError }
