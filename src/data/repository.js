// Data-access interface (the "repository").
//
// The whole UI talks ONLY to the object returned by `getRepository()`. Swapping
// the local-first IndexedDB backing for Supabase later means providing another
// module with the same method signatures and changing the one line below —
// no UI changes. Keep this file backend-agnostic.
//
// Method contract (all async, all project-scoped where applicable):
//
//   Projects
//     listProjects()                       -> Project[]
//     createProject({ name })              -> Project
//     updateProject(id, patch)             -> Project
//     deleteProject(id)                    -> void   (cascades all child rows)
//
//   Books (stored in project.settings.books; chapters reference book id)
//     createBook(projectId, { title })     -> Project (updated)
//     renameBook(projectId, bookId, title) -> Project (updated)
//     deleteBook(projectId, bookId)        -> Project (updated, cascades chapters)
//
//   Chapters
//     listChapters(projectId)              -> Chapter[]
//     createChapter(projectId, { book, title, number }) -> Chapter (with active version)
//     updateChapter(id, patch)             -> Chapter   (metadata only)
//     deleteChapter(id)                    -> void   (cascades locations + versions)
//
//   Chapter versions (PROSE only; chapters.body mirrors the active version)
//     listChapterVersions(projectId, { chapterId? }) -> ChapterVersion[]
//     createChapterVersion(projectId, { chapterId, label, body }) -> ChapterVersion
//     updateChapterVersion(id, { label?, body? }) -> ChapterVersion (mirrors if active)
//     deleteChapterVersion(id)             -> void   (refuses the active version)
//     setActiveVersion(chapterId, versionId) -> Chapter (mirrors body)
//     saveActiveVersionBody(chapterId, body) -> Chapter (writes active version + mirror)
//
//   Terrain (per project; one row, upsert by project_id — Phase 3 Stage A)
//     getTerrain(projectId)                -> Terrain | null
//     createTerrain(projectId, { width, height, sea_level, heights, settings })
//                                          -> Terrain (one per project)
//     saveTerrain(projectId, patch)        -> Terrain (upsert/merge, user-scoped)
//     (Terrain carries a `regions` byte layer + settings.region_slots for the
//      per-cell region assignment; region DEFINITIONS live in `regions` below.)
//
//   Regions (map areas; per-cell assignment lives on terrains.regions)
//     listRegions(projectId)               -> Region[]
//     createRegion(projectId, { name?, colour? }) -> Region
//     updateRegion(id, patch)              -> Region
//     deleteRegion(id)                     -> void
//
//   Routes (authored ordered place paths drawn on the map)
//     listRoutes(projectId)                -> Route[]
//     createRoute(projectId, { label?, colour?, place_ids?, book? }) -> Route
//     updateRoute(id, patch)               -> Route
//     deleteRoute(id)                      -> void
//
//   Geo features (named geography rendered as map text labels; #-linkable)
//     listGeoFeatures(projectId)           -> GeoFeature[]
//     createGeoFeature(projectId, { name?, feature_type?, description?,
//                                   coords?, label_size? }) -> GeoFeature
//     updateGeoFeature(id, patch)          -> GeoFeature
//     deleteGeoFeature(id)                 -> void
//
//   Ideas (Ideen brainstorming scratchpad; newest first)
//     listIdeas(projectId)                 -> Idea[]
//     createIdea(projectId, { title?, content?, tags?, pinned? }) -> Idea
//     updateIdea(id, patch)                -> Idea
//     deleteIdea(id)                       -> void
//
//   Praemali translator (user layer on top of the bundled base lexicon)
//     listCustomLexicon(projectId)         -> Entry[] (project rows + global
//                                             project_id-null rows; no deleted)
//     createCustomLexicon(projectId, { entry_type, payload, global? }) -> Entry
//     updateCustomLexicon(id, patch)       -> Entry
//     deleteCustomLexicon(id)              -> void (SOFT delete via deleted_at)
//     listSavedPhrases(projectId)          -> Phrase[]
//     createSavedPhrase(projectId, { register, praemali, gloss, translation,
//                                    translation_de?, tags?, unresolved? }) -> Phrase
//     updateSavedPhrase(id, patch)         -> Phrase (e.g. re-validation flags)
//     deleteSavedPhrase(id)                -> void (SOFT delete)
//
//   Characters
//     listCharacters(projectId)            -> Character[]
//     createCharacter(projectId, { name }) -> Character
//     updateCharacter(id, patch)           -> Character
//     deleteCharacter(id)                  -> void   (cascades character_locations)
//
//   Places
//     listPlaces(projectId)                -> Place[]
//     createPlace(projectId, { name })     -> Place
//     updatePlace(id, patch)               -> Place
//     deletePlace(id)                      -> void   (cascades character_locations)
//
//   Character locations (placeId = START of the chapter; endPlaceId = optional
//   END for within-chapter movement — undefined leaves a field unchanged,
//   null clears it)
//     listCharacterLocations(projectId, { chapterId? }) -> CharacterLocation[]
//     setCharacterLocation(projectId, { chapterId, characterId, placeId?, endPlaceId? })
//                                          -> CharacterLocation (upsert by chapter+character)
//     removeCharacterLocation(projectId, { chapterId, characterId }) -> void
//     setPlacePresent(projectId, { chapterId, placeId })  -> CharacterLocation
//     removePlacePresent(projectId, { chapterId, placeId }) -> void
//
//   Events (card jsonb: description, involved_character_ids[], chapter_ids[], notes)
//     listEvents(projectId)                -> Event[]
//     createEvent(projectId, { title })    -> Event
//     updateEvent(id, patch)               -> Event
//     deleteEvent(id)                      -> void
//
//   Portrait images (stored in a private bucket / local blob store; only the
//   path is kept on the character card jsonb)
//     uploadPortrait(characterId, blob, { ext, contentType }) -> path
//     getPortraitUrl(path)                 -> signed/object URL (or null)
//     deletePortrait(path)                 -> void
//
//   Drive backup linkage (per-user; opt-in flag + folder/file IDs, NO tokens)
//     getDriveLink()                       -> DriveLink | null
//     saveDriveLink(patch)                 -> DriveLink (upsert/merge, user-scoped)

import { createSupabaseRepository } from './supabaseRepository.js'
import { createLocalRepository } from './localRepository.js'
import { repairEmptyRefs } from './db.js'
import { createSupabaseRemote } from './remoteSupabase.js'
import { createFakeRemote } from './remoteFake.js'
import { initSync } from './syncEngine.js'
import { isSupabaseConfigured, currentUserId } from './supabaseClient.js'

// Backend selection.
//   'local'          — IndexedDB only, no network/auth (offline dev / e2e).
//   'supabase'       — online-only Supabase (legacy / opt-out).
//   'localfirst'     — DEFAULT when Supabase is configured: reads/writes go to
//                      the LOCAL IndexedDB store (never blocking on the network)
//                      while a background engine hydrates from and pushes to
//                      Supabase. The repository INTERFACE is identical to the
//                      local backend — only the sync engine is added behind it.
//   'localfirst-test'— local-first with an in-memory fake remote (e2e only).
function resolveBackend() {
  const raw = import.meta.env.VITE_DATA_BACKEND
  if (raw === 'local' || raw === 'supabase' || raw === 'localfirst' || raw === 'localfirst-test') return raw
  return isSupabaseConfigured ? 'localfirst' : 'local'
}
export const DATA_BACKEND = resolveBackend()
// Which backends need a Supabase auth session (and so gate the app on login).
export const AUTH_GATED = DATA_BACKEND === 'supabase' || DATA_BACKEND === 'localfirst'
// Which backends run the local-first sync engine (and so show a sync status).
export const SYNC_ENABLED = DATA_BACKEND === 'localfirst' || DATA_BACKEND === 'localfirst-test'

let _repo = null

export function getRepository() {
  if (_repo) return _repo
  // One-time start-up repair: '' in uuid reference fields (written before the
  // ''→null write guard) becomes NULL; re-queued rows then push successfully.
  if (DATA_BACKEND !== 'supabase') {
    repairEmptyRefs().catch(() => {})
  }
  if (DATA_BACKEND === 'local') {
    _repo = createLocalRepository()
  } else if (DATA_BACKEND === 'supabase') {
    _repo = createSupabaseRepository()
  } else {
    // Local-first: the primary store is the LOCAL repository (its writes are
    // recorded for sync by db.js); a background engine drains the queue to the
    // chosen remote. UI/store use the same interface as the local backend.
    const remote = DATA_BACKEND === 'localfirst-test' ? createFakeRemote() : createSupabaseRemote()
    const getUserId = DATA_BACKEND === 'localfirst-test' ? async () => 'test-user' : currentUserId
    initSync({ remote, getUserId })
    const local = createLocalRepository()
    if (DATA_BACKEND === 'localfirst') {
      // PORTRAIT IMAGES are binary and don't ride the row-sync queue. In
      // local-first mode Supabase Storage stays the source of truth:
      //   read  — local blob first (offline-fast), else a signed URL from the
      //           bucket, best-effort caching the bytes locally for later
      //           offline use (this is what makes PRE-local-first portraits
      //           reappear on every device);
      //   write — upload to Storage first (other devices can see it), mirror
      //           locally; offline falls back to a local-only path;
      //   delete — both stores, each best-effort.
      const storageRepo = createSupabaseRepository()
      _repo = {
        ...local,
        async uploadPortrait(characterId, blob, opts) {
          try {
            const path = await storageRepo.uploadPortrait(characterId, blob, opts)
            await local.cachePortrait(path, blob).catch(() => {})
            return path
          } catch {
            return local.uploadPortrait(characterId, blob, opts) // offline: local-only
          }
        },
        async getPortraitUrl(path) {
          const localUrl = await local.getPortraitUrl(path).catch(() => null)
          if (localUrl) return localUrl
          if (!path || path.startsWith('local/')) return null // never uploaded
          const url = await storageRepo.getPortraitUrl(path)
          if (url) {
            fetch(url)
              .then((r) => (r.ok ? r.blob() : null))
              .then((b) => b && local.cachePortrait(path, b))
              .catch(() => {})
          }
          return url
        },
        async deletePortrait(path) {
          await local.deletePortrait(path).catch(() => {})
          if (path && !path.startsWith('local/')) {
            await storageRepo.deletePortrait(path).catch(() => {})
          }
        },
      }
    } else {
      _repo = local
    }
  }
  return _repo
}
