// IndexedDB setup via `idb`. One database, one object store per SPEC table.
// Indexes on project_id (and chapter_id for character_locations) keep all
// queries project-scoped and fast.
import { openDB } from 'idb'

const DB_NAME = 'smartwriting'
const DB_VERSION = 12

export const STORES = {
  projects: 'projects',
  chapters: 'chapters',
  characters: 'characters',
  places: 'places',
  character_locations: 'character_locations',
  events: 'events',
  // Per-project map regions (Phase 3): named, coloured areas. The per-cell
  // assignment lives on the terrain row (terrains.regions byte layer).
  regions: 'regions',
  // Per-project authored routes (Phase 3, Stage C): named ordered place paths.
  routes: 'routes',
  // Quick brainstorming captures (Ideen tab).
  ideas: 'ideas',
  // Named geography (rivers/forests/…): map text labels, #-linkable.
  geo_features: 'geo_features',
  // Praemali translator: user lexicon additions (project_id NULLABLE — null =
  // global) and the saved-phrase library. Soft-deleted via deleted_at.
  custom_lexicon_entries: 'custom_lexicon_entries',
  saved_phrases: 'saved_phrases',
  // Per-version chapter prose (the chapter row mirrors its active version's body).
  chapter_versions: 'chapter_versions',
  // Per-project 3D terrain (Phase 3, Stage A). One row per project.
  terrains: 'terrains',
  // Local-backend image blobs (the Supabase backend uses Storage instead).
  portraits: 'portraits',
  // Local-backend Drive linkage (the Supabase backend uses the drive_backup table).
  drive: 'drive',
  // Local-first outgoing sync: a coalescing queue of pending row mutations
  // (keyPath 'key' = "table:id") and small key/value sync bookkeeping.
  sync_queue: 'sync_queue',
  sync_meta: 'sync_meta',
}

// Stores whose row mutations are recorded for outgoing sync (they map 1:1 to a
// Supabase table). Portraits (binary blobs) and Drive linkage are device-local
// and deliberately NOT synced yet; the queue/meta stores are infra.
export const SYNCED_STORES = new Set([
  STORES.projects,
  STORES.chapters,
  STORES.chapter_versions,
  STORES.characters,
  STORES.places,
  STORES.character_locations,
  STORES.events,
  STORES.regions,
  STORES.routes,
  STORES.ideas,
  STORES.geo_features,
  STORES.terrains,
  STORES.custom_lexicon_entries,
  STORES.saved_phrases,
])

// --- outgoing-mutation recorder --------------------------------------------
// A registered sink is called after every successful db.put / db.delete on a
// SYNCED store, so the local-first layer can queue the change for Supabase.
// Null by default → the pure `local` / `supabase` backends record nothing and
// behave exactly as before. Recording is suspended while hydrating (writing
// server rows into the cache must not re-queue them for push).
let mutationSink = null
let recordingSuspended = false
export function setSyncSink(fn) { mutationSink = fn || null }
export function suspendSync(v) { recordingSuspended = !!v }
function record(store, id, op, row) {
  if (!mutationSink || recordingSuspended) return
  if (!SYNCED_STORES.has(store) || id == null) return
  try {
    mutationSink({
      table: store,
      id,
      op,
      updated_at: row?.updated_at,
      // Which project the row belongs to (a project row IS its own project) —
      // needed so a delete can write a project-scoped tombstone after the row
      // itself is gone.
      project_id: store === STORES.projects ? id : (row?.project_id ?? null),
    })
  } catch {
    /* never let sync bookkeeping break a local write */
  }
}

let _dbPromise = null

export function getDb() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains(STORES.projects)) {
          db.createObjectStore(STORES.projects, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORES.chapters)) {
          const s = db.createObjectStore(STORES.chapters, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.characters)) {
          const s = db.createObjectStore(STORES.characters, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.places)) {
          const s = db.createObjectStore(STORES.places, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.character_locations)) {
          const s = db.createObjectStore(STORES.character_locations, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
          s.createIndex('chapter_id', 'chapter_id')
        }
        if (!db.objectStoreNames.contains(STORES.events)) {
          const s = db.createObjectStore(STORES.events, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.portraits)) {
          // keyed by storage path; value: { path, blob }
          db.createObjectStore(STORES.portraits, { keyPath: 'path' })
        }
        if (!db.objectStoreNames.contains(STORES.drive)) {
          // single row keyed by 'me' (the single local user)
          db.createObjectStore(STORES.drive, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORES.chapter_versions)) {
          const s = db.createObjectStore(STORES.chapter_versions, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
          s.createIndex('chapter_id', 'chapter_id')
        }
        if (!db.objectStoreNames.contains(STORES.terrains)) {
          const s = db.createObjectStore(STORES.terrains, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.regions)) {
          const s = db.createObjectStore(STORES.regions, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.routes)) {
          const s = db.createObjectStore(STORES.routes, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.ideas)) {
          const s = db.createObjectStore(STORES.ideas, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.geo_features)) {
          const s = db.createObjectStore(STORES.geo_features, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.custom_lexicon_entries)) {
          // NOTE: project_id may be null (global entries) — nulls aren't
          // indexed, so list queries use getAll + filter, not this index.
          const s = db.createObjectStore(STORES.custom_lexicon_entries, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.saved_phrases)) {
          const s = db.createObjectStore(STORES.saved_phrases, { keyPath: 'id' })
          s.createIndex('project_id', 'project_id')
        }
        if (!db.objectStoreNames.contains(STORES.sync_queue)) {
          // keyPath 'key' = "table:id" so repeated edits to a row COALESCE into
          // one pending entry (we push the row's latest local state).
          db.createObjectStore(STORES.sync_queue, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(STORES.sync_meta)) {
          db.createObjectStore(STORES.sync_meta, { keyPath: 'key' })
        }
        // Backfill (lose no text): every existing chapter gets a "Version 1"
        // copying its current body, set as the active version.
        if (oldVersion > 0 && oldVersion < 5) {
          const chapters = tx.objectStore(STORES.chapters)
          const versions = tx.objectStore(STORES.chapter_versions)
          chapters.openCursor().then(function step(cursor) {
            if (!cursor) return
            const ch = cursor.value
            if (!ch.active_version_id) {
              const vid =
                typeof crypto !== 'undefined' && crypto.randomUUID
                  ? crypto.randomUUID()
                  : `${ch.id}-v1`
              versions.put({
                id: vid,
                project_id: ch.project_id,
                chapter_id: ch.id,
                version_number: 1,
                label: 'Version 1',
                body: ch.body ?? '',
                created_at: ch.updated_at || new Date().toISOString(),
                updated_at: ch.updated_at || new Date().toISOString(),
              })
              cursor.update({ ...ch, active_version_id: vid })
            }
            return cursor.continue().then(step)
          })
        }
      },
    }).then(instrument)
  }
  return _dbPromise
}

// Wrap the idb database so every db.put / db.delete on a SYNCED store is
// recorded for outgoing sync AFTER it commits. Transaction-based writes
// (tx.store.put/delete, used only for cascade child deletes) are intentionally
// NOT recorded — the server's ON DELETE CASCADE removes those children when the
// recorded parent delete is pushed. All other db methods pass straight through.
function instrument(db) {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'put') {
        return async (store, val, key) => {
          const res = await target.put(store, val, key)
          record(store, val?.id ?? key ?? res, 'upsert', val)
          return res
        }
      }
      if (prop === 'delete') {
        return async (store, key) => {
          // Read the row BEFORE deleting so the sync record still knows its
          // project (for the server-side tombstone).
          let row = null
          if (SYNCED_STORES.has(store) && mutationSink && !recordingSuspended) {
            row = await target.get(store, key).catch(() => null)
          }
          const res = await target.delete(store, key)
          record(store, key, 'delete', row)
          return res
        }
      }
      const v = Reflect.get(target, prop)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}
