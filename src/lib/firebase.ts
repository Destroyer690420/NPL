import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  browserLocalPersistence,
  setPersistence,
  type Auth,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import {
  EMULATOR_HOST,
  EMULATOR_PORTS,
  appCheckDebugToken,
  appCheckSiteKey,
  functionsRegion,
  readFirebaseConfig,
  useEmulators,
} from './config'

export interface FirebaseServices {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  functions: Functions
}

let services: FirebaseServices | null = null
let initError: Error | null = null

/**
 * Initialises Firebase exactly once. Returns null when the web configuration is
 * missing so that the UI can show setup instructions instead of pretending to
 * work (there is deliberately no fake in-memory fallback).
 */
export function getFirebase(): FirebaseServices | null {
  if (services) return services
  if (initError) return null

  const config = readFirebaseConfig()
  if (!config) return null

  try {
    const app = getApps().length > 0 ? getApps()[0]! : initializeApp(config)

    const auth = getAuth(app)
    void setPersistence(auth, browserLocalPersistence).catch(() => undefined)

    // Long polling behaves better behind restrictive campus networks.
    const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true })

    const functions = getFunctions(app, functionsRegion)

    if (useEmulators) {
      connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, {
        disableWarnings: true,
      })
      connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore)
      connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions)
    }

    if (appCheckSiteKey && typeof window !== 'undefined') {
      void initialiseAppCheck(app, appCheckSiteKey)
    }

    services = { app, auth, db, functions }
    return services
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error))
    return null
  }
}

async function initialiseAppCheck(app: FirebaseApp, siteKey: string): Promise<void> {
  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check')
    if (appCheckDebugToken) {
      ;(window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
        appCheckDebugToken
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    })
  } catch {
    // App Check is optional; a failure must never block the app.
  }
}

export function requireFirebase(): FirebaseServices {
  const value = getFirebase()
  if (!value) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to .env.local and fill in your project values.',
    )
  }
  return value
}

export function getFirebaseInitError(): Error | null {
  return initError
}
