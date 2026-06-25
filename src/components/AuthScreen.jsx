import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider.jsx'

// Login / signup screen. Gates the entire app — until a session exists, this is
// the only thing rendered, so no project data is ever reachable while logged out.
export default function AuthScreen() {
  const { signIn, signUp, error, working, clearError, isSupabaseConfigured } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setNotice('')
    if (mode === 'signup') {
      const ok = await signUp(email.trim(), password)
      // With email confirmation enabled, signUp succeeds but no session is
      // created until the user confirms — tell them what to do.
      if (ok) setNotice('Konto erstellt. Falls E-Mail-Bestätigung aktiv ist, bestätige den Link in deinem Postfach und melde dich dann an.')
    } else {
      await signIn(email.trim(), password)
    }
  }

  function switchMode(next) {
    clearError()
    setNotice('')
    setMode(next)
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">SmartWriting</div>
        <h1>{mode === 'signin' ? 'Anmelden' : 'Konto erstellen'}</h1>

        {!isSupabaseConfigured && (
          <div className="auth-error">
            Supabase ist nicht konfiguriert. Lege <code>.env.local</code> mit{' '}
            <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code> an und starte neu.
          </div>
        )}

        <form onSubmit={onSubmit} className="auth-form">
          <label className="field">
            <span>E-Mail</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!isSupabaseConfigured || working}
            />
          </label>
          <label className="field">
            <span>Passwort</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!isSupabaseConfigured || working}
            />
          </label>

          {error && <div className="auth-error">{error}</div>}
          {notice && <div className="auth-notice">{notice}</div>}

          <button type="submit" className="auth-submit" disabled={!isSupabaseConfigured || working}>
            {working ? 'Bitte warten …' : mode === 'signin' ? 'Anmelden' : 'Registrieren'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'signin' ? (
            <>
              Noch kein Konto?{' '}
              <button className="link-btn" onClick={() => switchMode('signup')}>
                Registrieren
              </button>
            </>
          ) : (
            <>
              Schon ein Konto?{' '}
              <button className="link-btn" onClick={() => switchMode('signin')}>
                Anmelden
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
