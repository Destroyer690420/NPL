import { logger } from 'firebase-functions'
import { rateLimitRef } from './refs'
import { db } from './refs'

/**
 * Fixed-window rate limiting with escalating cooldowns, stored in a
 * server-only collection (`rateLimits/{key}`) that no client can read.
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

interface RateLimitState {
  count: number
  windowStartedAt: number
  strikes: number
  lockedUntil: number
  updatedAt: number
}

const EMPTY: RateLimitState = { count: 0, windowStartedAt: 0, strikes: 0, lockedUntil: 0, updatedAt: 0 }

function toState(data: unknown): RateLimitState {
  const value = (data ?? {}) as Partial<RateLimitState>
  return {
    count: typeof value.count === 'number' ? value.count : 0,
    windowStartedAt: typeof value.windowStartedAt === 'number' ? value.windowStartedAt : 0,
    strikes: typeof value.strikes === 'number' ? value.strikes : 0,
    lockedUntil: typeof value.lockedUntil === 'number' ? value.lockedUntil : 0,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  }
}

export class RateLimiter {
  constructor(
    private readonly policy: RateLimitPolicy,
    private readonly keyPrefix: string,
  ) {}

  private ref(key: string) {
    return rateLimitRef(`${this.keyPrefix}:${key}`)
  }

  /** Read-only check - does not consume an attempt. */
  async check(key: string): Promise<RateLimitDecision> {
    const snapshot = await this.ref(key).get()
    const state = toState(snapshot.data())
    const now = Date.now()
    if (state.lockedUntil > now) {
      return { allowed: false, retryAfterMs: state.lockedUntil - now, failures: state.count }
    }
    return { allowed: true, retryAfterMs: 0, failures: state.count }
  }

  /** Records a failed attempt and returns the resulting decision. */
  async registerFailure(key: string): Promise<RateLimitDecision> {
    const ref = this.ref(key)
    const now = Date.now()
    return db().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref)
      const state = toState(snapshot.data())

      if (state.lockedUntil > now) {
        return { allowed: false, retryAfterMs: state.lockedUntil - now, failures: state.count }
      }

      let count = state.count
      let windowStartedAt = state.windowStartedAt
      let strikes = state.strikes
      let lockedUntil = state.lockedUntil

      if (windowStartedAt === 0 || now - windowStartedAt > this.policy.windowMs) {
        windowStartedAt = now
        count = 0
      }

      count += 1
      let decision: RateLimitDecision = { allowed: true, retryAfterMs: 0, failures: count }

      if (count >= this.policy.maxFailures) {
        strikes += 1
        const lockMs = Math.min(
          this.policy.baseLockMs * 2 ** Math.min(strikes - 1, 6),
          this.policy.maxLockMs,
        )
        lockedUntil = now + lockMs
        count = 0
        windowStartedAt = now
        decision = { allowed: false, retryAfterMs: lockMs, failures: count }
        logger.warn('Rate limit cooldown started', {
          key: `${this.keyPrefix}:${key.slice(0, 8)}…`,
          strikes,
          lockMs,
        })
      }

      tx.set(ref, { count, windowStartedAt, strikes, lockedUntil, updatedAt: now } satisfies RateLimitState)
      return decision
    })
  }

  /** Clears the failure window after a successful attempt. */
  async reset(key: string): Promise<void> {
    await this.ref(key).set({ ...EMPTY, updatedAt: Date.now() })
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
