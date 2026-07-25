import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { StoreProvider } from './state/store.jsx'
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx'
import { DriveProvider } from './drive/DriveProvider.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import UpdateBanner from './components/UpdateBanner.jsx'
import { AUTH_GATED } from './data/repository.js'
import { initPwaUpdates } from './pwa/updates.js'
import './styles.css'

// Service worker + new-deploy detection. Registered before render so a stale
// tab can report a failed chunk import as "neue Version verfügbar" instead of
// a raw technical error.
initPwaUpdates()

// The app shell: store + (per-user, opt-in) Drive backup orchestrator.
function Shell() {
  return (
    <StoreProvider>
      <DriveProvider>
        <App />
      </DriveProvider>
    </StoreProvider>
  )
}

// Auth gates the whole app only for Supabase-backed modes (supabase / local-
// first): the store mounts once a session exists. OFFLINE this uses the CACHED
// session (getSession reads localStorage, no network), so a reload works and
// never forces re-login. The `local` / `localfirst-test` backends are
// no-network dev/test modes and skip the gate.
function Root() {
  const { loading, session } = useAuth()
  if (!AUTH_GATED) return <Shell />
  if (loading) return <div className="app-loading">Lädt …</div>
  if (!session) return <AuthScreen />
  return <Shell />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UpdateBanner />
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>,
)
