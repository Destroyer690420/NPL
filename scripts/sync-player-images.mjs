#!/usr/bin/env node
/**
 * sync-player-images.mjs
 *
 * Downloads all player headshot images from external links in players.csv,
 * verifies each image, saves them locally in public/player-images/, and uploads
 * them directly to Supabase Storage (bucket: player-images).
 *
 * This provides:
 *  1. Super fast loading from Supabase CDN or local web-root
 *  2. Zero reliance on third-party hostnames that rate-limit or fail
 *  3. Automatic cleanup of 403 / 404 broken links
 *
 * Usage:
 *   node scripts/sync-player-images.mjs [options]
 *
 * Options:
 *   --service-key <key>     Supabase service_role key (bypasses RLS to create
 *                           bucket and upload). Can also be set in .env.local
 *                           as SUPABASE_SERVICE_ROLE_KEY.
 *   --concurrency <number>  Max parallel downloads (default: 8)
 *   --local-only            Download to public/player-images/ only, skip Supabase upload
 *   --csv <path>            Path to CSV file (default: players.csv)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const ROOT = path.resolve(import.meta.dirname, '..')

function readEnvFile(file) {
  if (!existsSync(file)) return {}
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

function parseArgs(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--service-key') flags.serviceKey = argv[++i]
    else if (token === '--concurrency') flags.concurrency = Number(argv[++i])
    else if (token === '--local-only') flags.localOnly = true
    else if (token === '--csv') flags.csv = argv[++i]
  }
  return flags
}

async function runPool(items, limit, fn) {
  const results = new Array(items.length)
  let currentIndex = 0

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++
      results[index] = await fn(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

async function fetchImageBuffer(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        },
      })
      clearTimeout(timeout)

      if (!res.ok) {
        return { ok: false, status: res.status }
      }

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('image/') && !contentType.includes('octet-stream')) {
        return { ok: false, status: `invalid-content-type (${contentType})` }
      }

      const arrayBuf = await res.arrayBuffer()
      const buffer = Buffer.from(arrayBuf)
      if (buffer.length < 500) {
        // Many error responses (e.g. XML Access Denied) are < 500 bytes
        const text = buffer.toString('utf8', 0, 50)
        if (text.includes('<?xml') || text.includes('<Error') || text.includes('<!DOCTYPE')) {
          return { ok: false, status: 'error-xml' }
        }
      }

      return { ok: true, buffer, contentType: contentType.includes('image/') ? contentType : 'image/png' }
    } catch (err) {
      if (attempt === retries) {
        return { ok: false, status: err.name === 'AbortError' ? 'timeout' : err.message }
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  return { ok: false, status: 'failed' }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const localEnv = {
    ...readEnvFile(path.join(ROOT, '.env')),
    ...readEnvFile(path.join(ROOT, '.env.local')),
  }

  const supabaseUrl = (localEnv.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  const serviceKey = flags.serviceKey || localEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const anonKey = localEnv.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  const keyToUse = serviceKey || anonKey

  const csvPath = path.resolve(ROOT, flags.csv || 'players.csv')
  if (!existsSync(csvPath)) {
    console.error(`\n✖ Could not find CSV file at ${csvPath}\n`)
    process.exit(1)
  }

  console.log('\n======================================================')
  console.log('  Nexturn Premier League — Player Image Sync')
  console.log('======================================================\n')

  const publicImagesDir = path.join(ROOT, 'public', 'player-images')
  mkdirSync(publicImagesDir, { recursive: true })

  // Initialize Supabase client if possible
  let supabase = null
  let supabaseStorageReady = false

  if (!flags.localOnly && supabaseUrl && keyToUse) {
    supabase = createClient(supabaseUrl, keyToUse)
    console.log(`Connecting to Supabase Storage: ${supabaseUrl}`)

    // Test or create player-images bucket
    const { data: bucketData, error: bucketErr } = await supabase.storage.createBucket('player-images', {
      public: true,
      fileSizeLimit: 5242880,
    })

    if (!bucketErr || bucketErr.message?.includes('already exists')) {
      supabaseStorageReady = true
      console.log('✔ Supabase Storage bucket "player-images" is ready for upload.\n')
    } else {
      console.warn(`⚠ Notice on Supabase Storage bucket: ${bucketErr.message}`)
      if (!serviceKey) {
        console.warn('  Tip: You can provide --service-key <key> or set SUPABASE_SERVICE_ROLE_KEY in .env.local')
        console.warn('  to allow direct bucket creation and uploads.\n')
      }
    }
  }

  // Parse CSV
  const csvContent = readFileSync(csvPath, 'utf8')
  const lines = csvContent.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) {
    console.error('✖ CSV contains no player rows.')
    process.exit(1)
  }

  const header = lines[0].split(',').map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    // Parse CSV line taking quotes into account
    const cells = []
    let current = ''
    let insideQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        insideQuotes = !insideQuotes
      } else if (char === ',' && !insideQuotes) {
        cells.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    cells.push(current.trim())
    return cells
  })

  const concurrency = flags.concurrency || 8
  console.log(`Found ${rows.length} players. Processing images (concurrency: ${concurrency})...\n`)

  let downloadedCount = 0
  let uploadedCount = 0
  let failedCount = 0
  let emptyCount = 0

  const processedRows = await runPool(rows, concurrency, async (row, index) => {
    const playerId = row[0]?.trim() || `P${String(index + 1).padStart(3, '0')}`
    const playerName = row[1]?.trim() || 'Unknown'
    const points = row[2]?.trim() || '0'
    const basePrice = row[3]?.trim() || '0'
    const rawUrl = (row[4] || '').trim()

    // If already empty or missing
    if (!rawUrl) {
      emptyCount++
      return { row: [playerId, playerName, points, basePrice, ''], localUrl: '', supabaseUrl: '' }
    }

    let buffer = null
    const filename = `${playerId}.png`
    const localFilePath = path.join(publicImagesDir, filename)

    if (rawUrl.startsWith('/player-images/') && existsSync(localFilePath)) {
      buffer = readFileSync(localFilePath)
      downloadedCount++
    } else if (rawUrl.startsWith('/player-images/')) {
      return { row: [playerId, playerName, points, basePrice, rawUrl], localUrl: rawUrl, supabaseUrl: '' }
    } else {
      // Fetch image
      const fetchResult = await fetchImageBuffer(rawUrl)
      if (!fetchResult.ok) {
        failedCount++
        process.stdout.write(`  ✖ [${playerId}] ${playerName.padEnd(20)}: ${fetchResult.status}\n`)
        // Clean up broken link to empty string so initials display cleanly
        return { row: [playerId, playerName, points, basePrice, ''], localUrl: '', supabaseUrl: '' }
      }
      buffer = fetchResult.buffer
      downloadedCount++
      writeFileSync(localFilePath, buffer)
    }

    let finalUrl = `/player-images/${filename}`
    let supabasePublicUrl = ''

    // Upload to Supabase Storage if available
    if (supabase && supabaseStorageReady && buffer) {
      try {
        const { error: uploadErr } = await supabase.storage
          .from('player-images')
          .upload(filename, buffer, {
            contentType: 'image/png',
            upsert: true,
          })

        if (!uploadErr) {
          uploadedCount++
          supabasePublicUrl = `${supabaseUrl}/storage/v1/object/public/player-images/${filename}`
          finalUrl = supabasePublicUrl
          process.stdout.write(`  ✔ [${playerId}] ${playerName.padEnd(20)}: uploaded to Supabase Storage\n`)
        } else {
          process.stdout.write(`  ⚠ [${playerId}] ${playerName.padEnd(20)}: upload error (${uploadErr.message})\n`)
        }
      } catch (err) {
        process.stdout.write(`  ⚠ [${playerId}] ${playerName.padEnd(20)}: upload error (${err.message})\n`)
      }
    } else {
      process.stdout.write(`  ✔ [${playerId}] ${playerName.padEnd(20)}: saved to /player-images/${filename}\n`)
    }

    return {
      row: [playerId, playerName, points, basePrice, finalUrl],
      localUrl: `/player-images/${filename}`,
      supabaseUrl: supabasePublicUrl || `${supabaseUrl}/storage/v1/object/public/player-images/${filename}`,
    }
  })

  console.log('\n------------------------------------------------------')
  console.log(`Processing complete:`)
  console.log(`  - Total players: ${rows.length}`)
  console.log(`  - Successfully downloaded & saved locally: ${downloadedCount}`)
  if (supabaseStorageReady) {
    console.log(`  - Successfully uploaded to Supabase: ${uploadedCount}`)
  }
  console.log(`  - Inaccessible / 403 / 404 links cleaned up: ${failedCount}`)
  console.log(`  - Players without images (initials badge): ${emptyCount + failedCount}`)
  console.log('------------------------------------------------------\n')

  // Backup original CSV
  const backupPath = path.resolve(ROOT, 'players.csv.original.bak')
  if (!existsSync(backupPath)) {
    writeFileSync(backupPath, csvContent, 'utf8')
    console.log(`Original CSV backed up to: ${path.basename(backupPath)}`)
  }

  // Write updated players.csv
  const newCsvContent = [
    header.join(','),
    ...processedRows.map((r) => r.row.join(',')),
  ].join('\r\n')
  writeFileSync(csvPath, newCsvContent, 'utf8')
  console.log(`Updated CSV saved to: ${path.basename(csvPath)}`)

  // Write dedicated players_local.csv and players_supabase.csv for flexibility
  const localCsvContent = [
    header.join(','),
    ...processedRows.map((r) => [r.row[0], r.row[1], r.row[2], r.row[3], r.localUrl].join(',')),
  ].join('\r\n')
  writeFileSync(path.resolve(ROOT, 'players_local.csv'), localCsvContent, 'utf8')
  console.log(`Local static paths CSV saved to: players_local.csv`)

  if (supabaseUrl) {
    const supabaseCsvContent = [
      header.join(','),
      ...processedRows.map((r) => [
        r.row[0],
        r.row[1],
        r.row[2],
        r.row[3],
        r.localUrl ? `${supabaseUrl}/storage/v1/object/public/player-images/${r.row[0]}.png` : '',
      ].join(',')),
    ].join('\r\n')
    writeFileSync(path.resolve(ROOT, 'players_supabase.csv'), supabaseCsvContent, 'utf8')
    console.log(`Supabase Storage URLs CSV saved to: players_supabase.csv`)
  }

  console.log('\n✔ All images are ready and organized!')
}

main().catch((err) => {
  console.error('\n✖ Fatal error:', err)
  process.exit(1)
})
