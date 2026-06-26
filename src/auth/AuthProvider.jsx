// Authentication context backed by Supabase Auth (email + password).
// Holds the session, surfaces auth errors, and persists across reloads
// (the supabase client stores the session in localStorage).
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../data/supabaseClient.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined = still resolving the initial session; null = signed out.
  const [session, setSession] = useState(isSupabaseConfigured ? undefined : null)
  const [error, setError] = useState(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null))
    return () => subscription.unsubscribe()
  }, [])

  async function run(fn) {
    setError(null)
    setWorking(true)
    try {
      const { error: err } = await fn()
      if (err) throw err
      return true
    } catch (e) {
      setError(e.message || 'Authentifizierung fehlgeschlagen.')
      return false
    } finally {
      setWorking(false)
    }
  }

  const value = useMemo(
    () => ({
      isSupabaseConfigured,
      session,
      user: session?.user ?? null,
      loading: session === undefined,
      error,
      working,
      clearError: () => setError(null),
      signIn: (email, password) =>
        run(() => supabase.auth.signInWithPassword({ email, password })),
      signUp: (email, password) => run(() => supabase.auth.signUp({ email, password })),
      signOut: () => supabase?.auth.signOut(),
      // Change password (Supabase updateUser). Returns { ok, error } so callers
      // can show their own feedback without touching the shared auth error.
      changePassword: async (password) => {
        if (!supabase) return { ok: false, error: 'Supabase ist nicht konfiguriert.' }
        const { error: err } = await supabase.auth.updateUser({ password })
        return err ? { ok: false, error: err.message } : { ok: true }
      },
    }),
    [session, error, working],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
