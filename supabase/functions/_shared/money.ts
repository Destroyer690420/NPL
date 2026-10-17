import { MAX_AMOUNT, MAX_POINTS } from './constants.ts'

/**
 * Money and points are always integers in the event's smallest currency unit.
 * No floating point arithmetic is ever used for purses, prices or points.
 */

export function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

export function isNonNegativeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0
}

export function isPositiveInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0
}

export function isValidAmount(value: unknown, allowZero = false): value is number {
  return isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= MAX_AMOUNT
}

export function isValidPoints(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0 && value <= MAX_POINTS
}

/**
 * Strictly parses user input into a whole number.
 * Accepts thousands separators, surrounding currency symbols and spaces.
 * Rejects decimals, negatives and out-of-range values (returns null).
 */
export function parseIntegerInput(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) ? raw : null
  }
  if (typeof raw !== 'string') return null

  const cleaned = raw
    .trim()
    .replace(/[,\s\u00a0\u202f]/g, '')
    // strip a leading currency symbol (₹, $, €, £) or currency word
    .replace(/^[^\d+-]+/, '')

  if (cleaned === '' || !/^\+?\d+$/.test(cleaned)) return null

  const value = Number(cleaned.replace(/^\+/, ''))
  if (!Number.isSafeInteger(value)) return null
  return value
}

export function parseAmountInput(raw: unknown, allowZero = false): number | null {
  const value = parseIntegerInput(raw)
  if (value === null) return null
  return isValidAmount(value, allowZero) ? value : null
}

export function parsePointsInput(raw: unknown): number | null {
  const value = parseIntegerInput(raw)
  if (value === null) return null
  return isValidPoints(value) ? value : null
}

export function formatNumber(value: number, locale = 'en-IN'): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

/** Formats an amount with ₹ in front and Indian units (crores, lakh, thousand). */
export function formatAmount(value: number, currencyLabel = '₹'): string {
  if (!Number.isFinite(value)) return '—'

  const isNegative = value < 0
  const abs = Math.abs(value)

  let symbol = '₹'
  const label = (currencyLabel ?? '').trim()
  const lower = label.toLowerCase()
  if (
    lower !== 'credits' &&
    lower !== 'credit' &&
    lower !== 'rupees' &&
    lower !== 'rupee' &&
    lower !== 'inr' &&
    label !== ''
  ) {
    symbol = label
  }

  const CRORE = 10_000_000
  const LAKH = 100_000
  const THOUSAND = 1_000

  let formattedNum = ''
  if (abs >= CRORE) {
    const val = abs / CRORE
    const rounded = Math.round((val + Number.EPSILON) * 100) / 100
    const numStr = rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    const unit = rounded === 1 ? 'crore' : 'crores'
    formattedNum = `${numStr} ${unit}`
  } else if (abs >= LAKH) {
    const val = abs / LAKH
    const rounded = Math.round((val + Number.EPSILON) * 100) / 100
    const numStr = rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    formattedNum = `${numStr} lakh`
  } else if (abs >= THOUSAND) {
    const val = abs / THOUSAND
    const rounded = Math.round((val + Number.EPSILON) * 100) / 100
    const numStr = rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    formattedNum = `${numStr} thousand`
  } else {
    formattedNum = abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  }

  const symbolLike = /^[^\p{L}\p{N}]/u.test(symbol)
  const result = symbolLike ? `${symbol}${formattedNum}` : `${symbol} ${formattedNum}`
  return isNegative ? `-${result}` : result
}

/** Adds two safe integers, throwing on overflow (defensive; never expected). */
export function addInts(a: number, b: number): number {
  const result = a + b
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('integer overflow')
  }
  return result
}

export function subtractInts(a: number, b: number): number {
  const result = a - b
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('integer overflow')
  }
  return result
}
