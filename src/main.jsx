import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { StoreProvider } from './state/store.jsx'
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx'
import { DriveProvider } from './drive/DriveProvider.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import { DATA_BACKEND } from './data/repository.js'
import './styles.css'

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

// Auth gates the whole app: with the Supabase backend, the store (and thus any
// project data) only mounts once a session exists. The `local` backend is a
// no-network, single-user dev mode and skips the gate.
function Root() {
  const { loading, session } = useAuth()
  if (DATA_BACKEND === 'local') return <Shell />
  if (loading) return <div className="app-loading">Lädt …</div>
  if (!session) return <AuthScreen />
  return <Shell />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>,
)
