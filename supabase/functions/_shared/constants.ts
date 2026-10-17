/** Shared constants for domain rules. */

export const PIN_LENGTH = 4
/** PINs are generated in this range so the UI never has to deal with leading zeros. */
export const PIN_MIN = 1000
export const PIN_MAX = 9999

export const MAX_AMOUNT = 1_000_000_000_000
export const MAX_POINTS = 1_000_000
export const MAX_NAME_LENGTH = 80
export const MAX_REASON_LENGTH = 240
export const MAX_NOTES_LENGTH = 500
export const MAX_URL_LENGTH = 2048
export const MAX_ROSTER_SIZE_LIMIT = 200

export const MIN_REASON_LENGTH = 3

export const DEFAULT_CURRENCY_LABEL = '₹'
export const DEFAULT_STARTING_PURSE = 100000
export const DEFAULT_EVENT_NAME = 'College Auction'

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,72}$/

/** Event document id used when the admin creates the very first event. */
export const DEFAULT_EVENT_ID = 'default'

export const ICON_FALLBACK_NAME = '—'
