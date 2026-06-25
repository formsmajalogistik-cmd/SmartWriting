import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { StoreProvider } from './state/store.jsx'
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import './styles.css'

// Auth gates the whole app: the store (and thus any project data) only mounts
// once a session exists.
function Root() {
  const { loading, session } = useAuth()
  if (loading) return <div className="app-loading">Lädt …</div>
  if (!session) return <AuthScreen />
  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>,
)
