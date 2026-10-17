#!/usr/bin/env node
/**
 * seed-demo.mjs — opt-in, clearly labelled demo data for development and
 * rehearsal. Never run this against your real event.
 *
 * It signs in as the admin and drives the real `auction-api` edge function
 * (createEvent, createTeam, createPlayer, recordPurchase), so the demo data
 * follows exactly the same rules as the app itself: correct totals, PIN
 * hashing, audit logs.
 *
 * Usage
 *   node scripts/seed-demo.mjs [options]
 *
 * Options
 *   --id <adminId>           admin ID (default: admin)
 *   --password <pw>          or set ADMIN_PASSWORD in the environment
 *                            (default: admin — the interim shared credentials)
 *   --password-stdin         read the password from one stdin line instead
 *   --event <id>             event id; must be `demo` or start with `demo-`
 *                            (default: demo). This guard prevents seeding a
 *                            real event by accident.
 *   --append                 add to an existing demo event instead of stopping
 *   --purchases <n>          record n demo purchases (default 0). This starts
 *                            the demo event because purchases require the
 *                            event to be active.
 *
 * The Supabase project URL and publishable key are read from .env.local /
 * .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY), exactly like the app.
 *
 * Removing demo data: in the Supabase Table Editor delete the rows where
 * event_id = 'demo' from teams, players, purchases, audit_logs and
 * team_secrets, then delete the `demo` row from events and clear
 * app_config.defaultEventId if it points at it.
 */

import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')

const TEAMS = [
  { name: 'Demo Titans', startingPurse: 100_000 },
  { name: 'Demo Royals', startingPurse: 100_000 },
  { name: 'Demo Chargers', startingPurse: 100_000 },
  { name: 'Demo Blasters', startingPurse: 100_000 },
]

const PLAYERS = Array.from({ length: 12 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0')
  return {
    name: `Demo Player ${number}`,
    points: 100 + ((index * 37) % 200),
    basePrice: 5_000 + ((index * 2_500) % 20_000),
  }
})

/* ------------------------------ tiny helpers ------------------------------ */

function fail(message, code = 1) {
  console.error(`\n✖ ${message}\n`)
  process.exit(code)
}

function usage() {
  const lines = readFileSync(new URL(import.meta.url))
    .toString()
    .split('\n')
    .map((line) => line.trimEnd())
  const start = lines.findIndex((line) => line.startsWith('/**'))
  if (start === -1) return
  const header = []
  for (const line of lines.slice(start)) {
    if (line === ' */') break
    if (header.length > 0 && !line.startsWith(' *')) break
    header.push(line.replace(/^\/\*\*/, '').replace(/^ \*( ?)/, ''))
  }
  console.log(header.join('\n').trimStart())
}

function parseArgs(argv) {
  const args = { flags: {}, positional: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') args.flags.help = true
    else if (token === '--append') args.flags.append = true
    else if (token === '--password-stdin') args.flags.passwordStdin = true
    else if (token === '--id') args.flags.id = argv[++i]
    else if (token === '--password') args.flags.password = argv[++i]
    else if (token === '--event') args.flags.event = argv[++i]
    else if (token === '--purchases') args.flags.purchases = Number(argv[++i])
    else if (token.startsWith('--')) fail(`Unknown option: ${token}`)
    else args.positional.push(token)
  }
  return args
}

function readEnvFile(file) {
  if (!existsSync(file)) return null
  const values = {}
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return values
}

function readWebConfig() {
  for (const file of ['.env.local', '.env']) {
    const env = readEnvFile(path.join(ROOT, file))
    if (!env) continue
    const url = env.VITE_SUPABASE_URL
    const anonKey = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY
    const functionName = env.VITE_AUCTION_FUNCTION_NAME || 'auction-api'
    if (url && anonKey) return { url: url.replace(/\/+$/, ''), anonKey, functionName }
  }
  return null
}

async function readStdinLine() {
  let data = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    data += chunk
    if (data.includes('\n')) break
  }
  return data.split(/\r?\n/)[0] ?? ''
}

/* -------------------------------- transport ------------------------------- */

function makeClient(config) {
  const { url, anonKey, functionName } = config
  const headers = {
    'content-type': 'application/json',
    apikey: anonKey,
    authorization: `Bearer ${anonKey}`,
  }

  /** Calls an auction-api action; throws Error with .code set. */
  async function callable(name, input, token) {
    const response = await fetch(`${url}/functions/v1/${functionName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: name, input, token: token ?? null }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body) {
      const error = new Error(`Unexpected response (HTTP ${response.status}).`)
      error.code = 'unavailable'
      throw error
    }
    if (body.ok !== true) {
      const error = new Error(body.error?.message ?? 'The server rejected the request.')
      error.code = typeof body.error?.code === 'string' ? body.error.code : 'unknown'
      throw error
    }
    return body.data
  }

  /** Reads an admin resource through the read API (anon key + admin token). */
  async function adminRead(resource, params, token) {
    const response = await fetch(`${url}/rest/v1/rpc/api_admin_read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_token: token, p_resource: resource, p_params: params ?? {} }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || body === null) {
      const error = new Error(`Read failed (HTTP ${response.status}).`)
      error.code = 'unavailable'
      throw error
    }
    return body
  }

  return { callable, adminRead }
}

/* --------------------------------- main ----------------------------------- */

const args = parseArgs(process.argv.slice(2))
if (args.flags.help) {
  usage()
  process.exit(0)
}

const adminId = (args.flags.id ?? '').trim() || 'admin'

const eventId = args.flags.event ?? 'demo'
if (!/^demo(-|$)/.test(eventId)) {
  fail(
    `Refusing to seed event "${eventId}": demo seeding is limited to event ids "demo" or "demo-*" ` +
      'so that a real event can never be polluted with demo data.',
  )
}
const purchasesRequested = Number.isInteger(args.flags.purchases) ? args.flags.purchases : 0
if (purchasesRequested < 0 || purchasesRequested > 12) {
  fail('--purchases must be between 0 and 12.')
}

// Interim shared credentials: defaults to admin/admin, overridable like the app.
let password = args.flags.password ?? process.env.ADMIN_PASSWORD ?? 'admin'
if (args.flags.passwordStdin) {
  password = (await readStdinLine()).trim()
}

const webConfig = readWebConfig()
if (!webConfig) {
  fail(
    'No Supabase web config found. Copy .env.example to .env.local and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

console.log(
  `\n! Seeding DEMO data into "${webConfig.url}" (event "${eventId}").\n` +
    '  All names are prefixed "Demo" and the event name starts with [DEMO].\n' +
    '  Press Ctrl+C now if this is the wrong project.\n',
)

const client = makeClient(webConfig)

console.log(`→ Signing in as admin "${adminId}"…`)
let login
try {
  login = await client.callable('adminLogin', { adminId, password }, null)
} catch (error) {
  fail(
    `Admin login failed: ${error.message}\n\n` +
      'Check the admin ID/password (ADMIN_LOGIN_ID / ADMIN_LOGIN_PASSWORD secrets of the ' +
      'auction-api edge function; defaults admin/admin).',
  )
}
const token = login.token
if (typeof token !== 'string' || token === '') {
  fail('adminLogin returned no session token.')
}

console.log('→ Creating the demo event…')
try {
  const result = await client.callable(
    'createEvent',
    {
      eventId,
      name: '[DEMO] Auction rehearsal',
      currencyLabel: '₹',
      defaultStartingPurse: 100_000,
    },
    token,
  )
  console.log(
    `  ✓ event "${result.eventId}" created` +
      (result.setAsDefault ? ' (now the default event)' : ''),
  )
} catch (error) {
  if (error.code === 'already-exists' && args.flags.append) {
    console.log(`  • event "${eventId}" already exists — continuing in --append mode`)
  } else if (error.code === 'already-exists') {
    fail(
      `Event "${eventId}" already exists. Re-run with --append to add missing demo entities, ` +
        'or delete the event in the admin panel first.',
    )
  } else {
    fail(`createEvent failed: ${error.message}`)
  }
}

// Existing entities (for --append) are read through the admin read API.
const existingTeams = new Map()
const existingPlayers = new Map()
if (args.flags.append) {
  const teamRows = await client.adminRead('teams', { eventId }, token)
  for (const row of teamRows) existingTeams.set(row.name, row)
  const playerRows = await client.adminRead('players', { eventId }, token)
  for (const row of playerRows) existingPlayers.set(row.name, row)
}

console.log('→ Creating demo teams…')
const pinLines = []
const teamIds = []
for (const team of TEAMS) {
  const existing = existingTeams.get(team.name)
  if (existing) {
    teamIds.push(existing.id)
    pinLines.push(`    ${team.name.padEnd(18)} existing team — PIN unchanged (reset in the admin panel if needed)`)
    continue
  }
  try {
    const created = await client.callable(
      'createTeam',
      { eventId, name: team.name, startingPurse: team.startingPurse },
      token,
    )
    teamIds.push(created.teamId)
    pinLines.push(`    ${team.name.padEnd(18)} PIN ${created.pin}   (teamId ${created.teamId})`)
  } catch (error) {
    if (error.code === 'team-name-taken' && args.flags.append) continue
    fail(`createTeam(${team.name}) failed: ${error.message}`)
  }
}

console.log('→ Creating demo players…')
const playerIds = []
for (const player of PLAYERS) {
  const existing = existingPlayers.get(player.name)
  if (existing) {
    playerIds.push({ id: existing.id, status: existing.status, basePrice: existing.basePrice })
    continue
  }
  try {
    const created = await client.callable('createPlayer', { eventId, ...player }, token)
    playerIds.push({ id: created.playerId, status: 'available', basePrice: player.basePrice })
  } catch (error) {
    fail(`createPlayer(${player.name}) failed: ${error.message}`)
  }
}

if (purchasesRequested > 0) {
  console.log(`→ Starting the demo event and recording ${purchasesRequested} purchase(s)…`)
  try {
    await client.callable('updateEvent', { eventId, status: 'active' }, token)
  } catch (error) {
    fail(`Could not start the demo event: ${error.message}`)
  }

  const available = playerIds.filter((player) => player.status === 'available').slice(0, purchasesRequested)
  if (available.length < purchasesRequested) {
    console.log(`  • only ${available.length} unsold demo player(s) left`)
  }
  let recorded = 0
  for (let index = 0; index < available.length; index += 1) {
    const player = available[index]
    const teamId = teamIds[index % teamIds.length]
    try {
      await client.callable(
        'recordPurchase',
        { eventId, playerId: player.id, teamId, finalPrice: player.basePrice + 2_000, requestId: randomUUID() },
        token,
      )
      recorded += 1
    } catch (error) {
      console.log(`  • skipped ${player.id}: ${error.message}`)
    }
  }
  console.log(`  ✓ ${recorded} purchase(s) recorded`)
}

console.log('\n──────────────────────────────  DEMO SEED COMPLETE  ──────────────────────────────')
console.log(`Event:   ${eventId}  ("[DEMO] Auction rehearsal" — safe to delete)`)
console.log(`Teams:   ${teamIds.length}   Players: ${playerIds.length}   Purchases: ${purchasesRequested > 0 ? purchasesRequested : 0}`)
console.log('\nTeam PINs (shown once — reset any PIN from the admin panel at any time):')
for (const line of pinLines) console.log(line)
console.log('\nOpen the app, sign in as admin, and the demo event is ready.')
console.log('Team panels: choose the team and enter its PIN.')
console.log("Remove demo data: in the Supabase Table Editor delete rows with event_id = 'demo'")
console.log('from teams, players, purchases, audit_logs and team_secrets, then the events row.\n')
process.exit(0)
