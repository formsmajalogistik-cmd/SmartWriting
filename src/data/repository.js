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
//     createChapter(projectId, { book, title, number }) -> Chapter
//     updateChapter(id, patch)             -> Chapter
//     deleteChapter(id)                    -> void   (cascades character_locations)
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

import { createLocalRepository } from './localRepository.js'

let _repo = null

export function getRepository() {
  if (!_repo) {
    // Single swap point: replace with createSupabaseRepository() in a later phase.
    _repo = createLocalRepository()
  }
  return _repo
}
