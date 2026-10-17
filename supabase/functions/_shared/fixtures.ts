import type { EventDoc, PlayerDoc, PurchaseDoc, TeamDoc } from './types.ts'

/** Test fixtures. Kept out of the production build by the `.test` naming rule. */

export function makeEvent(overrides: Partial<EventDoc> = {}): EventDoc {
  return {
    id: 'default',
    name: 'Test Event',
    currencyLabel: '₹',
    status: 'active',
    maxRosterSize: null,
    defaultStartingPurse: 100_000,
    purchasesEnabled: true,
    createdBy: 'admin-1',
    createdAt: null,
    updatedAt: null,
    spotlightPlayer: null,
    ...overrides,
  }
}

export function makeTeam(id: string, overrides: Partial<TeamDoc> = {}): TeamDoc {
  const startingPurse = overrides.startingPurse ?? 100_000
  const totalSpent = overrides.totalSpent ?? 0
  return {
    id,
    name: `Team ${id}`,
    normalizedName: `team ${id}`.toLowerCase(),
    logoUrl: null,
    startingPurse,
    totalSpent,
    remainingPurse: startingPurse - totalSpent,
    totalPoints: 0,
    playerCount: 0,
    active: true,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

export function makePlayer(id: string, overrides: Partial<PlayerDoc> = {}): PlayerDoc {
  return {
    id,
    name: `Player ${id}`,
    normalizedName: `player ${id}`,
    points: 100,
    basePrice: 5_000,
    status: 'available',
    soldToTeamId: null,
    purchaseId: null,
    photoUrl: null,
    externalReference: null,
    notes: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

export function makePurchase(id: string, overrides: Partial<PurchaseDoc> = {}): PurchaseDoc {
  return {
    id,
    playerId: 'p1',
    playerNameSnapshot: 'Player p1',
    playerPointsSnapshot: 100,
    playerPhotoUrlSnapshot: null,
    teamId: 't1',
    teamNameSnapshot: 'Team t1',
    finalPrice: 10_000,
    status: 'confirmed',
    createdBy: 'admin-1',
    requestId: id,
    createdAt: null,
    reversedAt: null,
    reversedBy: null,
    reversalReason: null,
    ...overrides,
  }
}
