// IndexedDB setup via `idb`. One database, one object store per SPEC table.
// Indexes on project_id (and chapter_id for character_locations) keep all
// queries project-scoped and fast.
import { openDB } from 'idb'

const DB_NAME = 'smartwriting'
const DB_VERSION = 5

export const STORES = {
  projects: 'projects',
  chapters: 'chapters',
  characters: 'characters',
  places: 'places',
  character_locations: 'character_locations',
  events: 'events',
  // Per-version chapter prose (the chapter row mirrors its active version's body).
  chapter_versions: 'chapter_versions',
  // Local-backend image blobs (the Supabase backend uses Storage instead).
  portraits: 'portraits',
  // Local-backend Drive linkage (the Supabase backend uses the drive_backup table).
  drive: 'drive',
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
    })
  }
  return _dbPromise
}
