import { formatAmount, formatNumber } from '@shared/money'
import { timestampToMillis } from '@shared/convert'
import type { TimestampValue } from '@shared/types'

/** Timestamp helpers that accept `{seconds,nanoseconds}` values, Dates, millis or null. */

export function toMillis(value: TimestampValue | undefined): number | null {
  return timestampToMillis(value)
}

export function toDate(value: TimestampValue | undefined): Date | null {
  const millis = toMillis(value)
  return millis === null ? null : new Date(millis)
}

export function formatTime(value: TimestampValue | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function formatDateTime(value: TimestampValue | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatDate(value: TimestampValue | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatRelative(value: TimestampValue | undefined, now = Date.now()): string {
  const millis = toMillis(value)
  if (millis === null) return '—'
  const seconds = Math.round((now - millis) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 90) return '1 min ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return formatDateTime(value)
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

export function shortId(value: string | null | undefined, length = 6): string {
  if (!value) return '—'
  return value.length <= length ? value : `${value.slice(0, length)}…`
}

export { formatAmount, formatNumber }

/** "₹1,20,000" / "12,000 credits" using the event currency label. */
export function currency(value: number | null | undefined, label: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return formatAmount(value, label)
}

export function points(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return formatNumber(value)
}
