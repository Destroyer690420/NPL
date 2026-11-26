import { isStarPlayerFlag } from '@shared/money'

/**
 * Utilities for player attributes such as Overseas and Star status.
 */

/**
 * Determines if a player is considered an Overseas player.
 * In tournament auctions (e.g. IPL / NPL), all non-Indian players
 * or players explicitly tagged as 'Overseas' / 'Foreign' are overseas.
 */
export function isOverseas(nationality: string | null | undefined): boolean {
  if (!nationality) return false
  const clean = nationality.trim().toLowerCase()
  if (!clean) return false
  if (['indian', 'india', 'ind', 'domestic', 'local', 'home'].includes(clean)) {
    return false
  }
  return true
}

/**
 * Determines if a player is designated as a Star player.
 * Checks for truthy values such as 'yes', 'true', '1', 'star', 'marquee', etc.
 */
export function isStar(star: string | boolean | null | undefined): boolean {
  return isStarPlayerFlag(star)
}
