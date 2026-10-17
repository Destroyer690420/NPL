import { MAX_POINTS } from '@shared/constants'
import { isNonNegativeInteger } from '@shared/money'
import { isValidHttpUrl, normalizeName } from '@shared/text'
import { parseCsv } from '@/lib/csv'

/**
 * Player CSV import:
 *   player_id,name,points,base_price,image_url
 *
 * The whole file is validated up front; invalid rows are reported with their
 * line number and nothing is written until the admin explicitly commits.
 */

export interface PlayerImportRow {
  line: number
  playerId: string | null
  name: string
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

export const PLAYER_CSV_TEMPLATE_HEADERS = ['player_id', 'name', 'points', 'base_price', 'image_url'] as const

export const PLAYER_CSV_TEMPLATE = [
  PLAYER_CSV_TEMPLATE_HEADERS.join(','),
  'P001,Rohit Sharma,250,20000,/player-images/rohit.jpg',
  'P002,Ishan Kishan,180,15000,/player-images/ishan.jpg',
].join('\r\n')

const HEADER_ALIASES: Record<string, string[]> = {
  playerId: ['player_id', 'playerid', 'player id', 'id', 'external_id', 'externalid', 'code'],
  name: ['name', 'player', 'player_name', 'playername', 'player name', 'full name'],
  points: ['points', 'pts', 'point', 'score', 'marks'],
  basePrice: ['base_price', 'baseprice', 'base price', 'price', 'reference price', 'base'],
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
      missingColumns: ['name', 'points', 'base_price'],
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      canCommit: false,
    }
  }

  const headers = table[0]!.map((header) => header.trim())
  const columns = {
    playerId: findColumn(headers, HEADER_ALIASES.playerId!),
    name: findColumn(headers, HEADER_ALIASES.name!),
    points: findColumn(headers, HEADER_ALIASES.points!),
    basePrice: findColumn(headers, HEADER_ALIASES.basePrice!),
    photoUrl: findColumn(headers, HEADER_ALIASES.photoUrl!),
  }

  const missingColumns: string[] = []
  if (columns.name < 0) missingColumns.push('name')
  if (columns.points < 0) missingColumns.push('points')
  if (columns.basePrice < 0) missingColumns.push('base_price')

  const seenIds = new Map<string, number>()
  const seenNames = new Map<string, number>()
  const rows: PlayerImportRow[] = []

  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index]!
    const line = index + 1
    const rawName = columns.name >= 0 ? (cells[columns.name] ?? '').trim() : ''
    const rawId = columns.playerId >= 0 ? (cells[columns.playerId] ?? '').trim() : ''
    const rawPoints = columns.points >= 0 ? (cells[columns.points] ?? '').trim() : ''
    const rawPrice = columns.basePrice >= 0 ? (cells[columns.basePrice] ?? '').trim() : ''
    const rawPhoto = columns.photoUrl >= 0 ? (cells[columns.photoUrl] ?? '').trim() : ''

    const errors: string[] = []
    if (rawName === '') errors.push('Name is required.')

    const points = rawPoints === '' ? null : toIntegerField(rawPoints)
    if (points === null) errors.push('Points must be a whole number (0 or more).')
    else if (points < 0) errors.push('Points must not be negative.')
    else if (points > MAX_POINTS) errors.push(`Points must be at most ${MAX_POINTS}.`)

    const basePrice = rawPrice === '' ? null : toIntegerField(rawPrice)
    if (basePrice === null) errors.push('Base price must be a whole number (0 or more).')
    else if (!isNonNegativeInteger(basePrice)) errors.push('Base price must not be negative.')

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
      points,
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
}

export function toImportPayload(
  rows: PlayerImportRow[],
  mode: 'valid-only' | 'all-valid-rows',
): ImportPayloadRow[] {
  return rows
    .filter((row) => row.errors.length === 0 || mode === 'valid-only')
    .filter((row) => row.errors.length === 0 && row.points !== null && row.basePrice !== null)
    .map((row) => ({
      name: row.name,
      points: row.points as number,
      basePrice: row.basePrice as number,
      photoUrl: row.photoUrl ?? null,
      externalReference: row.playerId,
    }))
}

export function buildErrorReportCsv(rows: PlayerImportRow[]): Array<Array<string | number>> {
  const header = ['line', 'player_id', 'name', 'points', 'base_price', 'image_url', 'errors']
  return [
    header,
    ...rows
      .filter((row) => row.errors.length > 0)
      .map((row) => [
        row.line,
        row.playerId ?? '',
        row.name,
        row.points ?? '',
        row.basePrice ?? '',
        row.photoUrl ?? '',
        row.errors.join(' '),
      ]),
  ]
}
