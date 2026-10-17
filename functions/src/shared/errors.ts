/**
 * Error codes shared by the Cloud Functions (thrown as HttpsError) and the web
 * client (mapped to human readable messages).
 *
 * The code is transported in `HttpsError.details.code` and, as a fallback, as
 * the raw `message` string so that even unexpected wrapping keeps working.
 */

export const ERROR_CODES = [
  // auth / session
  'unauthenticated',
  'not-admin',
  'not-super-admin',
  'invalid-admin-login',
  'invalid-pin',
  'invalid-pin-format',
  'rate-limited',
  'session-expired',
  'session-revoked',
  'team-inactive',
  // event
  'event-not-found',
  'event-not-active',
  'event-not-started',
  'event-finalized',
  'event-not-ready',
  'event-consistency-failed',
  // player
  'player-not-found',
  'player-already-sold',
  'player-withdrawn',
  'player-not-sold',
  'player-status-conflict',
  'player-duplicate-external-id',
  'player-invalid',
  // team
  'team-not-found',
  'team-name-taken',
  'team-not-selected',
  'team-insufficient-purse',
  'team-roster-full',
  'team-state-inconsistent',
  'team-has-purchases',
  'team-purse-too-low',
  // purchase
  'invalid-price',
  'purchase-not-found',
  'purchase-already-reversed',
  'purchase-reversal-conflict',
  'reason-required',
  'request-conflict',
  'request-id-invalid',
  'purchases-disabled',
  // generic
  'invalid-argument',
  'not-found',
  'already-exists',
  'permission-denied',
  'failed-precondition',
  'internal',
  'unavailable',
  'network',
  'unknown',
] as const

export type AppErrorCode = (typeof ERROR_CODES)[number]

export interface AppErrorMessage {
  /** Short, non-sensitive user facing message. */
  message: string
  /** Suggested next action for the operator. */
  hint?: string
}

export const ERROR_MESSAGES: Record<AppErrorCode, AppErrorMessage> = {
  unauthenticated: {
    message: 'Your session has ended. Please sign in again.',
    hint: 'Sign in again to continue.',
  },
  'not-admin': {
    message: 'This account is not authorized to perform that action.',
    hint: 'Ask the organizer to grant admin access.',
  },
  'not-super-admin': {
    message: 'Only a super admin can perform that action.',
    hint: 'Ask the designated super admin.',
  },
  'invalid-admin-login': {
    message: 'Admin ID or password is incorrect.',
    hint: 'Check the credentials configured for this deployment.',
  },
  'invalid-pin': {
    message: 'That PIN is not valid. Check the four digits and try again.',
    hint: 'If the PIN keeps failing, ask the organizer to reset it.',
  },
  'invalid-pin-format': {
    message: 'Team PINs are exactly four digits.',
  },
  'rate-limited': {
    message: 'Too many attempts. Please wait and try again.',
    hint: 'Wait for the cooldown to end before retrying.',
  },
  'session-expired': {
    message: 'Your team session expired. Please enter your PIN again.',
  },
  'session-revoked': {
    message: 'This team session was ended by the organizer.',
    hint: 'Ask the organizer for the current PIN.',
  },
  'team-inactive': {
    message: 'This team is deactivated and cannot take part right now.',
    hint: 'Ask the organizer to reactivate the team.',
  },
  'event-not-found': {
    message: 'The event could not be found.',
    hint: 'Check the event configuration in Settings.',
  },
  'event-not-active': {
    message: 'The event is not active.',
    hint: 'Start the event in Settings before recording purchases.',
  },
  'event-not-started': {
    message: 'Purchases are only allowed while the event is active.',
    hint: 'Start the event in Settings.',
  },
  'event-finalized': {
    message: 'The event is finalized. Data is read-only.',
    hint: 'Reopen the event first if you really need to change data.',
  },
  'event-not-ready': {
    message: 'The event is not ready yet.',
    hint: 'Add at least one team and one player before starting.',
  },
  'event-consistency-failed': {
    message: 'The event did not pass the consistency check and was not finalized.',
    hint: 'Review the reported problems and fix them first.',
  },
  'player-not-found': {
    message: 'That player could not be found.',
    hint: 'Refresh the player list.',
  },
  'player-already-sold': {
    message: 'This player has already been sold.',
    hint: 'Refresh to see the current owner.',
  },
  'player-withdrawn': {
    message: 'This player is withdrawn and cannot be sold.',
  },
  'player-not-sold': {
    message: 'This player is not currently sold to a team.',
  },
  'player-status-conflict': {
    message: 'This change would conflict with the recorded purchase.',
    hint: 'Reverse the purchase first, then edit the player.',
  },
  'player-duplicate-external-id': {
    message: 'Another player already uses that player ID.',
  },
  'player-invalid': {
    message: 'Some player details are not valid.',
  },
  'team-not-found': {
    message: 'That team could not be found.',
    hint: 'Refresh the team list.',
  },
  'team-name-taken': {
    message: 'Another team already uses that name.',
  },
  'team-not-selected': {
    message: 'Select a team before confirming.',
  },
  'team-insufficient-purse': {
    message: 'This team does not have enough purse left for that price.',
    hint: 'Enter a lower price or select another team.',
  },
  'team-roster-full': {
    message: 'This team has reached the maximum roster size.',
  },
  'team-state-inconsistent': {
    message: 'This team totals are inconsistent and the purchase was blocked.',
    hint: 'Run the consistency check in Settings before continuing.',
  },
  'team-has-purchases': {
    message: 'This team has purchases and cannot be removed.',
    hint: 'Reverse the purchases first.',
  },
  'team-purse-too-low': {
    message: 'The starting purse cannot be lower than the amount this team has already spent.',
    hint: 'Reverse a purchase first, or use a higher starting purse.',
  },
  'invalid-price': {
    message: 'Enter a whole, positive sale price.',
  },
  'purchase-not-found': {
    message: 'That purchase record could not be found.',
  },
  'purchase-already-reversed': {
    message: 'This purchase was already reversed.',
  },
  'purchase-reversal-conflict': {
    message: 'This purchase can no longer be reversed automatically.',
    hint: 'The player record changed after the sale; resolve it manually.',
  },
  'reason-required': {
    message: 'A reason is required for this action.',
  },
  'request-conflict': {
    message: 'A previous request with the same id had a different outcome.',
    hint: 'Reload the page and record the purchase again.',
  },
  'request-id-invalid': {
    message: 'The submission could not be identified. Please retry.',
  },
  'purchases-disabled': {
    message: 'Recording purchases is currently disabled for this event.',
    hint: 'Enable purchases in Settings.',
  },
  'invalid-argument': {
    message: 'Some of the entered values are not valid.',
  },
  'not-found': {
    message: 'The requested record was not found.',
  },
  'already-exists': {
    message: 'That record already exists.',
  },
  'permission-denied': {
    message: 'You do not have permission to do that.',
  },
  'failed-precondition': {
    message: 'That action is not possible right now.',
  },
  internal: {
    message: 'Something went wrong on the server.',
    hint: 'Retry. If it keeps failing, check the Cloud Functions logs.',
  },
  unavailable: {
    message: 'The server is unavailable right now.',
    hint: 'Check your connection and retry.',
  },
  network: {
    message: 'Network unavailable. Changes were not saved.',
    hint: 'Reconnect and retry - nothing was recorded yet.',
  },
  unknown: {
    message: 'Something went wrong.',
    hint: 'Retry the action.',
  },
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

export function appErrorMessage(code: unknown): AppErrorMessage {
  if (isAppErrorCode(code)) return ERROR_MESSAGES[code]
  return ERROR_MESSAGES.unknown
}

/** Serializable error shape crossing the wire between functions and client. */
export interface AppErrorPayload {
  code: AppErrorCode
  message?: string
  details?: Record<string, unknown>
}
