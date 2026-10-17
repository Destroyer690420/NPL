import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { SetupScreen } from './app/SetupScreen'
import { ToastProvider } from './components/ui/Toast'
import { getSupabase } from './lib/supabase'
import { isSupabaseConfigured } from './lib/config'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found.')

// Without credentials the app never pretends to work: it shows setup steps.
const supabaseReady = isSupabaseConfigured() && getSupabase() !== null

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>{supabaseReady ? <App /> : <SetupScreen />}</ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
