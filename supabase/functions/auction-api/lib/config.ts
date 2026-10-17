import { readEnv } from './supabase.ts'

/**
 * Runtime configuration for the auction Edge Function.
 *
 * All values are environment variables (`supabase secrets set ...` or the
 * dashboard). Defaults are safe for a first run; change the admin password
 * before a real event. See docs/SECURITY.md.
 */

export const TEAM_SESSION_TTL_HOURS = clampNumber(readEnv('TEAM_SESSION_TTL_HOURS'), 12, 1, 72)

export const ADMIN_SESSION_TTL_HOURS = clampNumber(readEnv('ADMIN_SESSION_TTL_HOURS'), 24, 1, 168)

export const PIN_ATTEMPT_LIMIT = clampNumber(readEnv('MAX_PIN_ATTEMPTS_PER_WINDOW'), 10, 3, 100)

export const PIN_ATTEMPT_WINDOW_MINUTES = clampNumber(
  readEnv('PIN_ATTEMPT_WINDOW_MINUTES'),
  10,
  1,
  120,
)

export const PIN_GLOBAL_ATTEMPT_LIMIT = clampNumber(readEnv('MAX_PIN_ATTEMPTS_GLOBAL'), 400, 50, 10000)

/** Comma separated list of allowed browser origins, or empty for "any". */
export const ALLOWED_ORIGINS = (readEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

/* ------------------------- interim admin login ---------------------------- */
/*
 * Shared-credential admin login (`adminLogin`). This is a deliberate,
 * temporary simplification: the credentials are verified server-side. See
 * docs/SECURITY.md. Change ADMIN_LOGIN_PASSWORD before any real event.
 */

export const ADMIN_LOGIN_ID = (readEnv('ADMIN_LOGIN_ID') ?? '').trim() || 'admin'

export const ADMIN_LOGIN_PASSWORD = readEnv('ADMIN_LOGIN_PASSWORD') || 'admin'

/** True while both credentials are still the built-in defaults. */
export const ADMIN_LOGIN_USING_DEFAULTS =
  (readEnv('ADMIN_LOGIN_ID') ?? '').trim() === '' && (readEnv('ADMIN_LOGIN_PASSWORD') ?? '') === ''

export const ADMIN_LOGIN_ATTEMPT_LIMIT = clampNumber(
  readEnv('MAX_ADMIN_LOGIN_ATTEMPTS_PER_WINDOW'),
  10,
  3,
  100,
)

export function allowedCors(): string[] | true {
  return ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true
}

export function sessionTtlMs(): number {
  return TEAM_SESSION_TTL_HOURS * 60 * 60 * 1000
}

export function adminSessionTtlMs(): number {
  return ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000
}

function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}
