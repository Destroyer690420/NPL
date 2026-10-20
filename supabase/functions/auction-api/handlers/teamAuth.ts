import { z } from 'zod'
import { verifyTeamPinSchema } from '../../_shared/schemas.ts'
import { getPlayerSortOrder, timestampToMillis } from '../../_shared/convert.ts'
import {
  PIN_ATTEMPT_LIMIT,
  PIN_ATTEMPT_WINDOW_MINUTES,
  PIN_GLOBAL_ATTEMPT_LIMIT,
  sessionTtlMs,
} from '../lib/config.ts'
import { publicCallable, rateLimited, teamCallable } from '../lib/callables.ts'
import { fail } from '../lib/errors.ts'
import { Timestamp } from '../lib/firestore-shim.ts'
import {
  PIN_SECRET_PARAM,
  hashValue,
  newSessionId,
  newSessionToken,
  pinLookupHash,
  pinSecret,
  pinVerifierHash,
  safeEqualHex,
  sessionTokenHash,
} from '../lib/pin.ts'
import { RateLimiter } from '../lib/rateLimit.ts'
import { auditCollection, db, fetchDocById, fetchQueryRows, playersCollection, sessionRef } from '../lib/refs.ts'
import { getConfig, getEvent, getSecret, getSession, getTeam } from '../lib/store.ts'

/**
 * Team PIN verification.
 *
 * The PIN is verified server-side, never client-side. On success an opaque
 * 256-bit session token is issued bound to exactly one
 * {eventId, teamId, sessionId}; the database stores only the token hash, and
 * every authenticated call re-validates the session row, so revocation (PIN
 * reset, deactivation, logout) takes effect immediately.
 */

const MINUTE = 60_000

/** Per-IP limiter: blocks scanning a range of PINs from a single host. */
const IP_LIMITER = new RateLimiter(
  {
    windowMs: PIN_ATTEMPT_WINDOW_MINUTES * MINUTE,
    maxFailures: PIN_ATTEMPT_LIMIT,
    baseLockMs: 15 * MINUTE,
    maxLockMs: 240 * MINUTE,
  },
  'pin-ip',
)

/** Per-PIN-value limiter: blocks hammering one code from many IPs. */
const VALUE_LIMITER = new RateLimiter(
  {
    windowMs: PIN_ATTEMPT_WINDOW_MINUTES * MINUTE,
    maxFailures: 5,
    baseLockMs: 30 * MINUTE,
    maxLockMs: 720 * MINUTE,
  },
  'pin-value',
)

/** Circuit breaker for distributed scanning attempts. */
const GLOBAL_LIMITER = new RateLimiter(
  {
    windowMs: PIN_ATTEMPT_WINDOW_MINUTES * MINUTE,
    maxFailures: PIN_GLOBAL_ATTEMPT_LIMIT,
    baseLockMs: 5 * MINUTE,
    maxLockMs: 30 * MINUTE,
  },
  'pin-global',
)

export const verifyTeamPin = publicCallable({
  schema: verifyTeamPinSchema,
  secrets: [PIN_SECRET_PARAM],
  handler: async (input, context) => {
    const secret = pinSecret()
    const ip = context.ip ?? 'unknown'
    const ipKey = hashValue(secret, 'ip', ip).slice(0, 40)

    const config = await getConfig()
    const eventId = input.eventId ?? config?.defaultEventId ?? null
    if (!eventId) {
      fail('event-not-found', 'No event is configured yet. Ask the organizer for the event link.')
    }

    const pinKey = hashValue(secret, 'pin-value', `${eventId}:${input.pin}`).slice(0, 40)

    const global = await GLOBAL_LIMITER.check('all')
    if (!global.allowed) rateLimited(global.retryAfterMs)
    const ipCheck = await IP_LIMITER.check(ipKey)
    if (!ipCheck.allowed) rateLimited(ipCheck.retryAfterMs)
    const valueCheck = await VALUE_LIMITER.check(pinKey)
    if (!valueCheck.allowed) rateLimited(valueCheck.retryAfterMs)

    /** Records the failed attempt everywhere and throws a generic error. */
    const registrationFailed = async (): Promise<never> => {
      const decisions = await Promise.all([
        GLOBAL_LIMITER.registerFailure('all'),
        IP_LIMITER.registerFailure(ipKey),
        VALUE_LIMITER.registerFailure(pinKey),
      ])
      const locked = decisions.find((decision) => !decision.allowed)
      if (locked) rateLimited(locked.retryAfterMs)
      fail('invalid-pin')
    }

    const event = await getEvent(eventId)
    if (!event) fail('event-not-found')

    const lookupHash = pinLookupHash(secret, eventId, input.pin)
    const indexRow = await fetchDocById('pin_index', lookupHash)
    if (!indexRow) return registrationFailed()

    const teamId = typeof indexRow.teamId === 'string' ? indexRow.teamId : null
    if (!teamId || indexRow.eventId !== eventId) return registrationFailed()

    const secretDoc = await getSecret(eventId, teamId)
    const expected = pinVerifierHash(secret, eventId, teamId, input.pin)
    if (!secretDoc || !safeEqualHex(expected, secretDoc.pinVerifier)) {
      return registrationFailed()
    }

    const team = await getTeam(eventId, teamId)
    if (!team) return registrationFailed()
    if (!team.active) {
      fail('team-inactive', 'This team is deactivated. Ask the organizer to reactivate it.')
    }

    const sessionId = newSessionId()
    const sessionToken = newSessionToken()
    const expiresAt = Timestamp.fromMillis(Date.now() + sessionTtlMs())
    const uid = `team_${teamId}_${sessionId}`.slice(0, 120)

    const batch = db().batch()
    batch.set(sessionRef(eventId, sessionId), {
      kind: 'team',
      eventId,
      teamId,
      uid,
      tokenHash: sessionTokenHash(sessionToken),
      revoked: false,
      createdAt: new Date(),
      expiresAt,
      createdByIpHash: ipKey,
    })
    batch.set(auditCollection(eventId).doc(), {
      eventId,
      actorUid: uid,
      actorRole: 'system',
      action: 'session.created',
      targetType: 'session',
      targetId: sessionId,
      reason: null,
      metadata: { teamId, teamName: team.name, ipHash: ipKey.slice(0, 12) },
      createdAt: new Date(),
    })
    await batch.commit()

    await Promise.all([IP_LIMITER.reset(ipKey), VALUE_LIMITER.reset(pinKey)])

    return {
      sessionToken,
      sessionId,
      eventId,
      teamId,
      teamName: team.name,
      logoUrl: team.logoUrl,
      expiresAt: expiresAt.toMillis(),
      eventName: event.name,
      currencyLabel: event.currencyLabel,
      eventStatus: event.status,
    }
  },
})

/**
 * Returns the display context for the calling team session (event + team
 * names, currency label, session expiry). Used after a page reload, when the
 * `verifyTeamPin` response is no longer in memory. Re-validates the backing
 * session row so a revoked or expired session is rejected here too.
 */
export const getTeamContext = teamCallable({
  schema: z.object({}),
  handler: async (_input, context) => {
    const session = context.sessionId
      ? await getSession(context.eventId, context.sessionId)
      : null
    if (!session || session.teamId !== context.teamId) {
      fail('session-revoked', 'This session is no longer valid. Please sign in again.')
    }
    if (session.revoked) {
      fail('session-revoked', 'This session was ended. Please sign in again.')
    }
    const expiresAtMs = timestampToMillis(session.expiresAt)
    if (expiresAtMs !== null && expiresAtMs <= Date.now()) {
      fail('session-expired', 'This session has expired. Please sign in again.')
    }

    const event = await getEvent(context.eventId)
    const team = await getTeam(context.eventId, context.teamId)
    if (!event || !team) {
      fail('not-found', 'The event or team no longer exists.')
    }
    if (!team.active) {
      fail('team-inactive', 'This team is deactivated. Ask the organizer to reactivate it.')
    }

    return {
      eventId: event.id,
      eventName: event.name,
      currencyLabel: event.currencyLabel,
      eventStatus: event.status,
      teamId: team.id,
      teamName: team.name,
      logoUrl: team.logoUrl,
      expiresAt: expiresAtMs,
    }
  },
})

/** Revokes the calling team session. */
export const logoutTeamSession = teamCallable({
  schema: z.object({}),
  handler: async (_input, context) => {
    if (!context.sessionId) return { revoked: false }
    const session = await getSession(context.eventId, context.sessionId)
    if (session) {
      const batch = db().batch()
      batch.set(sessionRef(context.eventId, context.sessionId), {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: 'logout',
      })
      await batch.commit()
    }
    return { revoked: true }
  },
})

/**
 * Returns all available players in the auction pool for team sessions.
 * Security: Omits points and base price, returning only player identity (id, name, photoUrl).
 */
export const getTeamLineup = teamCallable({
  schema: z.object({}),
  handler: async (_input, context) => {
    const session = context.sessionId
      ? await getSession(context.eventId, context.sessionId)
      : null
    if (!session || session.teamId !== context.teamId || session.revoked) {
      fail('session-revoked', 'This session is no longer valid. Please sign in again.')
    }
    const expiresAtMs = timestampToMillis(session.expiresAt)
    if (expiresAtMs !== null && expiresAtMs <= Date.now()) {
      fail('session-expired', 'This session has expired. Please sign in again.')
    }

    const team = await getTeam(context.eventId, context.teamId)
    if (!team || !team.active) {
      fail('team-inactive', 'This team is deactivated. Ask the organizer to reactivate it.')
    }

    const rows = await fetchQueryRows(playersCollection(context.eventId))
    return rows
      .map((r) => {
        const data = r.data
        const status = typeof data.status === 'string' ? data.status : 'available'
        return {
          id: r.id,
          name: typeof data.name === 'string' ? data.name : '',
          photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : null,
          sortOrder: typeof data.sortOrder === 'number' && Number.isFinite(data.sortOrder) ? data.sortOrder : null,
          externalReference: typeof data.externalReference === 'string' ? data.externalReference : null,
          nationality: typeof data.nationality === 'string' ? data.nationality : null,
          role: typeof data.role === 'string' ? data.role : null,
          star: typeof data.star === 'string' ? data.star : null,
          status,
        }
      })
      .filter((p) => p.status === 'available')
      .sort((a, b) => {
        const orderA = getPlayerSortOrder(a)
        const orderB = getPlayerSortOrder(b)
        if (orderA !== orderB) return orderA - orderB
        return a.name.localeCompare(b.name)
      })
  },
})

