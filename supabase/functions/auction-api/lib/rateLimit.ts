import { AppFunctionError } from './errors'
import { logger } from './logger'
import { supabase } from './supabase'

/**
 * Fixed-window rate limiting with escalating cooldowns.
 *
 * The atomic read-modify-write runs in the database (`rl_register`), so the
 * behaviour matches the previous Firestore transaction implementation and is
 * safe across concurrent Edge Function invocations.
 */

export interface RateLimitPolicy {
  /** Window length in milliseconds. */
  windowMs: number
  /** Failures allowed inside a window before a cooldown starts. */
  maxFailures: number
  /** First cooldown length; doubles with every further strike. */
  baseLockMs: number
  /** Cooldown ceiling. */
  maxLockMs: number
}

export interface RateLimitDecision {
  allowed: boolean
  retryAfterMs: number
  /** Failures recorded in the current window. */
  failures: number
}

interface RawDecision {
  allowed?: boolean
  retryAfterMs?: number
  failures?: number
  strikes?: number
}

function toDecision(raw: unknown): RateLimitDecision {
  const value = (raw ?? {}) as RawDecision
  return {
    allowed: value.allowed !== false,
    retryAfterMs: typeof value.retryAfterMs === 'number' ? value.retryAfterMs : 0,
    failures: typeof value.failures === 'number' ? value.failures : 0,
  }
}

export class RateLimiter {
  constructor(
    private readonly policy: RateLimitPolicy,
    private readonly keyPrefix: string,
  ) {}

  private refKey(key: string): string {
    return `${this.keyPrefix}:${key}`
  }

  /** Read-only check - does not consume an attempt. */
  async check(key: string): Promise<RateLimitDecision> {
    const { data, error } = await supabase.rpc('rl_check', { p_key: this.refKey(key) })
    if (error) throw new AppFunctionError('unavailable', 'Rate limit check failed.')
    return toDecision(data)
  }

  /** Records a failed attempt and returns the resulting decision. */
  async registerFailure(key: string): Promise<RateLimitDecision> {
    const { data, error } = await supabase.rpc('rl_register', {
      p_key: this.refKey(key),
      p_window_ms: this.policy.windowMs,
      p_max_failures: this.policy.maxFailures,
      p_base_lock_ms: this.policy.baseLockMs,
      p_max_lock_ms: this.policy.maxLockMs,
    })
    if (error) throw new AppFunctionError('unavailable', 'Rate limit update failed.')
    const decision = toDecision(data)
    const strikes = (data as RawDecision | null)?.strikes
    if (!decision.allowed) {
      logger.warn('Rate limit cooldown started', {
        key: `${this.keyPrefix}:${key.slice(0, 8)}…`,
        strikes: typeof strikes === 'number' ? strikes : undefined,
      })
    }
    return decision
  }

  /** Clears the failure window after a successful attempt. */
  async reset(key: string): Promise<void> {
    const { error } = await supabase.rpc('rl_reset', { p_key: this.refKey(key) })
    if (error) throw new AppFunctionError('unavailable', 'Rate limit reset failed.')
  }
}

export const PIN_IP_LIMITER = (policy: RateLimitPolicy) => new RateLimiter(policy, 'pin-ip')
export const PIN_VALUE_LIMITER = (policy: RateLimitPolicy) => new RateLimiter(policy, 'pin-value')
export const PIN_GLOBAL_LIMITER = (policy: RateLimitPolicy) => new RateLimiter(policy, 'pin-global')

export function formatRetryAfter(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} min`
}
