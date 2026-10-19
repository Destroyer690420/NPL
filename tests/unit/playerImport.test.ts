import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildErrorReportCsv,
  buildPlayerImportPreview,
  toImportPayload,
} from '@/features/players/playerImport'

const HEADER = 'name,nationality,role,star,rating,image_url'

describe('buildPlayerImportPreview', () => {
  it('accepts a well formed file with name, nationality, role, star, rating, image_url and reports counts', () => {
    const preview = buildPlayerImportPreview(
      [
        HEADER,
        'Rohit Sharma,India,Batsman,Yes,9.5,https://example.com/rohit.jpg',
        'Jasprit Bumrah,India,Bowler,No,9.8,/player-images/bumrah.jpg',
        'Travis Head,Australia,All-rounder,,8.5,',
      ].join('\n'),
    )
    expect(preview.missingColumns).toEqual([])
    expect(preview.validCount).toBe(3)
    expect(preview.invalidCount).toBe(0)
    expect(preview.canCommit).toBe(true)
    expect(preview.rows[0]).toMatchObject({
      line: 2,
      name: 'Rohit Sharma',
      nationality: 'India',
      role: 'Batsman',
      star: 'Yes',
      points: 9.5,
      basePrice: 0,
    })
    expect(preview.rows[2]).toMatchObject({
      name: 'Travis Head',
      nationality: 'Australia',
      role: 'All-rounder',
      points: 8.5,
    })
  })

  it('supports decimal ratings (e.g. 5.7) and whole numbers (e.g. 10)', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'Player One,India,Batter,,5.7,', 'Player Two,India,Bowler,,10,'].join('\n'),
    )
    expect(preview.validCount).toBe(2)
    expect(preview.rows[0]!.points).toBe(5.7)
    expect(preview.rows[1]!.points).toBe(10)
  })

  it('tolerates legacy header aliases, currency symbols and thousand separators', () => {
    const preview = buildPlayerImportPreview(
      ['id,player,pts,price', 'X1,"Jasprit Bumrah",₨180,"12,000"'].join('\n'),
    )
    expect(preview.missingColumns).toEqual([])
    expect(preview.rows[0]).toMatchObject({ name: 'Jasprit Bumrah', points: 180, basePrice: 12_000 })
  })

  it('reports missing required columns and blocks commit', () => {
    const preview = buildPlayerImportPreview(['role,star', 'Batter,Yes'].join('\n'))
    expect(preview.missingColumns).toEqual(['name', 'rating'])
    expect(preview.canCommit).toBe(false)
  })

  it('flags invalid numbers with the row line number', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'Rohit,India,Batter,,abc,', 'Ishan,India,Keeper,,-5,'].join('\n'),
    )
    expect(preview.invalidCount).toBe(2)
    expect(preview.rows[0]!.errors[0]).toContain('Rating')
    expect(preview.rows[1]!.errors.join(' ')).toContain('negative')
  })

  it('detects duplicate names within the file', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'Rohit,India,Batter,,8,', 'Suresh,India,Batter,,7,', 'Rohit,India,Batter,,9,'].join('\n'),
    )
    expect(preview.validCount).toBe(2)
    expect(preview.duplicateCount).toBe(1)
    expect(preview.rows[2]!.errors.join(' ')).toContain('Duplicate name')
  })

  it('requires a name on every row', () => {
    const preview = buildPlayerImportPreview([HEADER, ',India,Batter,,8,'].join('\n'))
    expect(preview.rows[0]!.errors.join(' ')).toContain('Name is required')
  })

  it('never lets a duplicate name slip through when distinct case is present', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'Rohit,India,Batter,,8,', 'rohit,India,Batter,,7,'].join('\n'),
    )
    expect(preview.invalidCount).toBe(1)
    expect(preview.rows[1]!.errors.join(' ')).toContain('Duplicate name')
  })

  it('parses, normalizes, and validates image_url column', () => {
    const preview = buildPlayerImportPreview(
      [
        HEADER,
        'Rohit Sharma,India,Batter,,8.5,player-images/rohit.jpg',
        'Ishan Kishan,India,Keeper,,7.5,https://example.com/ishan.png',
        'Surya,India,Batter,,9.0,javascript:alert(1)',
      ].join('\n'),
    )
    expect(preview.validCount).toBe(2)
    expect(preview.invalidCount).toBe(1)
    expect(preview.rows[0]!.photoUrl).toBe('/player-images/rohit.jpg')
    expect(preview.rows[1]!.photoUrl).toBe('https://example.com/ishan.png')
    expect(preview.rows[2]!.errors.join(' ')).toContain('Image URL must be a valid')

    const payload = toImportPayload(preview.rows, 'all-valid-rows')
    expect(payload).toHaveLength(2)
    expect(payload[0]!.photoUrl).toBe('/player-images/rohit.jpg')
    expect(payload[1]!.photoUrl).toBe('https://example.com/ishan.png')
    expect(payload[0]!.nationality).toBe('India')
    expect(payload[0]!.role).toBe('Batter')
    expect(payload[0]!.points).toBe(8.5)
  })

  it('successfully validates workspace players.csv', () => {
    const csvPath = path.resolve(__dirname, '../../players.csv')
    if (fs.existsSync(csvPath)) {
      const content = fs.readFileSync(csvPath, 'utf8')
      const preview = buildPlayerImportPreview(content)
      expect(preview.missingColumns).toEqual([])
      expect(preview.validCount).toBeGreaterThan(200)
      expect(preview.invalidCount).toBe(0)
      expect(preview.canCommit).toBe(true)
      // Check that Rohit Sharma and Naman Dhir have their photoUrls parsed
      const rohit = preview.rows.find((r) => r.name.toLowerCase().includes('rohit sharma'))
      expect(rohit?.photoUrl).toMatch(/(P002\.png|\/6\.png)/)
      const naman = preview.rows.find((r) => r.name.toLowerCase().includes('naman dhir'))
      expect(naman?.photoUrl).toMatch(/(P007\.png|\/3107\.png)/)
    }
  })
})

describe('toImportPayload', () => {
  it('only includes fully valid rows and keeps decimal ratings', () => {
    const preview = buildPlayerImportPreview(
      [
        HEADER,
        'Rohit,India,Batter,Yes,8.5,',
        'Ishan,India,Keeper,,abc,',
        'Jasprit,India,Bowler,Yes,9.8,',
      ].join('\n'),
    )
    const payload = toImportPayload(preview.rows, 'all-valid-rows')
    expect(payload).toHaveLength(2)
    expect(payload.map((row) => row.name)).toEqual(['Rohit', 'Jasprit'])
    expect(payload[0]!.points).toBe(8.5)
    expect(payload[1]!.points).toBe(9.8)
    expect(payload[0]!.sortOrder).toBe(0)
    expect(payload[1]!.sortOrder).toBe(1)
    expect(payload[0]!.nationality).toBe('India')
    expect(payload[0]!.role).toBe('Batter')
    expect(payload[0]!.star).toBe('Yes')
  })
})

describe('buildErrorReportCsv', () => {
  it('lists only invalid rows with their line numbers and updated columns', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'Rohit,India,Batter,,8.5,', 'Ishan,India,Keeper,,abc,'].join('\n'),
    )
    const report = buildErrorReportCsv(preview.rows)
    expect(report).toHaveLength(2)
    expect(report[0]).toEqual(['line', 'name', 'nationality', 'role', 'star', 'rating', 'image_url', 'errors'])
    expect(report[1]![0]).toBe(3)
    expect(String(report[1]![7])).toContain('Rating')
  })
})

describe('getPlayerSortOrder', () => {
  it('prefers explicit numeric sortOrder when present', async () => {
    const { getPlayerSortOrder } = await import('@shared/convert')
    expect(getPlayerSortOrder({ sortOrder: 5, externalReference: 'P010' })).toBe(5)
    expect(getPlayerSortOrder({ sortOrder: 0 })).toBe(0)
  })

  it('parses player ID index when sortOrder is null or missing', async () => {
    const { getPlayerSortOrder } = await import('@shared/convert')
    expect(getPlayerSortOrder({ externalReference: 'P001' })).toBe(1)
    expect(getPlayerSortOrder({ externalReference: 'P025' })).toBe(25)
    expect(getPlayerSortOrder({ externalReference: '12' })).toBe(12)
    expect(getPlayerSortOrder({ externalReference: 'custom-name' })).toBe(999999)
    expect(getPlayerSortOrder({})).toBe(999999)
  })
})

