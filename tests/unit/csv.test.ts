import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from '@/lib/csv'

describe('parseCsv', () => {
  it('parses plain rows with CRLF and a trailing newline', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('handles quoted fields, embedded commas, quotes and newlines', () => {
    const text = 'name,note\r\n"Sharma, Rohit","He said ""hi""\r\nthen left"'
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Sharma, Rohit', 'He said "hi"\r\nthen left'],
    ])
  })

  it('strips a BOM and ignores blank rows', () => {
    expect(parseCsv('\uFEFFa,b\n\n  ,  \nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,b,\nc,d,e')).toEqual([
      ['a', 'b', ''],
      ['c', 'd', 'e'],
    ])
  })
})

describe('toCsv', () => {
  it('quotes fields containing commas, quotes and newlines', () => {
    expect(toCsv([['a', 'b,c'], ['d"e', 'f\ng']])).toBe('a,"b,c"\r\n"d""e","f\ng"')
  })

  it('renders null and undefined as empty', () => {
    expect(toCsv([[null, undefined, 0]])).toBe(',,0')
  })

  it('round-trips through parseCsv', () => {
    const rows = [
      ['player_id', 'name', 'points', 'base_price'],
      ['P001', 'Rohit, "the opener"', '250', '20000'],
      ['P002', 'Line\nbreak', '100', '5000'],
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})
