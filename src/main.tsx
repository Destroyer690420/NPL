import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { SetupScreen } from './app/SetupScreen'
import { ToastProvider } from './components/ui/Toast'
import { getFirebase } from './lib/firebase'
import { isFirebaseConfigured } from './lib/config'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found.')

// Without credentials the app never pretends to work: it shows setup steps.
const firebaseReady = isFirebaseConfigured() && getFirebase() !== null

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>{firebaseReady ? <App /> : <SetupScreen />}</ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
