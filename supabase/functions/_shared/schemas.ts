import { z } from 'zod'
import {
  MAX_AMOUNT,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_POINTS,
  MAX_REASON_LENGTH,
  MAX_ROSTER_SIZE_LIMIT,
  MAX_URL_LENGTH,
  MIN_REASON_LENGTH,
  PIN_LENGTH,
  REQUEST_ID_PATTERN,
} from './constants.ts'
import { isValidHttpUrl } from './text.ts'

/**
 * Zod schemas for every privileged Cloud Function input. The server always
 * re-validates; client side validation is only a convenience.
 */

export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identifiers may only contain letters, numbers, "-" and "_".')

export const pinSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^[0-9]{${PIN_LENGTH}}$`), `PIN must be exactly ${PIN_LENGTH} digits.`)

export const eventNameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH)

const nonNegativeAmount = z
  .number()
  .int('Must be a whole number.')
  .min(0, 'Must not be negative.')
  .max(MAX_AMOUNT)

const positiveAmount = z
  .number()
  .int('Must be a whole number.')
  .min(1, 'Must be greater than zero.')
  .max(MAX_AMOUNT)

const pointsValue = z
  .number()
  .min(0, 'Must not be negative.')
  .max(MAX_POINTS)

const optionalUrl = z
  .union([z.string().trim().max(MAX_URL_LENGTH), z.null()])
  .optional()
  .refine((value) => value === null || value === undefined || isValidHttpUrl(value), {
    message: 'Must be a valid http(s) URL.',
  })

const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional()

export const reasonSchema = z
  .string()
  .trim()
  .min(MIN_REASON_LENGTH, 'A reason is required.')
  .max(MAX_REASON_LENGTH)

export const requestIdSchema = z
  .string()
  .trim()
  .regex(REQUEST_ID_PATTERN, 'Invalid request identifier.')

/* ------------------------------- team PIN --------------------------------- */

export const verifyTeamPinSchema = z.object({
  pin: pinSchema,
  eventId: idSchema.optional(),
})

/* ------------------------------ admin login ------------------------------- */

export const adminLoginSchema = z.object({
  adminId: z.string().trim().min(1, 'Enter the admin ID.').max(64, 'That admin ID is too long.'),
  password: z.string().min(1, 'Enter the password.').max(200, 'That password is too long.'),
})

/* -------------------------------- teams ---------------------------------- */

export const createTeamSchema = z.object({
  eventId: idSchema,
  name: eventNameSchema,
  startingPurse: nonNegativeAmount,
  logoUrl: optionalUrl,
})

export const updateTeamSchema = z.object({
  eventId: idSchema,
  teamId: idSchema,
  name: eventNameSchema.optional(),
  logoUrl: optionalUrl,
  active: z.boolean().optional(),
  startingPurse: nonNegativeAmount.optional(),
  reason: z.union([z.string().trim().max(MAX_REASON_LENGTH), z.null()]).optional(),
})

export const teamIdSchema = z.object({
  eventId: idSchema,
  teamId: idSchema,
})

export const revokeTeamSessionsSchema = z.object({
  eventId: idSchema,
  teamId: idSchema,
  reason: z.union([z.string().trim().max(MAX_REASON_LENGTH), z.null()]).optional(),
})

/* ------------------------------- players --------------------------------- */

export const createPlayerSchema = z.object({
  eventId: idSchema,
  name: eventNameSchema,
  points: pointsValue,
  basePrice: nonNegativeAmount.optional().default(0),
  photoUrl: optionalUrl,
  externalReference: optionalText(120),
  notes: optionalText(MAX_NOTES_LENGTH),
  status: z.enum(['available', 'withdrawn']).optional(),
  nationality: optionalText(100),
  role: optionalText(100),
  star: optionalText(50),
  sortOrder: z.number().int().min(0).optional(),
})

export const updatePlayerSchema = z.object({
  eventId: idSchema,
  playerId: idSchema,
  name: eventNameSchema.optional(),
  points: pointsValue.optional(),
  basePrice: nonNegativeAmount.optional(),
  photoUrl: optionalUrl,
  externalReference: optionalText(120),
  notes: optionalText(MAX_NOTES_LENGTH),
  status: z.enum(['available', 'withdrawn']).optional(),
  nationality: optionalText(100),
  role: optionalText(100),
  star: optionalText(50),
  sortOrder: z.number().int().min(0).optional(),
  reason: z.union([z.string().trim().max(MAX_REASON_LENGTH), z.null()]).optional(),
})

export const importPlayersSchema = z.object({
  eventId: idSchema,
  players: z
    .array(
      z.object({
        name: eventNameSchema,
        points: pointsValue,
        basePrice: nonNegativeAmount.optional().default(0),
        photoUrl: optionalUrl,
        externalReference: optionalText(120),
        nationality: optionalText(100),
        role: optionalText(100),
        star: optionalText(50),
        sortOrder: z.number().int().min(0).optional(),
      }),
    )
    .min(1, 'No players to import.')
    .max(400, 'Import at most 400 players at a time.'),
  mode: z.enum(['skip-duplicates', 'fail']).optional(),
})

export const setPlayerStatusSchema = z.object({
  eventId: idSchema,
  playerId: idSchema,
  status: z.enum(['available', 'withdrawn']),
})

/* ------------------------------ purchases -------------------------------- */

export const recordPurchaseSchema = z.object({
  eventId: idSchema,
  playerId: idSchema,
  teamId: idSchema,
  finalPrice: positiveAmount,
  requestId: requestIdSchema,
})

export const reversePurchaseSchema = z.object({
  eventId: idSchema,
  purchaseId: idSchema,
  reason: reasonSchema,
})

/* -------------------------------- event ---------------------------------- */

export const createEventSchema = z.object({
  eventId: idSchema.optional(),
  name: eventNameSchema,
  currencyLabel: z.string().trim().min(1).max(12),
  defaultStartingPurse: nonNegativeAmount,
})

export const updateEventSchema = z.object({
  eventId: idSchema,
  name: eventNameSchema.optional(),
  currencyLabel: z.string().trim().min(1).max(12).optional(),
  defaultStartingPurse: nonNegativeAmount.optional(),
  maxRosterSize: z
    .union([z.number().int().min(1).max(MAX_ROSTER_SIZE_LIMIT), z.null()])
    .optional(),
  purchasesEnabled: z.boolean().optional(),
  status: z.enum(['setup', 'active', 'finalized']).optional(),
  reason: z.union([z.string().trim().max(MAX_REASON_LENGTH), z.null()]).optional(),
})

export const eventIdSchema = z.object({ eventId: idSchema })

export const setSpotlightPlayerSchema = z.object({
  eventId: idSchema,
  playerId: z.union([idSchema, z.null()]),
})
export type SetSpotlightPlayerInput = z.infer<typeof setSpotlightPlayerSchema>

export const setAuctionCountdownSchema = z.object({
  eventId: idSchema,
  targetTime: z.union([z.string().trim(), z.null()]),
  durationSeconds: z.union([z.number().int().positive(), z.null()]),
  message: z.union([z.string().trim().max(100), z.null()]).optional(),
})
export type SetAuctionCountdownInput = z.infer<typeof setAuctionCountdownSchema>

export const setAuctionBreakSchema = z.object({
  eventId: idSchema,
  active: z.boolean(),
  message: z.union([z.string().trim().max(200), z.null()]).optional(),
  resumeTime: z.union([z.string().trim().max(100), z.null()]).optional(),
})
export type SetAuctionBreakInput = z.infer<typeof setAuctionBreakSchema>

export interface SchemaIssue {
  message: string
  path: Array<string | number | symbol>
}

/** Returns a single human readable message for the first validation issue. */
export function firstIssueMessage(error: { issues: readonly SchemaIssue[] }): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid input.'
  const path = issue.path.filter((p) => typeof p !== 'symbol').join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}
