import { MAX_POINTS } from '@shared/constants'
import { isNonNegativeInteger } from '@shared/money'
import { isValidHttpUrl, normalizeName } from '@shared/text'
import { parseCsv } from '@/lib/csv'

/**
 * Player CSV import:
 *   name,nationality,role,star,rating,image_url
 *
 * Ratings accept decimal values (e.g. 5.7) and whole numbers (e.g. 10).
 * The whole file is validated up front; invalid rows are reported with their
 * line number and nothing is written until the admin explicitly commits.
 */

export interface PlayerImportRow {
  line: number
  playerId: string | null
  name: string
  nationality: string | null
  role: string | null
  star: string | null
  rating: number | null
  points: number | null
  basePrice: number | null
  photoUrl: string | null
  errors: string[]
  duplicateOfLine: number | null
}

export interface PlayerImportPreview {
  rows: PlayerImportRow[]
  headers: string[]
  missingColumns: string[]
  validCount: number
  invalidCount: number
  duplicateCount: number
  canCommit: boolean
}

export const PLAYER_CSV_TEMPLATE_HEADERS = [
  'name',
  'nationality',
  'role',
  'star',
  'rating',
  'image_url',
] as const

export const PLAYER_CSV_TEMPLATE = [
  PLAYER_CSV_TEMPLATE_HEADERS.join(','),
  'Rohit Sharma,Indian,Batsman,Yes,9.5,https://zskbpnzhxntnupdnlecp.supabase.co/storage/v1/object/public/player-images/P002.png',
  'Jasprit Bumrah,Indian,Bowler,Yes,10,https://zskbpnzhxntnupdnlecp.supabase.co/storage/v1/object/public/player-images/P004.png',
  'Will Jacks,Overseas,All-Rounder,No,8.2,https://zskbpnzhxntnupdnlecp.supabase.co/storage/v1/object/public/player-images/P008.png',
].join('\r\n')

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'player', 'player_name', 'playername', 'player name', 'full name'],
  nationality: ['nationality', 'country', 'nation', 'nat', 'origin'],
  role: ['role', 'player_role', 'playerrole', 'position', 'type', 'skill'],
  star: ['star', 'star_player', 'starplayer', 'is_star', 'starred', 'marquee'],
  rating: ['rating', 'ratings', 'rate', 'points', 'pts', 'point', 'score', 'marks'],
  photoUrl: [
    'image_url',
    'imageurl',
    'image url',
    'image',
    'photo_url',
    'photourl',
    'photo url',
    'photo',
    'picture',
    'picture_url',
    'avatar',
    'img',
    'img_url',
  ],
  playerId: ['player_id', 'playerid', 'player id', 'id', 'external_id', 'externalid', 'code'],
  basePrice: ['base_price', 'baseprice', 'base price', 'price', 'reference price', 'base'],
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalised = headers.map((header) => normalizeName(header).replace(/[\s_-]+/g, ''))
  for (const alias of aliases) {
    const target = alias.replace(/[\s_-]+/g, '')
    const index = normalised.indexOf(target)
    if (index >= 0) return index
  }
  return -1
}

export function toRatingField(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s]/g, '').replace(/^[^\d+-]+/, '')
  if (cleaned === '' || !/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned.replace(/^\+/, ''))
  if (!Number.isFinite(value)) return null
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toIntegerField(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s]/g, '').replace(/^[^\d+-]+/, '')
  // Allow a sign so callers can report dedicated "must not be negative" errors.
  if (cleaned === '' || !/^[+-]?\d+$/.test(cleaned)) return null
  const value = Number(cleaned.replace(/^\+/, ''))
  return Number.isSafeInteger(value) ? value : null
}

export function normalizePhotoUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('./')) {
    return trimmed
  }
  if (!/\s/.test(trimmed) && (trimmed.includes('/') || /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(trimmed))) {
    return `/${trimmed}`
  }
  return trimmed
}

export function buildPlayerImportPreview(text: string): PlayerImportPreview {
  const table = parseCsv(text)
  if (table.length === 0) {
    return {
      rows: [],
      headers: [],
      missingColumns: ['name', 'rating'],
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      canCommit: false,
    }
  }

  const headers = table[0]!.map((header) => header.trim())
  const columns = {
    name: findColumn(headers, HEADER_ALIASES.name!),
    nationality: findColumn(headers, HEADER_ALIASES.nationality!),
    role: findColumn(headers, HEADER_ALIASES.role!),
    star: findColumn(headers, HEADER_ALIASES.star!),
    rating: findColumn(headers, HEADER_ALIASES.rating!),
    photoUrl: findColumn(headers, HEADER_ALIASES.photoUrl!),
    playerId: findColumn(headers, HEADER_ALIASES.playerId!),
    basePrice: findColumn(headers, HEADER_ALIASES.basePrice!),
  }

  const missingColumns: string[] = []
  if (columns.name < 0) missingColumns.push('name')
  if (columns.rating < 0) missingColumns.push('rating')

  const seenIds = new Map<string, number>()
  const seenNames = new Map<string, number>()
  const rows: PlayerImportRow[] = []

  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index]!
    const line = index + 1
    const rawName = columns.name >= 0 ? (cells[columns.name] ?? '').trim() : ''
    const rawNationality = columns.nationality >= 0 ? (cells[columns.nationality] ?? '').trim() : ''
    const rawRole = columns.role >= 0 ? (cells[columns.role] ?? '').trim() : ''
    const rawStar = columns.star >= 0 ? (cells[columns.star] ?? '').trim() : ''
    const rawRating = columns.rating >= 0 ? (cells[columns.rating] ?? '').trim() : ''
    const rawPhoto = columns.photoUrl >= 0 ? (cells[columns.photoUrl] ?? '').trim() : ''
    const rawId = columns.playerId >= 0 ? (cells[columns.playerId] ?? '').trim() : ''
    const rawPrice = columns.basePrice >= 0 ? (cells[columns.basePrice] ?? '').trim() : ''

    const errors: string[] = []
    if (rawName === '') errors.push('Name is required.')

    const rating = rawRating === '' ? null : toRatingField(rawRating)
    if (rating === null) errors.push('Rating must be a valid number (e.g. 5.7 or 10).')
    else if (rating < 0) errors.push('Rating must not be negative.')
    else if (rating > MAX_POINTS) errors.push(`Rating must be at most ${MAX_POINTS}.`)

    let basePrice: number | null = 0
    if (rawPrice !== '') {
      basePrice = toIntegerField(rawPrice)
      if (basePrice === null) errors.push('Base price must be a whole number (0 or more).')
      else if (!isNonNegativeInteger(basePrice)) errors.push('Base price must not be negative.')
    }

    const photoUrl = rawPhoto === '' ? null : normalizePhotoUrl(rawPhoto)
    if (photoUrl !== null && !isValidHttpUrl(photoUrl)) {
      errors.push('Image URL must be a valid http(s) link or file path.')
    }

    let duplicateOfLine: number | null = null
    if (rawId !== '') {
      const key = normalizeName(rawId)
      const existing = seenIds.get(key)
      if (existing !== undefined) {
        duplicateOfLine = existing
        errors.push(`Player ID "${rawId}" is duplicated in this file (line ${existing}).`)
      } else {
        seenIds.set(key, line)
      }
    }
    if (rawName !== '' && duplicateOfLine === null) {
      const key = normalizeName(rawName)
      const existing = seenNames.get(key)
      if (existing !== undefined) {
        duplicateOfLine = existing
        errors.push(`Duplicate name "${rawName}" (line ${existing}) - add a distinct player ID.`)
      } else {
        seenNames.set(key, line)
      }
    }

    rows.push({
      line,
      playerId: rawId === '' ? null : rawId,
      name: rawName,
      nationality: rawNationality === '' ? null : rawNationality,
      role: rawRole === '' ? null : rawRole,
      star: rawStar === '' ? null : rawStar,
      rating,
      points: rating,
      basePrice,
      photoUrl,
      errors,
      duplicateOfLine,
    })
  }

  const validCount = rows.filter((row) => row.errors.length === 0).length
  const invalidCount = rows.length - validCount
  const duplicateCount = rows.filter((row) => row.duplicateOfLine !== null).length

  return {
    rows,
    headers,
    missingColumns,
    validCount,
    invalidCount,
    duplicateCount,
    canCommit: rows.length > 0 && validCount > 0 && missingColumns.length === 0,
  }
}

export interface ImportPayloadRow {
  name: string
  points: number
  basePrice: number
  photoUrl?: string | null
  externalReference: string | null
  nationality?: string | null
  role?: string | null
  star?: string | null
}

export function toImportPayload(
  rows: PlayerImportRow[],
  mode: 'valid-only' | 'all-valid-rows',
): ImportPayloadRow[] {
  return rows
    .filter((row) => row.errors.length === 0 || mode === 'valid-only')
    .filter((row) => row.errors.length === 0 && row.rating !== null)
    .map((row) => ({
      name: row.name,
      points: row.rating as number,
      basePrice: row.basePrice ?? 0,
      photoUrl: row.photoUrl ?? null,
      externalReference: row.playerId,
      nationality: row.nationality,
      role: row.role,
      star: row.star,
    }))
}

export function buildErrorReportCsv(rows: PlayerImportRow[]): Array<Array<string | number>> {
  const header = ['line', 'name', 'nationality', 'role', 'star', 'rating', 'image_url', 'errors']
  return [
    header,
    ...rows
      .filter((row) => row.errors.length > 0)
      .map((row) => [
        row.line,
        row.name,
        row.nationality ?? '',
        row.role ?? '',
        row.star ?? '',
        row.rating ?? '',
        row.photoUrl ?? '',
        row.errors.join(' '),
      ]),
  ]
}
