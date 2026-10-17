import { MAX_NOTES_LENGTH, MAX_REASON_LENGTH, MAX_ROSTER_SIZE_LIMIT, MAX_URL_LENGTH } from './constants'
import type { ConsistencyReport } from './calculations'
import type { AppErrorCode } from './errors'
import { isValidAmount, isValidPoints } from './money'
import { SERVER_TIMESTAMP, type PlannedWrite, type PlanResult } from './plan'
import { cleanOptionalText, cleanDisplayName, isValidHttpUrl, normalizeName } from './text'
import type { AuditAction, EventDoc, EventStatus, PlayerDoc, PlayerStatus, PurchaseDoc, TeamDoc } from './types'

/** Pure planners for admin mutations (players, teams, event settings). */

function fail(
  code: AppErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): PlanResult<never> {
  return { ok: false, code, message, details }
}

function isEditable(event: EventDoc | null): boolean {
  return event !== null && event.status !== 'finalized'
}

/* -------------------------------------------------------------------------- */
/* Players                                                                    */
/* -------------------------------------------------------------------------- */

export interface PlayerInput {
  name: string
  points: number
  basePrice: number
  photoUrl?: string | null
  externalReference?: string | null
  notes?: string | null
  status?: PlayerStatus
}

export interface CleanPlayerInput {
  name: string
  normalizedName: string
  points: number
  basePrice: number
  photoUrl: string | null
  externalReference: string | null
  /** Lower-cased external reference, used for duplicate detection queries. */
  externalReferenceLower: string | null
  notes: string | null
  status: Extract<PlayerStatus, 'available' | 'withdrawn'>
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: AppErrorCode; message?: string }

export function validatePlayerInput(input: PlayerInput): ValidationResult<CleanPlayerInput> {
  const name = cleanDisplayName(input.name)
  if (name === '') {
    return { ok: false, code: 'invalid-argument', message: 'Player name is required.' }
  }
  if (!isValidPoints(input.points)) {
    return { ok: false, code: 'invalid-argument', message: 'Points must be a whole number of 0 or more.' }
  }
  if (!isValidAmount(input.basePrice, true)) {
    return { ok: false, code: 'invalid-argument', message: 'Base price must be a whole number of 0 or more.' }
  }
  const photoUrl = cleanOptionalText(input.photoUrl, MAX_URL_LENGTH)
  if (photoUrl !== null && !isValidHttpUrl(photoUrl)) {
    return { ok: false, code: 'invalid-argument', message: 'Photo URL must be a valid http(s) link.' }
  }
  const status = input.status === 'withdrawn' ? 'withdrawn' : 'available'
  const externalReference = cleanOptionalText(input.externalReference, 120)

  return {
    ok: true,
    value: {
      name,
      normalizedName: normalizeName(name),
      points: input.points,
      basePrice: input.basePrice,
      photoUrl,
      externalReference,
      externalReferenceLower: externalReference ? externalReference.toLowerCase() : null,
      notes: cleanOptionalText(input.notes, MAX_NOTES_LENGTH),
      status,
    },
  }
}

export interface CreatePlayerCommand {
  eventId: string
  playerId: string
  input: PlayerInput
  actorUid: string
  auditLogId: string
}

export interface CreatePlayerState {
  event: EventDoc | null
  duplicateExternalReference: boolean
}

export interface CreatePlayerOutcome {
  playerId: string
  name: string
}

export function planCreatePlayer(
  command: CreatePlayerCommand,
  state: CreatePlayerState,
): PlanResult<CreatePlayerOutcome> {
  if (!state.event) return fail('event-not-found')
  if (!isEditable(state.event)) return fail('event-finalized')

  const validated = validatePlayerInput(command.input)
  if (!validated.ok) return fail(validated.code, validated.message)

  if (validated.value.externalReference && state.duplicateExternalReference) {
    return fail('player-duplicate-external-id')
  }

  const now = SERVER_TIMESTAMP
  const player: Record<string, unknown> = {
    ...validated.value,
    soldToTeamId: null,
    purchaseId: null,
    createdAt: now,
    updatedAt: now,
  }

  const writes: PlannedWrite[] = [
    { kind: 'player', id: command.playerId, op: 'set', data: player },
    {
      kind: 'auditLog',
      id: command.auditLogId,
      op: 'set',
      data: {
        eventId: command.eventId,
        actorUid: command.actorUid,
        actorRole: 'admin',
        action: 'player.created',
        targetType: 'player',
        targetId: command.playerId,
        reason: null,
        metadata: {
          name: validated.value.name,
          points: validated.value.points,
          basePrice: validated.value.basePrice,
        },
        createdAt: now,
      },
    },
  ]

  return { ok: true, writes, result: { playerId: command.playerId, name: validated.value.name } }
}

export interface UpdatePlayerCommand {
  eventId: string
  playerId: string
  patch: Partial<PlayerInput>
  reason: string | null
  actorUid: string
  auditLogId: string
}

export interface UpdatePlayerState {
  event: EventDoc | null
  player: PlayerDoc | null
  /** Required when the player is sold (totals must be re-derived atomically). */
  team: TeamDoc | null
  purchase: PurchaseDoc | null
  duplicateExternalReference: boolean
}

export interface UpdatePlayerOutcome {
  playerId: string
  name: string
  corrected: boolean
  pointsDelta: number
}

export function planUpdatePlayer(
  command: UpdatePlayerCommand,
  state: UpdatePlayerState,
): PlanResult<UpdatePlayerOutcome> {
  if (!state.event) return fail('event-not-found')
  if (!isEditable(state.event)) return fail('event-finalized')

  const player = state.player
  if (!player) return fail('player-not-found')

  const merged: PlayerInput = {
    name: command.patch.name ?? player.name,
    points: command.patch.points ?? player.points,
    basePrice: command.patch.basePrice ?? player.basePrice,
    photoUrl: command.patch.photoUrl !== undefined ? command.patch.photoUrl : player.photoUrl,
    externalReference:
      command.patch.externalReference !== undefined
        ? command.patch.externalReference
        : player.externalReference,
    notes: command.patch.notes !== undefined ? command.patch.notes : player.notes,
  }

  const validated = validatePlayerInput(merged)
  if (!validated.ok) return fail(validated.code, validated.message)

  if (validated.value.externalReference && state.duplicateExternalReference) {
    return fail('player-duplicate-external-id')
  }

  const now = SERVER_TIMESTAMP
  const writes: PlannedWrite[] = []
  const reason = cleanOptionalText(command.reason, MAX_REASON_LENGTH)
  const sold = player.status === 'sold'
  const pointsChanged = validated.value.points !== player.points
  const basePriceChanged = validated.value.basePrice !== player.basePrice
  const nameChanged = validated.value.name !== player.name
  const photoChanged = (validated.value.photoUrl ?? null) !== (player.photoUrl ?? null)

  const requestedStatus = command.patch.status
  if (requestedStatus === 'sold') {
    return fail('player-status-conflict', 'Use "Record purchase" to sell a player.')
  }
  if (sold && requestedStatus !== undefined) {
    return fail(
      'player-status-conflict',
      'A sold player cannot be marked available or withdrawn. Reverse the purchase first.',
    )
  }
  // A sold player always keeps `sold`; other players may toggle available/withdrawn.
  const nextStatus: PlayerStatus = sold ? 'sold' : (requestedStatus ?? player.status)

  if (sold && (pointsChanged || basePriceChanged) && reason === null) {
    return fail('reason-required', 'Changing a sold player requires a reason for the audit log.')
  }

  const playerPatch: Record<string, unknown> = {
    name: validated.value.name,
    normalizedName: validated.value.normalizedName,
    points: validated.value.points,
    basePrice: validated.value.basePrice,
    photoUrl: validated.value.photoUrl,
    externalReference: validated.value.externalReference,
    externalReferenceLower: validated.value.externalReferenceLower,
    notes: validated.value.notes,
    status: nextStatus,
    updatedAt: now,
  }

  let pointsDelta = 0
  let corrected = false

  if (sold && pointsChanged) {
    const team = state.team
    if (!team) return fail('team-not-found', 'The owning team could not be found.')
    const purchase = state.purchase
    if (!purchase || purchase.id !== player.purchaseId || purchase.status !== 'confirmed') {
      return fail(
        'purchase-reversal-conflict',
        'The linked purchase could not be verified, so team totals were left untouched.',
      )
    }
    pointsDelta = validated.value.points - player.points
    const nextTotalPoints = team.totalPoints + pointsDelta
    if (nextTotalPoints < 0) {
      return fail('team-state-inconsistent', 'The correction would make team points negative.')
    }
    writes.push({
      kind: 'team',
      id: team.id,
      op: 'update',
      data: { totalPoints: nextTotalPoints, updatedAt: now },
    })
    corrected = true
  }

  // Keep the sale snapshot in sync for display-only fields so team panels show
  // the corrected name/photo. Money and points snapshots are never rewritten.
  if (sold && (nameChanged || photoChanged) && player.purchaseId) {
    writes.push({
      kind: 'purchase',
      id: player.purchaseId,
      op: 'update',
      data: {
        playerNameSnapshot: validated.value.name,
        playerPhotoUrlSnapshot: validated.value.photoUrl,
      },
    })
  }

  if (sold && basePriceChanged) {
    corrected = true
  }

  writes.unshift({ kind: 'player', id: player.id, op: 'update', data: playerPatch })
  writes.push({
    kind: 'auditLog',
    id: command.auditLogId,
    op: 'set',
    data: {
      eventId: command.eventId,
      actorUid: command.actorUid,
      actorRole: 'admin',
      action: (sold && corrected ? 'player.corrected' : 'player.updated') satisfies AuditAction,
      targetType: 'player',
      targetId: player.id,
      reason,
      metadata: {
        name: validated.value.name,
        points: validated.value.points,
        basePrice: validated.value.basePrice,
        sold,
        pointsDelta,
      },
      createdAt: now,
    },
  })

  return {
    ok: true,
    writes,
    result: { playerId: player.id, name: validated.value.name, corrected, pointsDelta },
  }
}

export interface ImportPlayersCommand {
  eventId: string
  players: Array<{
    playerId: string
    input: PlayerInput
  }>
  actorUid: string
  auditLogId: string
}

export function planImportPlayers(
  command: ImportPlayersCommand,
  state: { event: EventDoc | null; duplicateExternalReferences: Set<string> },
): PlanResult<{ imported: number }> {
  if (!state.event) return fail('event-not-found')
  if (!isEditable(state.event)) return fail('event-finalized')
  if (command.players.length === 0) {
    return fail('invalid-argument', 'No players to import.')
  }

  const seen = new Set<string>()
  const now = SERVER_TIMESTAMP
  const writes: PlannedWrite[] = []

  for (const row of command.players) {
    const validated = validatePlayerInput(row.input)
    if (!validated.ok) return fail(validated.code, validated.message)
    const reference = validated.value.externalReference?.toLowerCase() ?? null
    if (reference) {
      if (state.duplicateExternalReferences.has(reference) || seen.has(reference)) {
        return fail('player-duplicate-external-id', `Duplicate player id: ${reference}`)
      }
      seen.add(reference)
    }
    writes.push({
      kind: 'player',
      id: row.playerId,
      op: 'set',
      data: {
        ...validated.value,
        soldToTeamId: null,
        purchaseId: null,
        createdAt: now,
        updatedAt: now,
      },
    })
  }

  writes.push({
    kind: 'auditLog',
    id: command.auditLogId,
    op: 'set',
    data: {
      eventId: command.eventId,
      actorUid: command.actorUid,
      actorRole: 'admin',
      action: 'player.imported' satisfies AuditAction,
      targetType: 'player',
      targetId: 'bulk',
      reason: null,
      metadata: { count: command.players.length },
      createdAt: now,
    },
  })

  return { ok: true, writes, result: { imported: command.players.length } }
}

/* -------------------------------------------------------------------------- */
/* Teams                                                                      */
/* -------------------------------------------------------------------------- */

export interface TeamInput {
  name: string
  startingPurse: number
  logoUrl?: string | null
}

export interface CleanTeamInput {
  name: string
  normalizedName: string
  startingPurse: number
  logoUrl: string | null
}

export function validateTeamInput(input: TeamInput): ValidationResult<CleanTeamInput> {
  const name = cleanDisplayName(input.name)
  if (name === '') return { ok: false, code: 'invalid-argument', message: 'Team name is required.' }
  if (!isValidAmount(input.startingPurse, true)) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'Starting purse must be a whole number of 0 or more.',
    }
  }
  const logoUrl = cleanOptionalText(input.logoUrl, MAX_URL_LENGTH)
  if (logoUrl !== null && !isValidHttpUrl(logoUrl)) {
    return { ok: false, code: 'invalid-argument', message: 'Logo URL must be a valid http(s) link.' }
  }
  return {
    ok: true,
    value: { name, normalizedName: normalizeName(name), startingPurse: input.startingPurse, logoUrl },
  }
}

export interface CreateTeamCommand {
  eventId: string
  teamId: string
  input: TeamInput
  actorUid: string
  auditLogId: string
  /** PIN material is computed in the privileged layer and never logged. */
  pinLookupHash: string
  pinVerifier: string
  pinVersion: number
}

export interface CreateTeamState {
  event: EventDoc | null
  nameTaken: boolean
}

export function planCreateTeam(
  command: CreateTeamCommand,
  state: CreateTeamState,
): PlanResult<{ teamId: string; name: string }> {
  if (!state.event) return fail('event-not-found')
  if (!isEditable(state.event)) return fail('event-finalized')

  const validated = validateTeamInput(command.input)
  if (!validated.ok) return fail(validated.code, validated.message)
  if (state.nameTaken) return fail('team-name-taken')

  const now = SERVER_TIMESTAMP
  const team: Record<string, unknown> = {
    ...validated.value,
    remainingPurse: validated.value.startingPurse,
    totalSpent: 0,
    totalPoints: 0,
    playerCount: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  }

  const writes: PlannedWrite[] = [
    { kind: 'team', id: command.teamId, op: 'set', data: team },
    {
      kind: 'secret',
      id: command.teamId,
      op: 'set',
      data: {
        teamId: command.teamId,
        pinVerifier: command.pinVerifier,
        pinLookupHash: command.pinLookupHash,
        pinVersion: command.pinVersion,
        pinSetAt: now,
        pinSetBy: command.actorUid,
        updatedAt: now,
      },
    },
    { kind: 'pinIndex', id: command.pinLookupHash, op: 'set', data: { eventId: command.eventId, teamId: command.teamId } },
    {
      kind: 'auditLog',
      id: command.auditLogId,
      op: 'set',
      data: {
        eventId: command.eventId,
        actorUid: command.actorUid,
        actorRole: 'admin',
        action: 'team.created' satisfies AuditAction,
        targetType: 'team',
        targetId: command.teamId,
        reason: null,
        metadata: { name: validated.value.name, startingPurse: validated.value.startingPurse },
        createdAt: now,
      },
    },
  ]

  return {
    ok: true,
    writes,
    result: { teamId: command.teamId, name: validated.value.name },
  }
}

export interface UpdateTeamCommand {
  eventId: string
  teamId: string
  patch: {
    name?: string
    logoUrl?: string | null
    active?: boolean
    startingPurse?: number
  }
  reason: string | null
  actorUid: string
  auditLogId: string
}

export interface UpdateTeamState {
  event: EventDoc | null
  team: TeamDoc | null
  nameTaken: boolean
}

export interface UpdateTeamOutcome {
  teamId: string
  name: string
  action: AuditAction
  sessionsRevoked: boolean
}

export function planUpdateTeam(
  command: UpdateTeamCommand,
  state: UpdateTeamState,
): PlanResult<UpdateTeamOutcome> {
  if (!state.event) return fail('event-not-found')
  const team = state.team
  if (!team) return fail('team-not-found')

  const finalizing = state.event.status === 'finalized'
  const reason = cleanOptionalText(command.reason, MAX_REASON_LENGTH)

  const mergedName = command.patch.name ?? team.name
  const mergedLogo =
    command.patch.logoUrl !== undefined ? command.patch.logoUrl : team.logoUrl
  const mergedPurse = command.patch.startingPurse ?? team.startingPurse
  const mergedActive = command.patch.active ?? team.active

  const validated = validateTeamInput({
    name: mergedName,
    startingPurse: mergedPurse,
    logoUrl: mergedLogo,
  })
  if (!validated.ok) return fail(validated.code, validated.message)
  if (validated.value.normalizedName !== team.normalizedName && state.nameTaken) {
    return fail('team-name-taken')
  }

  const nameChanged = validated.value.name !== team.name
  const logoChanged = (validated.value.logoUrl ?? null) !== (team.logoUrl ?? null)
  const purseChanged = validated.value.startingPurse !== team.startingPurse
  const activeChanged = mergedActive !== team.active

  if (finalizing && (nameChanged || logoChanged || purseChanged || activeChanged)) {
    return fail('event-finalized')
  }

  if (purseChanged) {
    if (reason === null) {
      return fail('reason-required', 'Changing the starting purse requires a reason.')
    }
    const nextRemaining = validated.value.startingPurse - team.totalSpent
    if (nextRemaining < 0) {
      return fail(
        'team-purse-too-low',
        `The starting purse cannot be lower than the ${team.totalSpent} already spent.`,
      )
    }
  }

  const now = SERVER_TIMESTAMP
  const patch: Record<string, unknown> = { updatedAt: now }
  if (nameChanged) {
    patch.name = validated.value.name
    patch.normalizedName = validated.value.normalizedName
  }
  if (logoChanged) patch.logoUrl = validated.value.logoUrl
  if (purseChanged) {
    patch.startingPurse = validated.value.startingPurse
    patch.remainingPurse = validated.value.startingPurse - team.totalSpent
  }
  if (activeChanged) patch.active = mergedActive

  let action: AuditAction = 'team.updated'
  if (purseChanged) action = 'team.starting-purse-changed'
  else if (activeChanged) action = mergedActive ? 'team.reactivated' : 'team.deactivated'

  const sessionsRevoked = activeChanged && !mergedActive

  const writes: PlannedWrite[] = [
    { kind: 'team', id: team.id, op: 'update', data: patch },
    {
      kind: 'auditLog',
      id: command.auditLogId,
      op: 'set',
      data: {
        eventId: command.eventId,
        actorUid: command.actorUid,
        actorRole: 'admin',
        action,
        targetType: 'team',
        targetId: team.id,
        reason,
        metadata: {
          name: validated.value.name,
          startingPurse: validated.value.startingPurse,
          previousStartingPurse: team.startingPurse,
          active: mergedActive,
          sessionsRevoked,
        },
        createdAt: now,
      },
    },
  ]

  return {
    ok: true,
    writes,
    result: { teamId: team.id, name: validated.value.name, action, sessionsRevoked },
  }
}

/* -------------------------------------------------------------------------- */
/* Event                                                                      */
/* -------------------------------------------------------------------------- */

export interface CreateEventCommand {
  eventId: string
  name: string
  currencyLabel: string
  defaultStartingPurse: number
  actorUid: string
  auditLogId: string
  setAsDefault: boolean
}

export function planCreateEvent(
  command: CreateEventCommand,
  state: { eventExists: boolean },
): PlanResult<{ eventId: string; name: string }> {
  if (state.eventExists) return fail('already-exists', 'That event id is already in use.')

  const name = cleanDisplayName(command.name, 80)
  if (name === '') return fail('invalid-argument', 'Event name is required.')
  const currencyLabel = cleanOptionalText(command.currencyLabel, 12) ?? ''
  if (currencyLabel === '') {
    return fail('invalid-argument', 'A currency or credit label is required.')
  }
  if (!isValidAmount(command.defaultStartingPurse, true)) {
    return fail('invalid-argument', 'Default starting purse must be a whole number of 0 or more.')
  }

  const now = SERVER_TIMESTAMP
  const writes: PlannedWrite[] = [
    {
      kind: 'event',
      id: command.eventId,
      op: 'set',
      data: {
        name,
        currencyLabel,
        status: 'setup' satisfies EventStatus,
        maxRosterSize: null,
        defaultStartingPurse: command.defaultStartingPurse,
        purchasesEnabled: true,
        createdBy: command.actorUid,
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      kind: 'auditLog',
      id: command.auditLogId,
      op: 'set',
      data: {
        eventId: command.eventId,
        actorUid: command.actorUid,
        actorRole: 'admin',
        action: 'event.created' satisfies AuditAction,
        targetType: 'event',
        targetId: command.eventId,
        reason: null,
        metadata: { name, currencyLabel },
        createdAt: now,
      },
    },
  ]

  if (command.setAsDefault) {
    writes.push({
      kind: 'config',
      id: 'app',
      op: 'set',
      data: {
        defaultEventId: command.eventId,
        eventName: name,
        currencyLabel,
        eventStatus: 'setup',
        updatedAt: now,
      },
    })
  }

  return { ok: true, writes, result: { eventId: command.eventId, name } }
}

export interface UpdateEventCommand {
  eventId: string
  patch: {
    name?: string
    currencyLabel?: string
    defaultStartingPurse?: number
    maxRosterSize?: number | null
    purchasesEnabled?: boolean
    status?: EventStatus
  }
  reason: string | null
  actorUid: string
  actorRole: 'admin' | 'superAdmin'
  auditLogId: string
}

export interface UpdateEventState {
  event: EventDoc | null
  teamCount: number
  playerCount: number
  consistency: ConsistencyReport | null
  isDefaultEvent: boolean
}

export interface UpdateEventOutcome {
  eventId: string
  action: AuditAction
  status: EventStatus
  problems: string[]
}

export function planUpdateEvent(
  command: UpdateEventCommand,
  state: UpdateEventState,
): PlanResult<UpdateEventOutcome> {
  const event = state.event
  if (!event) return fail('event-not-found')

  const reason = cleanOptionalText(command.reason, MAX_REASON_LENGTH)
  const merged = {
    name: command.patch.name !== undefined ? cleanDisplayName(command.patch.name, 80) : event.name,
    currencyLabel:
      command.patch.currencyLabel !== undefined
        ? (cleanOptionalText(command.patch.currencyLabel, 12) ?? '')
        : event.currencyLabel,
    defaultStartingPurse:
      command.patch.defaultStartingPurse !== undefined
        ? command.patch.defaultStartingPurse
        : event.defaultStartingPurse,
    maxRosterSize:
      command.patch.maxRosterSize !== undefined ? command.patch.maxRosterSize : event.maxRosterSize,
    purchasesEnabled:
      command.patch.purchasesEnabled !== undefined
        ? command.patch.purchasesEnabled
        : event.purchasesEnabled,
    status: command.patch.status ?? event.status,
  }

  if (merged.name === '') return fail('invalid-argument', 'Event name is required.')
  if (merged.currencyLabel === '') {
    return fail('invalid-argument', 'A currency or credit label is required.')
  }
  if (!isValidAmount(merged.defaultStartingPurse, true)) {
    return fail('invalid-argument', 'Default starting purse must be a whole number of 0 or more.')
  }
  if (
    merged.maxRosterSize !== null &&
    (!Number.isSafeInteger(merged.maxRosterSize) ||
      merged.maxRosterSize < 1 ||
      merged.maxRosterSize > MAX_ROSTER_SIZE_LIMIT)
  ) {
    return fail(
      'invalid-argument',
      `Maximum roster size must be between 1 and ${MAX_ROSTER_SIZE_LIMIT}, or empty for no limit.`,
    )
  }

  const statusChanged = merged.status !== event.status
  let action: AuditAction = 'event.updated'

  if (statusChanged) {
    if (event.status === 'finalized' && merged.status === 'active') {
      if (command.actorRole !== 'superAdmin') {
        return fail('not-super-admin', 'Only a super admin can reopen a finalized event.')
      }
      if (reason === null) {
        return fail('reason-required', 'Reopening a finalized event requires a reason.')
      }
      action = 'event.reopened'
    } else if (event.status === 'finalized') {
      return fail('event-finalized')
    } else if (merged.status === 'finalized') {
      const report = state.consistency
      if (!report || !report.ok) {
        return {
          ok: false,
          code: 'event-consistency-failed',
          message: 'The event did not pass the consistency check.',
          details: { problems: (report?.problems ?? []).map((p) => p.message) },
        }
      }
      action = 'event.finalized'
    } else if (merged.status === 'active') {
      if (event.status !== 'setup' && event.status !== 'active') {
        return fail('failed-precondition')
      }
      if (state.teamCount < 1 || state.playerCount < 1) {
        return fail('event-not-ready', 'Add at least one team and one player first.')
      }
      action = 'event.activated'
    } else if (merged.status === 'setup') {
      return fail('failed-precondition', 'An event cannot be moved back to setup.')
    } else {
      return fail('invalid-argument', 'Unknown event status.')
    }
  }

  const now = SERVER_TIMESTAMP
  const patch: Record<string, unknown> = { ...merged, updatedAt: now }
  const writes: PlannedWrite[] = [{ kind: 'event', id: event.id, op: 'update', data: patch }]

  if (state.isDefaultEvent) {
    writes.push({
      kind: 'config',
      id: 'app',
      op: 'set',
      data: {
        defaultEventId: event.id,
        eventName: merged.name,
        currencyLabel: merged.currencyLabel,
        eventStatus: merged.status,
        updatedAt: now,
      },
    })
  }

  writes.push({
    kind: 'auditLog',
    id: command.auditLogId,
    op: 'set',
    data: {
      eventId: event.id,
      actorUid: command.actorUid,
      actorRole: command.actorRole,
      action,
      targetType: 'event',
      targetId: event.id,
      reason,
      metadata: {
        status: merged.status,
        previousStatus: event.status,
        purchasesEnabled: merged.purchasesEnabled,
        maxRosterSize: merged.maxRosterSize,
      },
      createdAt: now,
    },
  })

  return {
    ok: true,
    writes,
    result: {
      eventId: event.id,
      action,
      status: merged.status,
      problems: statusChanged && !state.consistency?.ok ? (state.consistency?.problems ?? []).map((p) => p.message) : [],
    },
  }
}

export function planSetDefaultEvent(
  command: { eventId: string; actorUid: string; auditLogId: string },
  state: { event: EventDoc | null },
): PlanResult<{ eventId: string }> {
  const event = state.event
  if (!event) return fail('event-not-found')
  const now = SERVER_TIMESTAMP
  return {
    ok: true,
    writes: [
      {
        kind: 'config',
        id: 'app',
        op: 'set',
        data: {
          defaultEventId: event.id,
          eventName: event.name,
          currencyLabel: event.currencyLabel,
          eventStatus: event.status,
          updatedAt: now,
        },
      },
      {
        kind: 'auditLog',
        id: command.auditLogId,
        op: 'set',
        data: {
          eventId: event.id,
          actorUid: command.actorUid,
          actorRole: 'admin',
          action: 'config.updated' satisfies AuditAction,
          targetType: 'config',
          targetId: 'app',
          reason: null,
          metadata: { defaultEventId: event.id },
          createdAt: now,
        },
      },
    ],
    result: { eventId: event.id },
  }
}

export function planSetPlayerStatus(
  command: { eventId: string; playerId: string; status: PlayerStatus; actorUid: string; auditLogId: string },
  state: { event: EventDoc | null; player: PlayerDoc | null },
): PlanResult<{ playerId: string; status: PlayerStatus }> {
  if (!state.event) return fail('event-not-found')
  if (!isEditable(state.event)) return fail('event-finalized')
  const player = state.player
  if (!player) return fail('player-not-found')
  if (player.status === 'sold') {
    return fail('player-status-conflict', 'Reverse the purchase before changing this player.')
  }
  if (command.status === 'sold') {
    return fail('player-status-conflict', 'Use "Record purchase" to sell a player.')
  }
  const now = SERVER_TIMESTAMP
  return {
    ok: true,
    writes: [
      {
        kind: 'player',
        id: player.id,
        op: 'update',
        data: { status: command.status, updatedAt: now },
      },
      {
        kind: 'auditLog',
        id: command.auditLogId,
        op: 'set',
        data: {
          eventId: command.eventId,
          actorUid: command.actorUid,
          actorRole: 'admin',
          action: 'player.updated' satisfies AuditAction,
          targetType: 'player',
          targetId: player.id,
          reason: null,
          metadata: { status: command.status, previousStatus: player.status },
          createdAt: now,
        },
      },
    ],
    result: { playerId: player.id, status: command.status },
  }
}

export function planEventConsistencyCheck(
  command: { eventId: string; actorUid: string; auditLogId: string },
  state: { event: EventDoc | null; report: ConsistencyReport },
): PlanResult<{ ok: boolean; problems: string[] }> {
  if (!state.event) return fail('event-not-found')
  const now = SERVER_TIMESTAMP
  return {
    ok: true,
    writes: [
      {
        kind: 'auditLog',
        id: command.auditLogId,
        op: 'set',
        data: {
          eventId: command.eventId,
          actorUid: command.actorUid,
          actorRole: 'admin',
          action: 'event.consistency-checked' satisfies AuditAction,
          targetType: 'event',
          targetId: command.eventId,
          reason: null,
          metadata: { ok: state.report.ok, problemCount: state.report.problems.length },
          createdAt: now,
        },
      },
    ],
    result: { ok: state.report.ok, problems: state.report.problems.map((p) => p.message) },
  }
}
