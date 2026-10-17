import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { PIN_MAX, PIN_MIN } from '../shared/constants'
import { isEmulator } from './config'
import { fail } from './errors'

/**
 * PIN handling.
 *
 * A four digit PIN only has 10,000 possibilities, so it is treated as a shared
 * event access code rather than as strong authentication. To make a database
 * leak useless and to keep lookups O(1) we store:
 *   - `pinVerifier`  = HMAC(secret, `${eventId}:${teamId}:${pin}`)   (per team, salted by team id)
 *   - `pinLookupHash` = HMAC(secret, `${eventId}:${pin}`)            (derived document id in `pinIndex`)
 * The HMAC secret never leaves the server. Raw PINs are never stored, logged,
 * or returned by any read endpoint - only the create/reset response returns the
 * newly generated PIN to the signed-in admin exactly once.
 */

const PIN_SECRET = defineSecret('PIN_HMAC_SECRET')

/** Bound to every function that needs to hash or verify PINs. */
export const PIN_SECRET_PARAM = PIN_SECRET

/** Development-only fallback. Never used outside the emulator. */
const DEV_PIN_SECRET = 'development-only-pin-secret-not-for-production-use'

let warnedAboutDevSecret = false

export function pinSecret(): string {
  try {
    const value = PIN_SECRET.value()
    if (value && value.length >= 16) return value
  } catch {
    // Secret not configured - handled below.
  }
  if (isEmulator()) {
    if (!warnedAboutDevSecret) {
      warnedAboutDevSecret = true
      logger.warn(
        'PIN_HMAC_SECRET is not configured; using an emulator-only development secret. ' +
          'Set the secret before deploying: firebase functions:secrets:set PIN_HMAC_SECRET',
      )
    }
    return DEV_PIN_SECRET
  }
  fail(
    'failed-precondition',
    'Server PIN secret is not configured. Set the PIN_HMAC_SECRET secret for the Cloud Functions.',
  )
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex')
}

export function pinLookupHash(secret: string, eventId: string, pin: string): string {
  return hmac(`pin-index:${eventId}:${pin}`, secret)
}

export function pinVerifierHash(
  secret: string,
  eventId: string,
  teamId: string,
  pin: string,
): string {
  return hmac(`pin-verifier:${eventId}:${teamId}:${pin}`, secret)
}

export function hashValue(secret: string, kind: string, value: string): string {
  return hmac(`${kind}:${value}`, secret)
}

/** Cryptographically secure random four digit PIN (1000-9999). */
export function generatePin(): string {
  return String(randomInt(PIN_MIN, PIN_MAX + 1))
}

export function newSessionId(): string {
  return randomBytes(18).toString('base64url')
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`
}

export function safeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Constant-time string equality for arbitrary-length secrets.
 * Compares fixed-length digests so neither content nor length can be probed
 * through timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB)
}
