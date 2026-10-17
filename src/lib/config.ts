/** Client configuration read from Vite environment variables. */

export interface SupabaseWebConfig {
  url: string
  /** Publishable (or legacy anon) key — a public identifier, not a secret. */
  anonKey: string
}

function read(key: string): string {
  const value = import.meta.env[key as keyof ImportMetaEnv]
  return typeof value === 'string' ? value.trim() : ''
}

export function readSupabaseConfig(): SupabaseWebConfig | null {
  const config: SupabaseWebConfig = {
    url: read('VITE_SUPABASE_URL'),
    // Both the new-style publishable key and the legacy anon key are accepted.
    anonKey: read('VITE_SUPABASE_ANON_KEY') || read('VITE_SUPABASE_PUBLISHABLE_KEY'),
  }
  if (config.url === '' || config.anonKey === '') return null
  if (!/^https?:\/\//.test(config.url)) return null
  return config
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig() !== null
}

export function missingSupabaseKeys(): string[] {
  const keys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const
  return keys.filter((key) => {
    if (key === 'VITE_SUPABASE_ANON_KEY') {
      return read('VITE_SUPABASE_ANON_KEY') === '' && read('VITE_SUPABASE_PUBLISHABLE_KEY') === ''
    }
    return read(key) === ''
  })
}

/** Edge function that carries every auction action. */
export const auctionFunctionName = read('VITE_AUCTION_FUNCTION_NAME') || 'auction-api'

/** Optional: override the event id used by the app (defaults to the public config). */
export const defaultEventIdOverride = read('VITE_DEFAULT_EVENT_ID') || null

/** How often live pages re-fetch their data (polling replaces realtime). */
export const pollIntervalMs = 4000
