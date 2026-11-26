import { addPoints } from './money.ts'
import type { PlayerDoc, RoundSnapshot, TeamDoc, TeamQualificationResult } from './types.ts'

export type AuctionRole = 'BAT' | 'BOWL' | 'AR' | 'WK'

export const ROLE_SEQUENCE: readonly AuctionRole[] = ['BAT', 'BOWL', 'AR', 'WK'] as const

export const ROLE_LABELS: Record<AuctionRole, string> = {
  BAT: 'Batsmen',
  BOWL: 'Bowlers',
  AR: 'All-Rounders',
  WK: 'Wicket-Keepers',
}

export const QUALIFICATION_RULES = {
  minPlayers: 11,
  minBat: 3,
  minBowl: 3,
  minAr: 1,
  minWk: 1,
} as const

export interface PoolCandidatePlayer {
  id: string
  name: string
  role?: string | null
  rating?: number | null
  points?: number
  sortOrder?: number | null
  externalReference?: string | null
}

/**
 * Normalizes CSV / database role strings (e.g. "Batter", "Batsman", "BAT",
 * "Wicket Keeper", "WK", "All Rounder", "All-Rounder", "AR", "Bowler", "BOWL")
 * into one of the four canonical role codes.
 */
export function normalizeRole(raw: string | null | undefined): AuctionRole | null {
  if (!raw) return null
  const compact = raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (!compact) return null

  if (
    compact === 'bat' ||
    compact === 'batter' ||
    compact === 'batters' ||
    compact === 'batsman' ||
    compact === 'batsmen'
  ) {
    return 'BAT'
  }
  if (compact === 'bowl' || compact === 'bowler' || compact === 'bowlers') {
    return 'BOWL'
  }
  if (compact === 'ar' || compact === 'allrounder' || compact === 'allrounders') {
    return 'AR'
  }
  if (
    compact === 'wk' ||
    compact === 'wicketkeeper' ||
    compact === 'wicketkeepers' ||
    compact === 'keeper' ||
    compact === 'keepers' ||
    compact === 'wkbat' ||
    compact === 'wicketkeeperbatsman'
  ) {
    return 'WK'
  }

  // Fallback substring matching for descriptive role strings
  if (compact.includes('wicketkeep') || compact.includes('keeper') || compact === 'wk') return 'WK'
  if (compact.includes('allround')) return 'AR'
  if (compact.includes('bowl')) return 'BOWL'
  if (compact.includes('bat')) return 'BAT'

  return null
}

/** Resolves a player's numeric rating (falling back to `points` if `rating` is absent). */
export function getPlayerRating(player: Pick<PoolCandidatePlayer, 'rating' | 'points'>): number {
  if (typeof player.rating === 'number' && Number.isFinite(player.rating)) {
    return player.rating
  }
  if (typeof player.points === 'number' && Number.isFinite(player.points)) {
    return player.points
  }
  return 0
}

function getFallbackOrder(player: Pick<PoolCandidatePlayer, 'sortOrder' | 'externalReference'>): number {
  if (typeof player.sortOrder === 'number' && Number.isFinite(player.sortOrder)) {
    return player.sortOrder
  }
  if (player.externalReference) {
    const match = /^P?(\d+)$/i.exec(player.externalReference.trim())
    if (match) return parseInt(match[1], 10)
  }
  return 999999
}

function compareByRatingDesc<T extends PoolCandidatePlayer>(a: T, b: T): number {
  const diff = getPlayerRating(b) - getPlayerRating(a)
  if (diff !== 0) return diff
  const orderDiff = getFallbackOrder(a) - getFallbackOrder(b)
  if (orderDiff !== 0) return orderDiff
  return a.name.localeCompare(b.name)
}

function roleRank(role: string | null | undefined): number {
  const normalized = normalizeRole(role)
  if (!normalized) return ROLE_SEQUENCE.length
  return ROLE_SEQUENCE.indexOf(normalized)
}

/**
 * Non-destructively generates an active auction round player pool of size
 * `targetTeamCount * 11` from the full master player list:
 *
 * 1. Guarantee role minimums first (sorted by rating desc):
 *    - BAT: targetTeamCount * 3
 *    - BOWL: targetTeamCount * 3
 *    - AR: targetTeamCount * 1
 *    - WK: targetTeamCount * 1
 * 2. Fill remaining flex slots from unselected players sorted by rating desc
 *    to reach `targetTeamCount * 11` (3 * targetTeamCount when all quotas are met).
 * 3. Exclude lowest-rated overflow without mutating `masterPlayers`.
 * 4. Sort final pool strictly BAT -> BOWL -> AR -> WK (rating desc within each).
 */
export function buildRoundPool<T extends PoolCandidatePlayer>(
  masterPlayers: readonly T[],
  targetTeamCount: number,
): T[] {
  if (!Number.isFinite(targetTeamCount) || targetTeamCount <= 0 || masterPlayers.length === 0) {
    return []
  }

  const targetTotal = Math.min(Math.floor(targetTeamCount * 11), masterPlayers.length)

  const indexed = masterPlayers.map((player, index) => ({
    player,
    index,
    role: normalizeRole(player.role),
  }))

  const byRole: Record<AuctionRole, typeof indexed> = {
    BAT: [],
    BOWL: [],
    AR: [],
    WK: [],
  }

  for (const entry of indexed) {
    if (entry.role) {
      byRole[entry.role].push(entry)
    }
  }

  for (const role of ROLE_SEQUENCE) {
    byRole[role].sort((a, b) => compareByRatingDesc(a.player, b.player))
  }

  const quotas: Record<AuctionRole, number> = {
    BAT: Math.floor(targetTeamCount * 3),
    BOWL: Math.floor(targetTeamCount * 3),
    AR: Math.floor(targetTeamCount * 1),
    WK: Math.floor(targetTeamCount * 1),
  }

  const selectedIndices = new Set<number>()
  const selected: T[] = []

  // Step 1: Guarantee role minimums first
  for (const role of ROLE_SEQUENCE) {
    const picks = byRole[role].slice(0, quotas[role])
    for (const pick of picks) {
      if (!selectedIndices.has(pick.index)) {
        selectedIndices.add(pick.index)
        selected.push(pick.player)
      }
    }
  }

  // Step 2: Fill remaining flex slots from unselected players sorted by rating desc
  const remainingNeeded = Math.max(0, targetTotal - selected.length)
  if (remainingNeeded > 0) {
    const remaining = indexed
      .filter((entry) => !selectedIndices.has(entry.index))
      .sort((a, b) => compareByRatingDesc(a.player, b.player))
      .slice(0, remainingNeeded)

    for (const pick of remaining) {
      selectedIndices.add(pick.index)
      selected.push(pick.player)
    }
  }

  // Step 4: Enforce strict serial role sequence BAT -> BOWL -> AR -> WK (rating desc within each)
  return [...selected].sort((a, b) => {
    const rDiff = roleRank(a.role) - roleRank(b.role)
    if (rDiff !== 0) return rDiff
    return compareByRatingDesc(a, b)
  })
}

/**
 * Evaluates whether a team meets the squad qualification rules:
 * - Total players >= 11
 * - Batsmen (BAT) >= 3
 * - Bowlers (BOWL) >= 3
 * - All-Rounders (AR) >= 1
 * - Wicket-Keepers (WK) >= 1
 */
export function evaluateTeamQualification(
  team: Pick<TeamDoc, 'id' | 'name' | 'totalSpent' | 'remainingPurse' | 'totalPoints' | 'playerCount'>,
  squadPlayers: readonly Pick<PlayerDoc, 'role' | 'rating' | 'points'>[],
): TeamQualificationResult {
  let batCount = 0
  let bowlCount = 0
  let arCount = 0
  let wkCount = 0
  let computedPoints = 0

  for (const player of squadPlayers) {
    const role = normalizeRole(player.role)
    if (role === 'BAT') batCount += 1
    else if (role === 'BOWL') bowlCount += 1
    else if (role === 'AR') arCount += 1
    else if (role === 'WK') wkCount += 1
    computedPoints = addPoints(computedPoints, getPlayerRating(player))
  }

  const playerCount = squadPlayers.length
  const totalPoints = squadPlayers.length > 0 ? computedPoints : team.totalPoints

  const missingPlayers = Math.max(0, QUALIFICATION_RULES.minPlayers - playerCount)
  const missingBat = Math.max(0, QUALIFICATION_RULES.minBat - batCount)
  const missingBowl = Math.max(0, QUALIFICATION_RULES.minBowl - bowlCount)
  const missingAr = Math.max(0, QUALIFICATION_RULES.minAr - arCount)
  const missingWk = Math.max(0, QUALIFICATION_RULES.minWk - wkCount)

  const missingReasons: string[] = []
  if (missingPlayers > 0) {
    missingReasons.push(`${missingPlayers} more player${missingPlayers === 1 ? '' : 's'}`)
  }
  if (missingBat > 0) missingReasons.push(`${missingBat} BAT`)
  if (missingBowl > 0) missingReasons.push(`${missingBowl} BOWL`)
  if (missingAr > 0) missingReasons.push(`${missingAr} AR`)
  if (missingWk > 0) missingReasons.push(`${missingWk} WK`)

  const qualified = missingReasons.length === 0
  const missingSummary = qualified ? '' : `Needs ${missingReasons.join(', ')}`

  return {
    teamId: team.id,
    teamName: team.name,
    qualified,
    playerCount,
    batCount,
    bowlCount,
    arCount,
    wkCount,
    totalPoints,
    totalSpent: team.totalSpent,
    remainingPurse: team.remainingPurse,
    missingPlayers,
    missingBat,
    missingBowl,
    missingAr,
    missingWk,
    missingReasons,
    missingSummary,
  }
}

/** Ranks Round 2 qualified teams by totalPoints desc, then remainingPurse desc. */
export function rankQualifiedTeams(
  results: readonly TeamQualificationResult[],
): TeamQualificationResult[] {
  return results
    .filter((r) => r.qualified)
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
      if (b.remainingPurse !== a.remainingPurse) return b.remainingPurse - a.remainingPurse
      return a.teamName.localeCompare(b.teamName)
    })
}

/** Evaluates all participating teams for Round 1 or Round 2 and returns a snapshot. */
export function buildRoundSnapshot(input: {
  round: 1 | 2
  teams: readonly TeamDoc[]
  players: readonly PlayerDoc[]
  poolSize: number
  excludedTeamIds?: readonly string[]
  endedAt?: string
}): RoundSnapshot {
  const excludedSet = new Set(input.excludedTeamIds ?? [])
  const squadByTeam = new Map<string, PlayerDoc[]>()

  for (const player of input.players) {
    if (player.status === 'sold' && player.soldToTeamId) {
      const list = squadByTeam.get(player.soldToTeamId) ?? []
      list.push(player)
      squadByTeam.set(player.soldToTeamId, list)
    }
  }

  const participatingTeams = input.teams.filter((t) => !excludedSet.has(t.id))
  const rawResults = participatingTeams.map((team) =>
    evaluateTeamQualification(team, squadByTeam.get(team.id) ?? []),
  )

  const qualified = input.round === 2
    ? rankQualifiedTeams(rawResults)
    : rawResults.filter((r) => r.qualified).sort((a, b) => b.totalPoints - a.totalPoints || a.teamName.localeCompare(b.teamName))

  const eliminated = rawResults
    .filter((r) => !r.qualified)
    .sort((a, b) => b.playerCount - a.playerCount || a.teamName.localeCompare(b.teamName))

  const orderedResults = [...qualified, ...eliminated]

  return {
    round: input.round,
    endedAt: input.endedAt ?? new Date().toISOString(),
    poolSize: input.poolSize,
    qualifiedTeamIds: qualified.map((r) => r.teamId),
    eliminatedTeamIds: eliminated.map((r) => r.teamId),
    results: orderedResults,
  }
}

/** Finds the next unprocessed index in `roundPoolPlayerIds` starting at `startIndex`. */
export function findNextUnprocessedIndex(
  roundPoolPlayerIds: readonly string[],
  playersById: ReadonlyMap<string, Pick<PlayerDoc, 'status'>>,
  unsoldSet: ReadonlySet<string>,
  startIndex = 0,
): number {
  const total = roundPoolPlayerIds.length
  if (total === 0) return -1
  const clampedStart = Math.max(0, Math.min(startIndex, total - 1))

  for (let offset = 0; offset < total; offset += 1) {
    const idx = (clampedStart + offset) % total
    const id = roundPoolPlayerIds[idx]!
    const player = playersById.get(id)
    if (player && player.status === 'available' && !unsoldSet.has(id)) {
      return idx
    }
  }

  return -1
}

/** Returns true when every player in `roundPoolPlayerIds` is sold, withdrawn, or marked unsold. */
export function isRoundPoolComplete(
  roundPoolPlayerIds: readonly string[],
  playersById: ReadonlyMap<string, Pick<PlayerDoc, 'status'>>,
  unsoldSet: ReadonlySet<string>,
): boolean {
  if (roundPoolPlayerIds.length === 0) return false
  for (const id of roundPoolPlayerIds) {
    const player = playersById.get(id)
    if (!player) continue
    if (player.status === 'available' && !unsoldSet.has(id)) {
      return false
    }
  }
  return true
}
