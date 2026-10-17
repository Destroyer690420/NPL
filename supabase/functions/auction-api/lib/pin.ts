import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { PIN_MAX, PIN_MIN } from '../../_shared/constants.ts'
import { AppFunctionError, fail } from './errors.ts'
import { logger } from './logger.ts'
import { readEnv, supabase } from './supabase.ts'

/**
 * PIN and session-token handling.
 *
 * A four digit PIN only has 10,000 possibilities, so it is treated as a shared
 * event access code rather than as strong authentication. To make a database
 * leak useless and to keep lookups O(1) we store:
 *   - `pinVerifier`   = HMAC(secret, `pin-verifier:${eventId}:${teamId}:${pin}`)
 *   - `pinLookupHash` = HMAC(secret, `pin-index:${eventId}:${pin}`)  (pin_index id)
 * The HMAC secret never leaves the server and raw PINs are never stored.
 *
 * Session tokens are 256-bit random strings; the database stores only their
 * SHA-256 hash, so a database leak cannot be replayed as a live session.
 */

/** Kept for import parity with the handlers (`secrets: [PIN_SECRET_PARAM]`). */
export const PIN_SECRET_PARAM = { name: 'PIN_HMAC_SECRET' } as const

let secretCache: string | null = null
let secretPromise: Promise<string> | null = null

/**
 * Resolves the PIN HMAC secret: the `PIN_HMAC_SECRET` environment secret when
 * configured, otherwise a strong secret generated once and stored in the
 * server-only database. Safe to call on every request (memoized).
 */
export function ensurePinSecret(): Promise<string> {
  const fromEnv = readEnv('PIN_HMAC_SECRET')
  if (fromEnv && fromEnv.length >= 16) {
    secretCache = fromEnv
    return Promise.resolve(fromEnv)
  }
  if (secretCache) return Promise.resolve(secretCache)
  secretPromise ??= (async () => {
    const { data, error } = await supabase.rpc('ensure_pin_secret')
    if (error || typeof data !== 'string' || data.length < 16) {
      logger.error('Could not load the server PIN secret', { message: error?.message })
      throw new AppFunctionError(
        'failed-precondition',
        'Server PIN secret is not configured. Set PIN_HMAC_SECRET for the Edge Function.',
      )
    }
    secretCache = data
    logger.warn(
      'PIN_HMAC_SECRET is not set as an Edge Function secret; using the auto-generated ' +
        'database secret. Set PIN_HMAC_SECRET before the event for a managed secret.',
    )
    return data
  })()
  return secretPromise
}

/** Synchronous accessor; the entry point always initializes it first. */
export function pinSecret(): string {
  if (!secretCache) {
    fail('failed-precondition', 'Server PIN secret is not ready yet. Please try again.')
  }
  return secretCache
}

/** Firestore-era emulator fallback name kept for parity; unused on Supabase. */
export function isEmulator(): boolean {
  return false
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex')
}

export function pinLookupHash(secret: string, eventId: string, pin: string): string {
  return hmac(`pin-index:${eventId}:${pin}`, secret)
}

export function pinVerifierHash(secret: string, eventId: string, teamId: string, pin: string): string {
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

/** 256-bit bearer token handed to a signed-in admin or team client. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Only this hash is stored; the raw token never touches the database. */
export function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const encoder = new TextEncoder()
  const bufferA = encoder.encode(a)
  const bufferB = encoder.encode(b)
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Constant-time string equality for arbitrary-length secrets. Compares
 * fixed-length digests so neither content nor length can be probed through
 * timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB)
}
