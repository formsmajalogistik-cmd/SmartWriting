// Supabase remote adapter for the local-first sync engine.
//   fetchProject(projectId) → { table: rows[] }   (hydrate)
//   pushBatch(ops, {userId}) → { done: [key], failed: [{key,error}] }
//
// pushBatch reads each pending row's CURRENT local state and upserts it by id
// (last-write-wins). Upserts run in FK-safe table order; deletes in reverse.
// Chapters/versions have a circular FK (chapters.active_version_id ↔
// chapter_versions.chapter_id), so chapters are upserted in two phases: first
// with active_version_id nulled, then patched after the versions exist.
import { supabase } from './supabaseClient.js'
import { getDb } from './db.js'

// Parent → child, so a referenced row always exists before its referrer.
const UPSERT_ORDER = [
  'projects',
  'characters',
  'places',
  'events',
  'regions',
  'routes',
  'terrains',
  'chapters',
  'chapter_versions',
  'character_locations',
]
const CHILD_TABLES = [
  'chapters',
  'chapter_versions',
  'characters',
  'places',
  'character_locations',
  'events',
  'regions',
  'routes',
  'terrains',
]

export function createSupabaseRemote() {
  return {
    async fetchProject(projectId) {
      const out = {}
      const proj = await supabase.from('projects').select('*').eq('id', projectId)
      if (proj.error) throw new Error(proj.error.message)
      out.projects = proj.data || []
      for (const t of CHILD_TABLES) {
        const { data, error } = await supabase.from(t).select('*').eq('project_id', projectId)
        if (error) throw new Error(error.message)
        out[t] = data || []
      }
      return out
    },

    async pushBatch(ops, { userId }) {
      const db = await getDb()
      const done = new Set()

      // Resolve upsert rows from the local store; a row deleted since it was
      // queued becomes a no-op (any matching delete op handles removal).
      const upserts = []
      const deletes = []
      for (const o of ops) {
        if (o.op === 'delete') {
          deletes.push(o)
          continue
        }
        const row = await db.get(o.table, o.id)
        if (!row) {
          done.add(o.key) // gone locally; nothing to push
          continue
        }
        upserts.push({ ...o, row: { ...row, user_id: userId ?? row.user_id } })
      }
      const upsertsOf = (t) => upserts.filter((o) => o.table === t)

      try {
        for (const t of UPSERT_ORDER) {
          const rows = upsertsOf(t)
          if (!rows.length) continue
          if (t === 'chapters') {
            // Phase 1: satisfy chapter_versions.chapter_id without tripping
            // chapters.active_version_id (its version may not be pushed yet).
            const phase1 = rows.map((o) => ({ ...o.row, active_version_id: null }))
            const { error } = await supabase.from('chapters').upsert(phase1)
            if (error) throw new Error(error.message)
            // marked done in phase 2
          } else {
            const { error } = await supabase.from(t).upsert(rows.map((o) => o.row))
            if (error) throw new Error(error.message)
            rows.forEach((o) => done.add(o.key))
          }
        }
        // Phase 2: now that versions exist, set chapters.active_version_id.
        const chapters = upsertsOf('chapters')
        if (chapters.length) {
          const { error } = await supabase.from('chapters').upsert(chapters.map((o) => o.row))
          if (error) throw new Error(error.message)
          chapters.forEach((o) => done.add(o.key))
        }
        // Deletes: children before parents (also safe under ON DELETE CASCADE).
        for (const t of [...UPSERT_ORDER].reverse()) {
          for (const o of deletes.filter((d) => d.table === t)) {
            const { error } = await supabase.from(t).delete().eq('id', o.id)
            if (error) throw new Error(error.message)
            done.add(o.key)
          }
        }
      } catch (e) {
        // Return partial success; everything not done stays queued and retries.
        return {
          done: [...done],
          failed: ops.filter((o) => !done.has(o.key)).map((o) => ({ key: o.key, error: e?.message || 'Sync-Fehler' })),
        }
      }
      return { done: [...done], failed: [] }
    },
  }
}
