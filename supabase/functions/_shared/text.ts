import { MAX_NAME_LENGTH, REQUEST_ID_PATTERN } from './constants.ts'

/** Collapses runs of whitespace and trims. */
export function collapseWhitespace(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * Canonical comparison key for names: unicode-normalised, whitespace collapsed
 * and case-insensitive. Used for uniqueness checks and duplicate detection.
 */
export function normalizeName(raw: string): string {
  return collapseWhitespace(String(raw ?? ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function truncate(raw: string, maxLength: number): string {
  return raw.length > maxLength ? raw.slice(0, maxLength) : raw
}

/** Trims + collapses a display name and enforces a maximum length. */
export function cleanDisplayName(raw: unknown, maxLength = MAX_NAME_LENGTH): string {
  if (typeof raw !== 'string') return ''
  return truncate(collapseWhitespace(raw), maxLength)
}

/** Trims an optional free-text field, returning null for blank input. */
export function cleanOptionalText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null
  const value = truncate(raw.trim(), maxLength)
  return value.length > 0 ? value : null
}

/** Trims and lowercases for case-insensitive comparisons of ids/handles. */
export function normalizeReference(raw: unknown): string | null {
  return cleanOptionalText(raw, 120)
}

export function isValidRequestId(raw: unknown): raw is string {
  return typeof raw === 'string' && REQUEST_ID_PATTERN.test(raw)
}

/** Basic http(s) URL check for optional logo/photo links. Also supports web-root paths (/...) and data URLs. */
export function isValidHttpUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const trimmed = raw.trim()
  if (trimmed === '') return false
  if (/javascript:/i.test(trimmed)) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || /^data:image\/[a-zA-Z0-9.+_-]+;base64,/i.test(trimmed)) {
    return true
  }
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isDigits(raw: unknown, length?: number): raw is string {
  if (typeof raw !== 'string') return false
  if (!/^[0-9]+$/.test(raw)) return false
  return length === undefined ? true : raw.length === length
}
