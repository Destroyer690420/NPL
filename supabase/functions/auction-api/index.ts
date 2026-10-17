import { ALLOWED_ORIGINS } from './lib/config.ts'
import { invokeCallable, type Descriptor } from './lib/callables.ts'
import { logger } from './lib/logger.ts'
import { ensurePinSecret } from './lib/pin.ts'
import { adminLogin } from './handlers/adminAuth.ts'
import { getTeamContext, logoutTeamSession, verifyTeamPin } from './handlers/teamAuth.ts'
import { createTeam, getTeamPinStatus, resetTeamPin, revokeSessions, updateTeam } from './handlers/teams.ts'
import { createPlayer, importPlayers, setPlayerStatus, updatePlayer } from './handlers/players.ts'
import { recordPurchase, reversePurchase } from './handlers/purchases.ts'
import { checkEventConsistency, createEvent, setDefaultEvent, updateEvent } from './handlers/event.ts'

/**
 * Auction API Edge Function.
 *
 * Single entry point replacing the Firebase callables. Requests are
 * `POST { action, input, token }`; the response is always the JSON envelope
 * `{ ok: true, data }` or `{ ok: false, error: { code, message,
 * retryAfterSeconds? } }` — the same machine readable codes the client already
 * knows. Authorization is decided server-side inside `invokeCallable`.
 */

const registry: Record<string, Descriptor> = {
  // auth
  adminLogin,
  verifyTeamPin,
  getTeamContext,
  logoutTeamSession,
  // teams
  createTeam,
  updateTeam,
  resetTeamPin,
  revokeSessions,
  getTeamPinStatus,
  // players
  createPlayer,
  updatePlayer,
  setPlayerStatus,
  importPlayers,
  // purchases
  recordPurchase,
  reversePurchase,
  // events
  createEvent,
  updateEvent,
  checkEventConsistency,
  setDefaultEvent,
}

function buildCorsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
  const origin = request.headers.get('origin')
  if (ALLOWED_ORIGINS.length === 0) {
    headers['access-control-allow-origin'] = '*'
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['access-control-allow-origin'] = origin
  } else {
    headers['access-control-allow-origin'] = ALLOWED_ORIGINS[0] ?? '*'
  }
  return headers
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip')
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

Deno.serve(async (request) => {
  const cors = buildCorsHeaders(request)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
  if (request.method !== 'POST') {
    return jsonResponse(
      { ok: false, error: { code: 'invalid-argument', message: 'Use POST.' } },
      405,
      cors,
    )
  }

  let body: { action?: unknown; input?: unknown; token?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonResponse(
      { ok: false, error: { code: 'invalid-argument', message: 'The request body must be JSON.' } },
      400,
      cors,
    )
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const descriptor = registry[action]
  if (!descriptor) {
    // Always a 200 with the error envelope so the client can parse every reply.
    return jsonResponse(
      { ok: false, error: { code: 'not-found', message: `Unknown action: ${action}` } },
      200,
      cors,
    )
  }

  // Best effort: actions that need the PIN secret fail cleanly on their own.
  await ensurePinSecret().catch((error: unknown) => {
    logger.warn('PIN secret initialization skipped', {
      message: error instanceof Error ? error.message : String(error),
    })
  })

  const result = await invokeCallable(action, descriptor, body.input, {
    token: typeof body.token === 'string' ? body.token : null,
    ip: clientIp(request),
  })
  return jsonResponse(result, 200, cors)
})
