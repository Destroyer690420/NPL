/** Client configuration read from Vite environment variables. */

export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

function read(key: string): string {
  const value = import.meta.env[key as keyof ImportMetaEnv]
  return typeof value === 'string' ? value.trim() : ''
}

export function readFirebaseConfig(): FirebaseWebConfig | null {
  const config: FirebaseWebConfig = {
    apiKey: read('VITE_FIREBASE_API_KEY'),
    authDomain: read('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: read('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: read('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: read('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: read('VITE_FIREBASE_APP_ID'),
  }

  const required: Array<keyof FirebaseWebConfig> = ['apiKey', 'authDomain', 'projectId', 'appId']
  const missing = required.filter((key) => config[key] === '')
  if (missing.length > 0) return null
  return config
}

export function isFirebaseConfigured(): boolean {
  return readFirebaseConfig() !== null
}

export function missingFirebaseKeys(): string[] {
  const keys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
  ] as const
  return keys.filter((key) => read(key) === '')
}

export const useEmulators = read('VITE_USE_FIREBASE_EMULATORS') === 'true'
export const appCheckSiteKey = read('VITE_APP_CHECK_SITE_KEY') || null
export const appCheckDebugToken = read('VITE_APP_CHECK_DEBUG_TOKEN') || null
export const defaultEventIdOverride = read('VITE_DEFAULT_EVENT_ID') || null
export const functionsRegion = read('VITE_FUNCTIONS_REGION') || 'us-central1'

export const EMULATOR_HOST = '127.0.0.1'
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, functions: 5001 } as const
