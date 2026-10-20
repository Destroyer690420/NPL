import { describe, expect, it } from 'vitest'
import { isOverseas, isStar } from '@/lib/playerBadges'

describe('playerBadges utilities', () => {
  describe('isOverseas', () => {
    it('identifies explicit Overseas and Foreign labels', () => {
      expect(isOverseas('Overseas')).toBe(true)
      expect(isOverseas('overseas')).toBe(true)
      expect(isOverseas('FOREIGN')).toBe(true)
      expect(isOverseas('os')).toBe(true)
    })

    it('identifies overseas country names', () => {
      expect(isOverseas('Australia')).toBe(true)
      expect(isOverseas('South Africa')).toBe(true)
      expect(isOverseas('West Indies')).toBe(true)
      expect(isOverseas('England')).toBe(true)
      expect(isOverseas('New Zealand')).toBe(true)
      expect(isOverseas('Afghanistan')).toBe(true)
    })

    it('returns false for Indian variants and domestic players', () => {
      expect(isOverseas('Indian')).toBe(false)
      expect(isOverseas('India')).toBe(false)
      expect(isOverseas('IND')).toBe(false)
      expect(isOverseas('Domestic')).toBe(false)
      expect(isOverseas('Local')).toBe(false)
      expect(isOverseas('Home')).toBe(false)
    })

    it('returns false for null, undefined, or empty values', () => {
      expect(isOverseas(null)).toBe(false)
      expect(isOverseas(undefined)).toBe(false)
      expect(isOverseas('')).toBe(false)
      expect(isOverseas('   ')).toBe(false)
    })
  })

  describe('isStar', () => {
    it('returns true for truthy star designations', () => {
      expect(isStar('Yes')).toBe(true)
      expect(isStar('yes')).toBe(true)
      expect(isStar('Y')).toBe(true)
      expect(isStar('true')).toBe(true)
      expect(isStar(true)).toBe(true)
      expect(isStar('1')).toBe(true)
      expect(isStar('Star')).toBe(true)
      expect(isStar('Marquee')).toBe(true)
      expect(isStar('★')).toBe(true)
    })

    it('returns false for falsy or negative star designations', () => {
      expect(isStar('No')).toBe(false)
      expect(isStar('no')).toBe(false)
      expect(isStar('false')).toBe(false)
      expect(isStar(false)).toBe(false)
      expect(isStar('0')).toBe(false)
      expect(isStar('none')).toBe(false)
      expect(isStar('-')).toBe(false)
      expect(isStar(null)).toBe(false)
      expect(isStar(undefined)).toBe(false)
      expect(isStar('')).toBe(false)
      expect(isStar('   ')).toBe(false)
    })
  })
})
