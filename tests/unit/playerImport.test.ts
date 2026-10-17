import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildErrorReportCsv,
  buildPlayerImportPreview,
  toImportPayload,
} from '@/features/players/playerImport'

const HEADER = 'player_id,name,points,base_price'

describe('buildPlayerImportPreview', () => {
  it('accepts a well formed file and reports counts', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'P001,Rohit Sharma,250,20000', 'P002,"Ishan, Kishan",180,15000'].join('\n'),
    )
    expect(preview.missingColumns).toEqual([])
    expect(preview.validCount).toBe(2)
    expect(preview.invalidCount).toBe(0)
    expect(preview.canCommit).toBe(true)
    expect(preview.rows[0]).toMatchObject({ line: 2, playerId: 'P001', points: 250, basePrice: 20_000 })
  })

  it('tolerates header aliases, currency symbols and thousand separators', () => {
    const preview = buildPlayerImportPreview(
      ['id,player,pts,price', 'X1,"Jasprit Bumrah",₨180,"12,000"'].join('\n'),
    )
    expect(preview.missingColumns).toEqual([])
    expect(preview.rows[0]).toMatchObject({ name: 'Jasprit Bumrah', points: 180, basePrice: 12_000 })
  })

  it('reports missing required columns and blocks commit', () => {
    const preview = buildPlayerImportPreview(['name,points', 'Rohit,250'].join('\n'))
    expect(preview.missingColumns).toEqual(['base_price'])
    expect(preview.canCommit).toBe(false)
  })

  it('flags invalid numbers with the row line number', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'P001,Rohit,abc,20000', 'P002,Ishan,-5,15000'].join('\n'),
    )
    expect(preview.invalidCount).toBe(2)
    expect(preview.rows[0]!.errors[0]).toContain('Points')
    expect(preview.rows[1]!.errors.join(' ')).toContain('negative')
  })

  it('detects duplicate player ids and names within the file', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'P001,Rohit,250,20000', 'P001,Suresh,150,10000', 'P003,Rohit,100,5000'].join('\n'),
    )
    expect(preview.validCount).toBe(1)
    expect(preview.duplicateCount).toBe(2)
    expect(preview.rows[1]!.errors.join(' ')).toContain('duplicated')
    expect(preview.rows[2]!.errors.join(' ')).toContain('Duplicate name')
  })

  it('requires a name on every row', () => {
    const preview = buildPlayerImportPreview([HEADER, 'P001,,250,20000'].join('\n'))
    expect(preview.rows[0]!.errors.join(' ')).toContain('Name is required')
  })

  it('never lets a duplicate name slip through when a distinct id is present', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'P001,Rohit,250,20000', 'P002,rohit,150,10000'].join('\n'),
    )
    expect(preview.invalidCount).toBe(1)
    expect(preview.rows[1]!.errors.join(' ')).toContain('Duplicate name')
  })

  it('parses, normalizes, and validates image_url column', () => {
    const preview = buildPlayerImportPreview(
      [
        'player_id,name,points,base_price,image_url',
        'P001,Rohit Sharma,250,20000,player-images/rohit.jpg',
        'P002,Ishan Kishan,180,15000,https://example.com/ishan.png',
        'P003,Surya,200,18000,javascript:alert(1)',
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
  it('only includes fully valid rows', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'P001,Rohit,250,20000', 'P002,Ishan,abc,15000', 'P003,Jasprit,180,12000'].join('\n'),
    )
    const payload = toImportPayload(preview.rows, 'all-valid-rows')
    expect(payload).toHaveLength(2)
    expect(payload.map((row) => row.externalReference)).toEqual(['P001', 'P003'])
    expect(payload.every((row) => Number.isSafeInteger(row.points))).toBe(true)
  })
})

describe('buildErrorReportCsv', () => {
  it('lists only invalid rows with their line numbers', () => {
    const preview = buildPlayerImportPreview(
      [HEADER, 'P001,Rohit,250,20000', 'P002,Ishan,abc,15000'].join('\n'),
    )
    const report = buildErrorReportCsv(preview.rows)
    expect(report).toHaveLength(2)
    expect(report[0]).toEqual(['line', 'player_id', 'name', 'points', 'base_price', 'image_url', 'errors'])
    expect(report[1]![0]).toBe(3)
    expect(String(report[1]![6])).toContain('Points')
  })
})
