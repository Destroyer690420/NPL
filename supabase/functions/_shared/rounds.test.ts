// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildRoundPool,
  buildRoundSnapshot,
  evaluateTeamQualification,
  findNextUnprocessedIndex,
  isRoundPoolComplete,
  normalizeRole,
  rankQualifiedTeams,
} from './rounds.ts'
import { planPurchase } from './purchases.ts'
import { makeEvent, makePlayer, makeTeam } from './fixtures.ts'
import { ROUND_1_TARGET_TEAMS, ROUND_2_TARGET_TEAMS } from './constants.ts'
import type { PlayerDoc } from './types.ts'

function makeSyntheticPlayers(counts: { BAT: number; BOWL: number; AR: number; WK: number }): PlayerDoc[] {
  const list: PlayerDoc[] = []
  let seq = 1
  const roleNames = {
    BAT: 'Batter',
    BOWL: 'Bowler',
    AR: 'All Rounder',
    WK: 'Wicket Keeper',
  } as const

  for (const roleKey of ['BAT', 'BOWL', 'AR', 'WK'] as const) {
    const count = counts[roleKey]
    for (let i = 0; i < count; i += 1) {
      const rating = Math.round((10 - (i / Math.max(1, count)) * 6) * 100) / 100
      list.push(
        makePlayer(`p-${roleKey}-${i + 1}`, {
          name: `${roleKey} Player ${i + 1}`,
          role: roleNames[roleKey],
          points: rating,
          rating,
          sortOrder: seq++,
        }),
      )
    }
  }
  return list
}

describe('normalizeRole', () => {
  it('normalizes CSV role values and shorthand codes', () => {
    expect(normalizeRole('Batter')).toBe('BAT')
    expect(normalizeRole('Batsman')).toBe('BAT')
    expect(normalizeRole('BAT')).toBe('BAT')
    expect(normalizeRole('Bowler')).toBe('BOWL')
    expect(normalizeRole('BOWL')).toBe('BOWL')
    expect(normalizeRole('All Rounder')).toBe('AR')
    expect(normalizeRole('All-Rounder')).toBe('AR')
    expect(normalizeRole('AR')).toBe('AR')
    expect(normalizeRole('Wicket Keeper')).toBe('WK')
    expect(normalizeRole('Wicket-Keeper')).toBe('WK')
    expect(normalizeRole('WK')).toBe('WK')
    expect(normalizeRole('')).toBeNull()
    expect(normalizeRole(null)).toBeNull()
  })
})

describe('buildRoundPool', () => {
  it('guarantees role minimums, fills flex slots by rating desc, excludes overflow, and orders BAT -> BOWL -> AR -> WK', () => {
    const master = makeSyntheticPlayers({ BAT: 60, BOWL: 80, AR: 50, WK: 30 })
    const snapshotBefore = JSON.stringify(master)

    const r1 = buildRoundPool(master, ROUND_1_TARGET_TEAMS)

    // Master list is never mutated
    expect(JSON.stringify(master)).toBe(snapshotBefore)
    expect(master).toHaveLength(220)

    // Exact target size = 17 * 11 = 187
    expect(r1).toHaveLength(187)

    const batCount = r1.filter((p) => normalizeRole(p.role) === 'BAT').length
    const bowlCount = r1.filter((p) => normalizeRole(p.role) === 'BOWL').length
    const arCount = r1.filter((p) => normalizeRole(p.role) === 'AR').length
    const wkCount = r1.filter((p) => normalizeRole(p.role) === 'WK').length

    expect(batCount).toBeGreaterThanOrEqual(51)
    expect(bowlCount).toBeGreaterThanOrEqual(51)
    expect(arCount).toBeGreaterThanOrEqual(17)
    expect(wkCount).toBeGreaterThanOrEqual(17)

    // Strict serial role order BAT -> BOWL -> AR -> WK and rating desc within each group
    const roleOrder = r1.map((p) => ['BAT', 'BOWL', 'AR', 'WK'].indexOf(normalizeRole(p.role)!))
    for (let i = 1; i < roleOrder.length; i += 1) {
      expect(roleOrder[i]).toBeGreaterThanOrEqual(roleOrder[i - 1]!)
      if (roleOrder[i] === roleOrder[i - 1]) {
        expect((r1[i]!.rating ?? 0)).toBeLessThanOrEqual(r1[i - 1]!.rating ?? 0)
      }
    }

    // Round 2 pool on the exact same intact master list produces 132 players
    const r2 = buildRoundPool(master, ROUND_2_TARGET_TEAMS)
    expect(r2).toHaveLength(132)
    expect(r2.filter((p) => normalizeRole(p.role) === 'BAT').length).toBeGreaterThanOrEqual(36)
    expect(r2.filter((p) => normalizeRole(p.role) === 'BOWL').length).toBeGreaterThanOrEqual(36)
    expect(r2.filter((p) => normalizeRole(p.role) === 'AR').length).toBeGreaterThanOrEqual(12)
    expect(r2.filter((p) => normalizeRole(p.role) === 'WK').length).toBeGreaterThanOrEqual(12)
  })

  it('works cleanly with the actual players_export.csv (214 players) for Round 1 (187) and Round 2 (132)', () => {
    const csvPath = path.resolve(process.cwd(), 'players_export.csv')
    const lines = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1)
    const masterPlayers = lines.map((line, index) => {
      const cols = line.split(',')
      const rating = Number(cols[4] ?? '0')
      return makePlayer(`csv-${index + 1}`, {
        name: cols[0] ?? `Player ${index + 1}`,
        role: cols[2] ?? null,
        rating,
        points: rating,
        sortOrder: index + 1,
      })
    })

    expect(masterPlayers).toHaveLength(214)

    const r1 = buildRoundPool(masterPlayers, 17)
    expect(r1).toHaveLength(187)
    expect(masterPlayers).toHaveLength(214)

    const r2 = buildRoundPool(masterPlayers, 12)
    expect(r2).toHaveLength(132)
    expect(r2.filter((p) => normalizeRole(p.role) === 'BAT').length).toBeGreaterThanOrEqual(36)
    expect(r2.filter((p) => normalizeRole(p.role) === 'BOWL').length).toBeGreaterThanOrEqual(36)
    expect(r2.filter((p) => normalizeRole(p.role) === 'AR').length).toBeGreaterThanOrEqual(12)
    expect(r2.filter((p) => normalizeRole(p.role) === 'WK').length).toBeGreaterThanOrEqual(12)
  })
})

describe('evaluateTeamQualification', () => {
  it('qualifies a team meeting all 11-player and role minimums', () => {
    const team = makeTeam('t1', { name: 'Super Kings' })
    const squad = [
      ...Array.from({ length: 4 }, (_, i) => makePlayer(`bat-${i}`, { role: 'Batter', points: 8 })),
      ...Array.from({ length: 4 }, (_, i) => makePlayer(`bowl-${i}`, { role: 'Bowler', points: 8 })),
      makePlayer('ar-1', { role: 'All Rounder', points: 9 }),
      makePlayer('ar-2', { role: 'All Rounder', points: 7 }),
      makePlayer('wk-1', { role: 'Wicket Keeper', points: 9 }),
    ]

    const res = evaluateTeamQualification(team, squad)
    expect(res.qualified).toBe(true)
    expect(res.missingSummary).toBe('')
    expect(res.playerCount).toBe(11)
    expect(res.totalPoints).toBe(89)
  })

  it('tracks exact missing criteria when a team fails qualification', () => {
    const team = makeTeam('t2', { name: 'Challengers' })
    const squad = [
      ...Array.from({ length: 4 }, (_, i) => makePlayer(`bat-${i}`, { role: 'Batter', points: 8 })),
      ...Array.from({ length: 3 }, (_, i) => makePlayer(`bowl-${i}`, { role: 'Bowler', points: 8 })),
      makePlayer('ar-1', { role: 'All Rounder', points: 8 }),
      makePlayer('ar-2', { role: 'All Rounder', points: 7 }),
    ]

    const res = evaluateTeamQualification(team, squad)
    expect(res.qualified).toBe(false)
    expect(res.missingPlayers).toBe(2)
    expect(res.missingWk).toBe(1)
    expect(res.missingSummary).toBe('Needs 2 more players, 1 WK')
  })
})

describe('Round 2 ranking and Round 2 lockout', () => {
  it('ranks qualified teams by totalPoints desc with remainingPurse tie-breaker and separates disqualified teams', () => {
    const t1 = makeTeam('t1', { name: 'Alpha', remainingPurse: 100_000_000 })
    const t2 = makeTeam('t2', { name: 'Beta', remainingPurse: 250_000_000 })
    const t3 = makeTeam('t3', { name: 'Gamma', remainingPurse: 500_000_000 })

    const makeQualifiedSquad = (prefix: string, ptsEach: number) => [
      ...Array.from({ length: 4 }, (_, i) =>
        makePlayer(`${prefix}-b-${i}`, { role: 'Batter', points: ptsEach, rating: ptsEach, status: 'sold', soldToTeamId: prefix }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makePlayer(`${prefix}-w-${i}`, { role: 'Bowler', points: ptsEach, rating: ptsEach, status: 'sold', soldToTeamId: prefix }),
      ),
      makePlayer(`${prefix}-ar`, { role: 'All Rounder', points: ptsEach, rating: ptsEach, status: 'sold', soldToTeamId: prefix }),
      makePlayer(`${prefix}-ar2`, { role: 'All Rounder', points: ptsEach, rating: ptsEach, status: 'sold', soldToTeamId: prefix }),
      makePlayer(`${prefix}-wk`, { role: 'Wicket Keeper', points: ptsEach, rating: ptsEach, status: 'sold', soldToTeamId: prefix }),
    ]

    const players: PlayerDoc[] = [
      ...makeQualifiedSquad('t1', 8), // 88 pts, 100M purse
      ...makeQualifiedSquad('t2', 8), // 88 pts, 250M purse (wins tie-breaker)
      makePlayer('t3-only', { role: 'Batter', points: 10, rating: 10, status: 'sold', soldToTeamId: 't3' }), // disqualified
    ]

    const snapshot = buildRoundSnapshot({
      round: 2,
      teams: [t1, t2, t3],
      players,
      poolSize: 132,
    })

    const ranked = rankQualifiedTeams(snapshot.results)
    expect(ranked.map((r) => r.teamId)).toEqual(['t2', 't1'])
    expect(snapshot.eliminatedTeamIds).toEqual(['t3'])
  })

  it('blocks eliminated teams and out-of-pool players in planPurchase during Round 2', () => {
    const event = makeEvent({
      status: 'active',
      currentRound: 2,
      roundPhase: 'round2_active',
      roundPoolPlayerIds: ['p1'],
      eliminatedTeamIds: ['t-elim'],
    })

    const blockedTeamResult = planPurchase(
      {
        eventId: 'default',
        playerId: 'p1',
        teamId: 't-elim',
        finalPrice: 10_000,
        requestId: 'req_12345678-elim',
        actorUid: 'admin-1',
      },
      {
        event,
        player: makePlayer('p1'),
        team: makeTeam('t-elim', { startingPurse: 100_000 }),
        existingPurchaseForRequest: null,
        auditLogId: 'a1',
      },
    )
    expect(blockedTeamResult.ok).toBe(false)

    const outOfPoolResult = planPurchase(
      {
        eventId: 'default',
        playerId: 'p-overflow',
        teamId: 't-qual',
        finalPrice: 10_000,
        requestId: 'req_12345678-over',
        actorUid: 'admin-1',
      },
      {
        event,
        player: makePlayer('p-overflow'),
        team: makeTeam('t-qual', { startingPurse: 100_000 }),
        existingPurchaseForRequest: null,
        auditLogId: 'a2',
      },
    )
    expect(outOfPoolResult.ok).toBe(false)
  })
})

describe('queue helpers', () => {
  it('finds next unprocessed index and detects completion', () => {
    const p1 = makePlayer('p1', { status: 'sold' })
    const p2 = makePlayer('p2', { status: 'available' })
    const p3 = makePlayer('p3', { status: 'available' })
    const map = new Map([
      ['p1', p1],
      ['p2', p2],
      ['p3', p3],
    ])
    const pool = ['p1', 'p2', 'p3']

    expect(findNextUnprocessedIndex(pool, map, new Set(['p2']), 0)).toBe(2)
    expect(isRoundPoolComplete(pool, map, new Set(['p2']))).toBe(false)
    expect(isRoundPoolComplete(pool, map, new Set(['p2', 'p3']))).toBe(true)
  })
})
