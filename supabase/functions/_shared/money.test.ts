// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatAmount, parseAmountInput, parseIntegerInput, parsePointsInput } from './money.ts'
import { isValidRequestId, normalizeName, cleanDisplayName, isValidHttpUrl } from './text.ts'
import { MAX_AMOUNT } from './constants.ts'

describe('parseIntegerInput', () => {
  it('parses plain integers', () => {
    expect(parseIntegerInput('1200')).toBe(1200)
    expect(parseIntegerInput(1200)).toBe(1200)
    expect(parseIntegerInput('0')).toBe(0)
  })

  it('accepts thousands separators, spaces and currency symbols', () => {
    expect(parseIntegerInput('1,20,000')).toBe(120000)
    expect(parseIntegerInput('₹ 1,20,000')).toBe(120000)
    expect(parseIntegerInput(' 45 000 ')).toBe(45000)
  })

  it('rejects decimals, negatives, blanks and junk', () => {
    expect(parseIntegerInput('12.5')).toBeNull()
    expect(parseIntegerInput('-100')).toBeNull()
    expect(parseIntegerInput('')).toBeNull()
    expect(parseIntegerInput('abc')).toBeNull()
    expect(parseIntegerInput('12abc')).toBeNull()
    expect(parseIntegerInput(Number.NaN)).toBeNull()
    expect(parseIntegerInput(1.5)).toBeNull()
  })
})

describe('parseAmountInput / parsePointsInput', () => {
  it('requires a positive amount by default', () => {
    expect(parseAmountInput('0')).toBeNull()
    expect(parseAmountInput('0', true)).toBe(0)
    expect(parseAmountInput('1')).toBe(1)
    expect(parseAmountInput(String(MAX_AMOUNT + 1))).toBeNull()
  })

  it('accepts zero points but not negative', () => {
    expect(parsePointsInput('0')).toBe(0)
    expect(parsePointsInput('-5')).toBeNull()
  })
})

describe('formatAmount', () => {
  it('formats large numbers in Indian denominations with ₹ in front', () => {
    expect(formatAmount(1250000000)).toBe('₹125 crores')
    expect(formatAmount(3000000)).toBe('₹30 lakh')
    expect(formatAmount(50000)).toBe('₹50 thousand')
    expect(formatAmount(10000000)).toBe('₹1 crore')
    expect(formatAmount(100000)).toBe('₹1 lakh')
    expect(formatAmount(1000)).toBe('₹1 thousand')
    expect(formatAmount(500)).toBe('₹500')
    expect(formatAmount(0)).toBe('₹0')
    expect(formatAmount(15000000)).toBe('₹1.5 crores')
    expect(formatAmount(12500000)).toBe('₹1.25 crores')
    expect(formatAmount(-3000000)).toBe('-₹30 lakh')
  })

  it('normalizes legacy labels like credits, rupees, or empty to ₹ in front', () => {
    expect(formatAmount(1250000000, 'credits')).toBe('₹125 crores')
    expect(formatAmount(3000000, 'Rupees')).toBe('₹30 lakh')
    expect(formatAmount(0, 'credits')).toBe('₹0')
    expect(formatAmount(1000, '')).toBe('₹1 thousand')
  })
})

describe('normalizeName', () => {
  it('collapses whitespace and case for uniqueness checks', () => {
    expect(normalizeName('  Team   Alpha ')).toBe('team alpha')
    expect(normalizeName('TEAM ALPHA')).toBe('team alpha')
    expect(normalizeName('Team\u00a0Alpha')).toBe('team alpha')
  })
})

describe('cleanDisplayName', () => {
  it('trims and collapses but keeps original casing', () => {
    expect(cleanDisplayName('  Rohit   Sharma  ')).toBe('Rohit Sharma')
    expect(cleanDisplayName(42)).toBe('')
  })
})

describe('isValidRequestId', () => {
  it('accepts uuid style ids and rejects unsafe ones', () => {
    expect(isValidRequestId('8f0c1f9e-1c2b-4a3d-9f4e-1234567890ab')).toBe(true)
    expect(isValidRequestId('short')).toBe(false)
    expect(isValidRequestId('has/slash')).toBe(false)
    expect(isValidRequestId('has space')).toBe(false)
  })
})

describe('isValidHttpUrl', () => {
  it('only accepts http(s)', () => {
    expect(isValidHttpUrl('https://example.com/logo.png')).toBe(true)
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isValidHttpUrl('not a url')).toBe(false)
  })
})
