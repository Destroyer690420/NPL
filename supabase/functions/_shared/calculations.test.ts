// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { computeTeamSummary, projectPurchase } from './calculations'

describe('computeTeamSummary', () => {
  it('sums confirmed purchase prices, points and roster size', () => {
    const summary = computeTeamSummary(100_000, [
      { finalPrice: 12_000, points: 250 },
      { finalPrice: 8_500, points: 120 },
      { finalPrice: 1, points: 0 },
    ])

    expect(summary).toEqual({
      startingPurse: 100_000,
      totalSpent: 20_501,
      remainingPurse: 79_499,
      totalPoints: 370,
      playerCount: 3,
    })
  })

  it('returns an empty roster unchanged', () => {
    expect(computeTeamSummary(500, [])).toEqual({
      startingPurse: 500,
      totalSpent: 0,
      remainingPurse: 500,
      totalPoints: 0,
      playerCount: 0,
    })
  })

  it('stays exact for large integer amounts (no floating point drift)', () => {
    const purchases = Array.from({ length: 100 }, () => ({ finalPrice: 999_999_999, points: 7 }))
    const summary = computeTeamSummary(1_000_000_000, purchases.slice(0, 1))
    expect(summary.remainingPurse).toBe(1)
    expect(summary.totalSpent).toBe(999_999_999)
  })
})

describe('projectPurchase', () => {
  it('projects the post purchase summary', () => {
    const team = {
      startingPurse: 50_000,
      totalSpent: 20_000,
      remainingPurse: 30_000,
      totalPoints: 100,
      playerCount: 2,
    }
    expect(projectPurchase(team, 5_000, 60)).toEqual({
      startingPurse: 50_000,
      totalSpent: 25_000,
      remainingPurse: 25_000,
      totalPoints: 160,
      playerCount: 3,
    })
  })
})
