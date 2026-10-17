import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

/**
 * Configuration for emulator-backed test suites (Firestore rules + Cloud Functions).
 * These tests require the Firebase Emulator Suite to be running; they are executed
 * through `npm run test:emulator`, which starts the emulators via
 * `firebase emulators:exec`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./functions/src/shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/emulator/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
})
