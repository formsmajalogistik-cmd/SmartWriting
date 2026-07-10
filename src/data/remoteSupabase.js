// Supabase remote adapter for the local-first sync engine.
//   fetchProjects()                        → project rows (RLS-scoped to the user)
//   fetchProject(projectId)                → { table: rows[] }        (hydrate)
//   fetchChangesSince(projectId, {cursors,
//     tombstoneCursor})                    → { tables, tombstones }   (pull)
//   pushBatch(ops, {userId})               → { done, failed, stamps }
//
// pushBatch reads each pending row's CURRENT local state and upserts it by id
// (last-write-wins). Upserts run in FK-safe table order; deletes in reverse.
// Chapters/versions have a circular FK (chapters.active_version_id ↔
// chapter_versions.chapter_id), so chapters are upserted in two phases: first
// with active_version_id nulled, then patched after the versions exist.
// `stamps` maps queue keys to the SERVER's resulting updated_at (the
// set_updated_at trigger re-stamps updates) — the engine records these as the
// new conflict-detection bases. Every delete also writes a TOMBSTONE row so
// other devices learn about it on pull.
import { supabase } from './supabaseClient.js'
import { getDb } from './db.js'

// Parent → child, so a referenced row always exists before its referrer.
const UPSERT_ORDER = [
  'projects',
  // regions BEFORE characters/places: both carry region-id FKs to it.
  'regions',
  'characters',
  'places',
  'events',
  'routes',
  'ideas',
  'geo_features',
  'terrains',
  'custom_lexicon_entries',
  'saved_phrases',
  'chapters',
  'chapter_versions',
  'character_locations',
]
const CHILD_TABLES = UPSERT_ORDER.slice(1)

// custom_lexicon_entries rows may have project_id NULL (= all projects), so
// project scoping for that table must include the null rows.
function scopeByProject(query, table, projectId) {
  if (table === 'projects') return query.eq('id', projectId)
  if (table === 'custom_lexicon_entries') {
    return query.or(`project_id.eq.${projectId},project_id.is.null`)
  }
  return query.eq('project_id', projectId)
}

export function createSupabaseRemote() {
  return {
    async fetchProjects() {
      const { data, error } = await supabase.from('projects').select('*')
      if (error) throw new Error(error.message)
      return data || []
    },

    async fetchProject(projectId) {
      const out = {}
      const proj = await supabase.from('projects').select('*').eq('id', projectId)
      if (proj.error) throw new Error(proj.error.message)
      out.projects = proj.data || []
      for (const t of CHILD_TABLES) {
        const { data, error } = await scopeByProject(supabase.from(t).select('*'), t, projectId)
        if (error) throw new Error(error.message)
        out[t] = data || []
      }
      return out
    },

    // Rows (and tombstones) newer than what this device last saw, per table.
    async fetchChangesSince(projectId, { cursors = {}, tombstoneCursor } = {}) {
      const tables = {}
      for (const t of UPSERT_ORDER) {
        const cursor = cursors[t] || '1970-01-01T00:00:00.000Z'
        const q = scopeByProject(supabase.from(t).select('*').gt('updated_at', cursor), t, projectId)
        const { data, error } = await q.order('updated_at', { ascending: true })
        if (error) throw new Error(error.message)
        tables[t] = data || []
      }
      const { data: tombs, error: terr } = await supabase
        .from('tombstones')
        .select('*')
        .eq('project_id', projectId)
        .gt('deleted_at', tombstoneCursor || '1970-01-01T00:00:00.000Z')
        .order('deleted_at', { ascending: true })
      if (terr) throw new Error(terr.message)
      return { tables, tombstones: tombs || [] }
    },

    async pushBatch(ops, { userId }) {
      const db = await getDb()
      const done = new Set()
      const stamps = {}

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
      const recordStamps = (tableOps, data) => {
        const byId = new Map((data || []).map((r) => [r.id, r.updated_at]))
        for (const o of tableOps) if (byId.has(o.id)) stamps[o.key] = byId.get(o.id)
      }

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
            // marked done (and stamped) in phase 2
          } else {
            const { data, error } = await supabase
              .from(t)
              .upsert(rows.map((o) => o.row))
              .select('id, updated_at')
            if (error) throw new Error(error.message)
            recordStamps(rows, data)
            rows.forEach((o) => done.add(o.key))
          }
        }
        // Phase 2: now that versions exist, set chapters.active_version_id.
        const chapters = upsertsOf('chapters')
        if (chapters.length) {
          const { data, error } = await supabase
            .from('chapters')
            .upsert(chapters.map((o) => o.row))
            .select('id, updated_at')
          if (error) throw new Error(error.message)
          recordStamps(chapters, data)
          chapters.forEach((o) => done.add(o.key))
        }
        // Deletes: children before parents (also safe under ON DELETE CASCADE).
        // Each delete also records a tombstone so other devices see it on pull.
        for (const t of [...UPSERT_ORDER].reverse()) {
          for (const o of deletes.filter((d) => d.table === t)) {
            const { error } = await supabase.from(t).delete().eq('id', o.id)
            if (error) throw new Error(error.message)
            if (o.project_id && userId) {
              const { error: terr } = await supabase.from('tombstones').insert({
                user_id: userId,
                project_id: o.project_id,
                table_name: t,
                record_id: o.id,
              })
              if (terr) throw new Error(terr.message)
            }
            done.add(o.key)
          }
        }
      } catch (e) {
        // Return partial success; everything not done stays queued and retries.
        return {
          done: [...done],
          stamps,
          failed: ops
            .filter((o) => !done.has(o.key))
            .map((o) => ({ key: o.key, error: e?.message || 'Sync-Fehler' })),
        }
      }
      return { done: [...done], stamps, failed: [] }
    },
  }
}
