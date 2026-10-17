import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readSupabaseConfig } from './config'

/**
 * The single Supabase client (REST + Edge Functions transport).
 *
 * The app deliberately has no fake in-memory fallback: without the public web
 * configuration the UI shows setup instructions instead of pretending to work.
 * No Supabase Auth session is used — admin and team credentials are exchanged
 * for opaque server sessions by the `auction-api` edge function.
 */

let client: SupabaseClient | null = null
let initError: Error | null = null

export function getSupabase(): SupabaseClient | null {
  if (client) return client
  if (initError) return null

  const config = readSupabaseConfig()
  if (!config) return null

  try {
    client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    return client
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error))
    return null
  }
}

export function requireSupabase(): SupabaseClient {
  const value = getSupabase()
  if (!value) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }
  return value
}

export function getSupabaseInitError(): Error | null {
  return initError
}
