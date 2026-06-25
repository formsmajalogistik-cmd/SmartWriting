// IndexedDB setup via `idb`. One database, one object store per SPEC table.
// Indexes on project_id (and chapter_id for character_locations) keep all
// queries project-scoped and fast.
import { openDB } from 'idb'

const DB_NAME = 'smartwriting'
const DB_VERSION = 1

export const STORES = {
  projects: 'projects',
  chapters: 'chapters',
  characters: 'characters',
  places: 'places',
  character_locations: 'character_locations',
}

let _dbPromise = null

export function getDb() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
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
      },
    })
  }
  return _dbPromise
}
