import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { z } from 'zod'
import { verifyTeamPinSchema } from '../shared/schemas'
import {
  PIN_ATTEMPT_LIMIT,
  PIN_ATTEMPT_WINDOW_MINUTES,
  PIN_GLOBAL_ATTEMPT_LIMIT,
  sessionTtlMs,
} from '../lib/config'
import { publicCallable, rateLimited, teamCallable } from '../lib/callables'
import { fail } from '../lib/errors'
import { PIN_SECRET_PARAM, hashValue, newSessionId, pinLookupHash, pinVerifierHash, pinSecret, safeEqualHex } from '../lib/pin'
import { RateLimiter } from '../lib/rateLimit'
import { auditCollection, db, pinIndexRef, sessionRef } from '../lib/refs'
import { getConfig, getEvent, getSecret, getSession, getTeam } from '../lib/store'
import { timestampToMillis } from '../shared/convert'

/**
 * Team PIN verification.
 *
 * The PIN is verified server-side, never client-side. On success the function
 * mints a Firebase Auth custom token whose claims are bound to exactly one
 * {eventId, teamId, sessionId}; the Firestore rules re-check the backing
 * session document on every read, so revocation and expiry are immediate.
 */

const MINUTE = 60_000

const IP_LIMITER = new RateLimiter(
  {
    windowMs: PIN_ATTEMPT_WINDOW_MINUTES * MINUTE,
    maxFailures: PIN_ATTEMPT_LIMIT,
    baseLockMs: 15 * MINUTE,
    maxLockMs: 240 * MINUTE,
  },
  'pin-ip',
)

/** Blocks repeated guessing of the *same* four digits across all teams. */
const VALUE_LIMITER = new RateLimiter(
  {
    windowMs: 60 * MINUTE,
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
    const indexSnapshot = await pinIndexRef(lookupHash).get()
    if (!indexSnapshot.exists) return registrationFailed()

    const index = indexSnapshot.data() as { eventId?: string; teamId?: string } | undefined
    if (!index?.teamId || index.eventId !== eventId) return registrationFailed()

    const teamId = index.teamId
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
    const expiresAt = Timestamp.fromMillis(Date.now() + sessionTtlMs())
    const uid = `team_${teamId}_${sessionId}`.slice(0, 120)

    const token = await getAuth().createCustomToken(uid, {
      kind: 'team',
      role: 'team',
      eventId,
      teamId,
      sessionId,
    })

    const batch = db().batch()
    batch.set(sessionRef(eventId, sessionId), {
      eventId,
      teamId,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
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
      createdAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    await Promise.all([IP_LIMITER.reset(ipKey), VALUE_LIMITER.reset(pinKey)])

    return {
      sessionToken: token,
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
 * session document so a revoked or expired session is rejected here too.
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
    const ref = sessionRef(context.eventId, context.sessionId)
    const snapshot = await ref.get()
    if (snapshot.exists) {
      await ref.set(
        {
          revoked: true,
          revokedAt: FieldValue.serverTimestamp(),
          revokedReason: 'logout',
        },
        { merge: true },
      )
    }
    try {
      await getAuth().revokeRefreshTokens(context.uid)
    } catch {
      // Best effort - the session document is already revoked.
    }
    return { revoked: true }
  },
})
