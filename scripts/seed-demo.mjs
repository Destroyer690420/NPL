#!/usr/bin/env node
/**
 * seed-demo.mjs — opt-in, clearly labelled demo data for development and
 * rehearsal. Never run this against your real event.
 *
 * It signs in as an admin and drives the real callable functions (createEvent,
 * createTeam, createPlayer, recordPurchase), so the demo data follows exactly
 * the same rules as the app itself: correct totals, PIN hashing, audit logs.
 *
 * Usage
 *   node scripts/seed-demo.mjs [options]
 *
 * Options
 *   --id <adminId>           admin ID (default: admin)
 *   --password <pw>          or set ADMIN_PASSWORD in the environment
 *                            (default: admin — the interim shared credentials)
 *   --password-stdin         read the password from one stdin line instead
 *   --emulator               target the local emulator suite (project
 *                            demo-auction). Run `npm run emulators` first.
 *   --event <id>             event id; must be `demo` or start with `demo-`
 *                            (default: demo). This guard prevents seeding a
 *                            real event by accident.
 *   --append                 add to an existing demo event instead of stopping
 *   --purchases <n>          record n demo purchases (default 0). This starts
 *                            the demo event because purchases require the
 *                            event to be active.
 *
 * Non-emulator mode reads the Firebase web config from .env.local / .env
 * (VITE_FIREBASE_*), exactly like the app.
 *
 * Removing demo data: delete the `events/<id>` tree in the Firebase console,
 * or reset the emulator data.
 */

import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithCustomToken } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, collection, getDocs } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'

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
    else if (token === '--emulator') args.flags.emulator = true
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
    const config = {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
      functionsRegion: env.VITE_FUNCTIONS_REGION || 'us-central1',
    }
    if (config.apiKey && config.projectId && config.appId) return config
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

/** Calls a callable and returns its payload; throws Error with .code set. */
function callable(client, name, data) {
  return httpsCallable(client.functions, name)(data)
    .then((response) => response.data)
    .catch((error) => {
      const code = typeof error?.code === 'string' ? error.code.replace(/^functions\//, '') : 'unknown'
      const wrapped = new Error(`[${code}] ${error?.message ?? error}`)
      wrapped.code = code
      throw wrapped
    })
}

/* --------------------------------- main ----------------------------------- */

const args = parseArgs(process.argv.slice(2))
if (args.flags.help) {
  usage()
  process.exit(0)
}

const adminId = (args.flags.id ?? '').trim() || 'admin'

const emulator = args.flags.emulator === true
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

let webConfig
if (emulator) {
  webConfig = {
    apiKey: 'demo-api-key',
    authDomain: '127.0.0.1:9099',
    projectId: 'demo-auction',
    appId: '1:1:web:demo',
    functionsRegion: 'us-central1',
  }
} else {
  webConfig = readWebConfig()
  if (!webConfig) {
    fail(
      'No Firebase web config found. Copy .env.example to .env.local and fill in VITE_FIREBASE_* ' +
        'values, or pass --emulator to use the local emulator suite.',
    )
  }
  console.log(
    `\n! Seeding DEMO data into project "${webConfig.projectId}" (event "${eventId}").\n` +
      '  All names are prefixed "Demo" and the event name starts with [DEMO].\n' +
      '  Press Ctrl+C now if this is the wrong project.\n',
  )
}

const app = initializeApp(webConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const functions = getFunctions(app, webConfig.functionsRegion)

if (emulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}

const client = { app, auth, db, functions }

console.log(`→ Signing in as admin "${adminId}"…`)
let payload
try {
  payload = await callable(client, 'adminLogin', { adminId, password })
} catch (error) {
  fail(
    `Admin login failed: ${error.message}\n\n` +
      (emulator
        ? 'Is the emulator suite running? Start it with `npm run emulators`.\n' +
          'Admin credentials are ADMIN_LOGIN_ID / ADMIN_LOGIN_PASSWORD (default admin/admin).'
        : 'Check the admin ID/password (ADMIN_LOGIN_ID / ADMIN_LOGIN_PASSWORD in functions/.env).'),
  )
}
try {
  await signInWithCustomToken(auth, payload.token)
} catch (error) {
  fail(`Could not establish the admin session: ${error?.message ?? error}`)
}

const claims = (await auth.currentUser.getIdTokenResult()).claims
if (claims.role !== 'admin' && claims.role !== 'superAdmin') {
  fail(`adminLogin returned a session without the admin claim (role=${String(claims.role)}).`)
}

console.log('→ Creating the demo event…')
try {
  const result = await callable(client, 'createEvent', {
    eventId,
    name: '[DEMO] Auction rehearsal',
    currencyLabel: '₹',
    defaultStartingPurse: 100_000,
  })
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

// Existing entities (for --append) are read straight from Firestore; admin
// claims allow this. Fresh entities are created through the callables.
const existingTeams = new Map()
const existingPlayers = new Map()
if (args.flags.append) {
  const teamSnap = await getDocs(collection(db, 'events', eventId, 'teams'))
  teamSnap.forEach((doc) => existingTeams.set(doc.data().name, { id: doc.id, ...doc.data() }))
  const playerSnap = await getDocs(collection(db, 'events', eventId, 'players'))
  playerSnap.forEach((doc) => existingPlayers.set(doc.data().name, { id: doc.id, ...doc.data() }))
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
    const created = await callable(client, 'createTeam', {
      eventId,
      name: team.name,
      startingPurse: team.startingPurse,
    })
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
    const created = await callable(client, 'createPlayer', { eventId, ...player })
    playerIds.push({ id: created.playerId, status: 'available', basePrice: player.basePrice })
  } catch (error) {
    fail(`createPlayer(${player.name}) failed: ${error.message}`)
  }
}

if (purchasesRequested > 0) {
  console.log(`→ Starting the demo event and recording ${purchasesRequested} purchase(s)…`)
  try {
    await callable(client, 'updateEvent', { eventId, status: 'active' })
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
      await callable(client, 'recordPurchase', {
        eventId,
        playerId: player.id,
        teamId,
        finalPrice: player.basePrice + 2_000,
        requestId: randomUUID(),
      })
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
console.log('Remove demo data: delete the events/' + eventId + ' tree in the Firebase console.\n')
process.exit(0)
