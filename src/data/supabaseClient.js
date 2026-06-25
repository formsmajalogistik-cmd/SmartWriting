// Single Supabase client for the whole app. Built from public env vars only:
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// The service role key must NEVER appear in client code — only the anon key,
// which is safe to ship because Row Level Security is the real boundary.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true, // session survives reloads (localStorage)
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

// Resolve the signed-in user's id for writes (RLS also enforces this server-side).
export async function currentUserId() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) throw new Error('Nicht angemeldet.')
  return uid
}
