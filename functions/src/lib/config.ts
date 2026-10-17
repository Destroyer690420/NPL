/** Runtime configuration for the privileged functions. */

export const FUNCTIONS_REGION = process.env.FUNCTIONS_REGION ?? 'us-central1'

export const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true'

export const TEAM_SESSION_TTL_HOURS = clampNumber(process.env.TEAM_SESSION_TTL_HOURS, 12, 1, 72)

export const PIN_ATTEMPT_LIMIT = clampNumber(process.env.MAX_PIN_ATTEMPTS_PER_WINDOW, 10, 3, 100)

export const PIN_ATTEMPT_WINDOW_MINUTES = clampNumber(
  process.env.PIN_ATTEMPT_WINDOW_MINUTES,
  10,
  1,
  120,
)

export const PIN_GLOBAL_ATTEMPT_LIMIT = clampNumber(
  process.env.MAX_PIN_ATTEMPTS_GLOBAL,
  400,
  50,
  10000,
)

/** Comma separated list of allowed browser origins, or empty for "any". */
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

/* ------------------------- interim admin login ---------------------------- */
/*
 * Shared-credential admin login (`adminLogin` callable). This is a deliberate,
 * temporary simplification: the credentials are verified server-side and mint
 * the admin custom token, but they are shared, not per-person. See
 * docs/SECURITY.md. Change ADMIN_LOGIN_PASSWORD before any real event.
 */

export const ADMIN_LOGIN_ID = (process.env.ADMIN_LOGIN_ID ?? '').trim() || 'admin'

export const ADMIN_LOGIN_PASSWORD = process.env.ADMIN_LOGIN_PASSWORD || 'admin'

/** True while both credentials are still the built-in defaults. */
export const ADMIN_LOGIN_USING_DEFAULTS =
  (process.env.ADMIN_LOGIN_ID ?? '').trim() === '' &&
  (process.env.ADMIN_LOGIN_PASSWORD ?? '') === ''

export const ADMIN_LOGIN_ATTEMPT_LIMIT = clampNumber(
  process.env.MAX_ADMIN_LOGIN_ATTEMPTS_PER_WINDOW,
  10,
  3,
  100,
)

export function allowedCors(): string[] | true {
  return ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true
}

export function isEmulator(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.FIREBASE_EMULATOR_HUB !== undefined ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined
  )
}

export function sessionTtlMs(): number {
  return TEAM_SESSION_TTL_HOURS * 60 * 60 * 1000
}

function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}
