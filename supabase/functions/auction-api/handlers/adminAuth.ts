import { createHash } from 'node:crypto'
import { adminLoginSchema } from '../../_shared/schemas'
import {
  ADMIN_LOGIN_ATTEMPT_LIMIT,
  ADMIN_LOGIN_ID,
  ADMIN_LOGIN_PASSWORD,
  ADMIN_LOGIN_USING_DEFAULTS,
  PIN_ATTEMPT_WINDOW_MINUTES,
  adminSessionTtlMs,
} from '../lib/config'
import { publicCallable, rateLimited } from '../lib/callables'
import { fail } from '../lib/errors'
import { Timestamp } from '../lib/firestore-shim'
import { logger } from '../lib/logger'
import { newSessionId, newSessionToken, safeEqual, sessionTokenHash } from '../lib/pin'
import { RateLimiter } from '../lib/rateLimit'
import { db, sessionRef } from '../lib/refs'

/**
 * Interim admin login with shared credentials.
 *
 * The credentials (ADMIN_LOGIN_ID / ADMIN_LOGIN_PASSWORD, defaults admin/admin)
 * are verified here, server-side, and a database session bound to
 * `role: superAdmin` is created. The 256-bit session token returned to the
 * client is the only credential it holds; the database stores just its hash.
 * See docs/SECURITY.md for the accepted weaknesses of shared credentials.
 */

const MINUTE = 60_000

/** Per-IP limiter: blocks password guessing from a single host. */
const IP_LIMITER = new RateLimiter(
  {
    windowMs: PIN_ATTEMPT_WINDOW_MINUTES * MINUTE,
    maxFailures: ADMIN_LOGIN_ATTEMPT_LIMIT,
    baseLockMs: 15 * MINUTE,
    maxLockMs: 240 * MINUTE,
  },
  'admin-login-ip',
)

/** Circuit breaker for distributed guessing (many IPs, one deployment). */
const GLOBAL_LIMITER = new RateLimiter(
  {
    windowMs: PIN_ATTEMPT_WINDOW_MINUTES * MINUTE,
    maxFailures: 200,
    baseLockMs: 5 * MINUTE,
    maxLockMs: 30 * MINUTE,
  },
  'admin-login-global',
)

function ipKeyOf(ip: string): string {
  // Hashed so no raw IP is stored (rate-limit keys live in a server-only table).
  return createHash('sha256').update(`admin-login:${ip}`).digest('hex').slice(0, 40)
}

export const adminLogin = publicCallable({
  schema: adminLoginSchema,
  handler: async (input, context) => {
    const ipKey = ipKeyOf(context.ip ?? 'unknown')

    const globalCheck = await GLOBAL_LIMITER.check('all')
    if (!globalCheck.allowed) rateLimited(globalCheck.retryAfterMs)
    const ipCheck = await IP_LIMITER.check(ipKey)
    if (!ipCheck.allowed) rateLimited(ipCheck.retryAfterMs)

    // Both fields are always compared, in constant time, so neither content
    // nor length leaks through timing and the error never says which failed.
    const idOk = safeEqual(input.adminId, ADMIN_LOGIN_ID)
    const passwordOk = safeEqual(input.password, ADMIN_LOGIN_PASSWORD)
    if (!idOk || !passwordOk) {
      const decisions = await Promise.all([
        IP_LIMITER.registerFailure(ipKey),
        GLOBAL_LIMITER.registerFailure('all'),
      ])
      const locked = decisions.find((decision) => !decision.allowed)
      if (locked) rateLimited(locked.retryAfterMs)
      fail('invalid-admin-login')
    }

    // A genuine login clears the caller's cooldown state.
    await Promise.all([IP_LIMITER.reset(ipKey), GLOBAL_LIMITER.reset('all')])

    // One shared organizer identity for now: every action still lands in the
    // audit log with this uid, and every admin action requires this session.
    const sessionId = newSessionId()
    const token = newSessionToken()
    const expiresAt = Timestamp.fromMillis(Date.now() + adminSessionTtlMs())

    const batch = db().batch()
    batch.set(sessionRef(null, sessionId), {
      kind: 'admin',
      uid: 'organizer',
      role: 'superAdmin',
      tokenHash: sessionTokenHash(token),
      revoked: false,
      createdAt: new Date(),
      expiresAt,
      createdByIpHash: ipKey,
    })
    await batch.commit()

    logger.info('Admin signed in with shared credentials', {
      ipHash: ipKey.slice(0, 12),
      usingDefaultCredentials: ADMIN_LOGIN_USING_DEFAULTS,
    })

    return {
      token,
      sessionId,
      expiresAt: expiresAt.toMillis(),
      usingDefaultCredentials: ADMIN_LOGIN_USING_DEFAULTS,
    }
  },
})
