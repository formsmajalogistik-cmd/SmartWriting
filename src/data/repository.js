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
//   Character locations
//     listCharacterLocations(projectId, { chapterId? }) -> CharacterLocation[]
//     setCharacterLocation(projectId, { chapterId, characterId, placeId })
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

// Backend selection. Default is Supabase (online-first, per Phase 1b).
// Set VITE_DATA_BACKEND=local to run entirely against IndexedDB with no
// network/auth — handy for offline dev and UI testing. Both implement the
// identical interface, so nothing else in the app changes.
export const DATA_BACKEND = import.meta.env.VITE_DATA_BACKEND === 'local' ? 'local' : 'supabase'

let _repo = null

export function getRepository() {
  if (!_repo) {
    // Single swap point.
    _repo = DATA_BACKEND === 'local' ? createLocalRepository() : createSupabaseRepository()
  }
  return _repo
}
