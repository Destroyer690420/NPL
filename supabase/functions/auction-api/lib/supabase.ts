import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service client used inside the Edge Function.
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by the
 * platform into every Edge Function; the service role key never reaches the
 * browser. All table access from this client bypasses RLS, which is why the
 * database tables themselves deny every anonymous request.
 */

function env(key: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno
  return deno?.env?.get(key)
}

const url = env('SUPABASE_URL')
const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY')

if (!url || !serviceRoleKey) {
  // Surfaced as a clear error on the first request instead of crashing import.
  console.error('[error] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available in this runtime.')
}

export const supabase: SupabaseClient = createClient(url ?? '', serviceRoleKey ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

export function readEnv(key: string): string | undefined {
  return env(key)
}
