import type { AuditAction, EventStatus, PlayerStatus, PurchaseStatus } from '@shared/types'

/** Human labels for machine values, shared by the admin console screens. */

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'event.created': 'Event created',
  'event.updated': 'Event settings updated',
  'event.activated': 'Auction started',
  'event.finalized': 'Auction finalized',
  'event.reopened': 'Auction reopened',
  'event.consistency-checked': 'Consistency check run',
  'team.created': 'Team added',
  'team.updated': 'Team updated',
  'team.deactivated': 'Team deactivated',
  'team.reactivated': 'Team reactivated',
  'team.pin-reset': 'Team PIN reset',
  'team.starting-purse-changed': 'Starting purse changed',
  'team.sessions-revoked': 'Team sessions revoked',
  'player.created': 'Player added',
  'player.updated': 'Player updated',
  'player.corrected': 'Sold player corrected',
  'player.imported': 'Players imported',
  'purchase.recorded': 'Purchase recorded',
  'purchase.reversed': 'Purchase reversed',
  'session.created': 'Team session started',
  'session.revoked': 'Team session revoked',
  'config.updated': 'Configuration updated',
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  setup: 'Setup',
  active: 'Active',
  finalized: 'Finalized',
}

export const PLAYER_STATUS_LABELS: Record<PlayerStatus, string> = {
  available: 'Available',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
}

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  confirmed: 'Confirmed',
  reversed: 'Reversed',
}

/** Explains why an error occurred in plain language for operators. */
export function describeIssue(issue: string): string {
  return issue
}
