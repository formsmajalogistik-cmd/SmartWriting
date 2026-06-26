// Local-first repository implementation backed by IndexedDB.
// Implements the contract documented in repository.js. Everything here is
// replaceable wholesale by a Supabase implementation with the same signatures.
import { getDb, STORES } from './db.js'
import {
  makeProject,
  makeChapter,
  makeCharacter,
  makePlace,
  makeCharacterLocation,
  makeEvent,
  nowIso,
} from './types.js'

async function byProject(store, projectId) {
  const db = await getDb()
  return db.getAllFromIndex(store, 'project_id', projectId)
}

export function createLocalRepository() {
  return {
    // ---- Projects -------------------------------------------------------
    async listProjects() {
      const db = await getDb()
      const all = await db.getAll(STORES.projects)
      return all.sort((a, b) => a.created_at.localeCompare(b.created_at))
    },

    async createProject({ name }) {
      const db = await getDb()
      const project = makeProject({ name })
      await db.put(STORES.projects, project)
      return project
    },

    async updateProject(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.projects, id)
      if (!existing) throw new Error(`Project ${id} not found`)
      const updated = { ...existing, ...patch }
      await db.put(STORES.projects, updated)
      return updated
    },

    async deleteProject(id) {
      const db = await getDb()
      // Cascade: delete every child row scoped to this project.
      for (const store of [
        STORES.chapters,
        STORES.characters,
        STORES.places,
        STORES.character_locations,
      ]) {
        const rows = await db.getAllFromIndex(store, 'project_id', id)
        const tx = db.transaction(store, 'readwrite')
        await Promise.all(rows.map((r) => tx.store.delete(r.id)))
        await tx.done
      }
      await db.delete(STORES.projects, id)
    },

    // ---- Books (live in project.settings.books) -------------------------
    async createBook(projectId, { title }) {
      const db = await getDb()
      const project = await db.get(STORES.projects, projectId)
      const books = [...(project.settings?.books ?? [])]
      books.push({ id: crypto.randomUUID(), title: title?.trim() || 'Neues Buch' })
      const updated = { ...project, settings: { ...project.settings, books } }
      await db.put(STORES.projects, updated)
      return updated
    },

    async renameBook(projectId, bookId, title) {
      const db = await getDb()
      const project = await db.get(STORES.projects, projectId)
      const books = (project.settings?.books ?? []).map((b) =>
        b.id === bookId ? { ...b, title: title?.trim() || b.title } : b,
      )
      const updated = { ...project, settings: { ...project.settings, books } }
      await db.put(STORES.projects, updated)
      return updated
    },

    async deleteBook(projectId, bookId) {
      const db = await getDb()
      const project = await db.get(STORES.projects, projectId)
      const books = (project.settings?.books ?? []).filter((b) => b.id !== bookId)
      // Cascade: delete chapters in this book + their character_locations.
      const chapters = await db.getAllFromIndex(STORES.chapters, 'project_id', projectId)
      const toDelete = chapters.filter((c) => c.book === bookId)
      for (const ch of toDelete) {
        const locs = await db.getAllFromIndex(STORES.character_locations, 'chapter_id', ch.id)
        const tx = db.transaction(STORES.character_locations, 'readwrite')
        await Promise.all(locs.map((l) => tx.store.delete(l.id)))
        await tx.done
        await db.delete(STORES.chapters, ch.id)
      }
      const updated = { ...project, settings: { ...project.settings, books } }
      await db.put(STORES.projects, updated)
      return updated
    },

    // ---- Chapters -------------------------------------------------------
    async listChapters(projectId) {
      const rows = await byProject(STORES.chapters, projectId)
      return rows.sort((a, b) => a.number - b.number)
    },

    async createChapter(projectId, { book, title, number }) {
      const db = await getDb()
      let nextNumber = number
      if (nextNumber == null) {
        const existing = await db.getAllFromIndex(STORES.chapters, 'project_id', projectId)
        const inBook = existing.filter((c) => c.book === (book ?? null))
        nextNumber = inBook.length
          ? Math.max(...inBook.map((c) => c.number || 0)) + 1
          : 1
      }
      const chapter = makeChapter({ project_id: projectId, book: book ?? null, title, number: nextNumber })
      await db.put(STORES.chapters, chapter)
      return chapter
    },

    async updateChapter(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.chapters, id)
      if (!existing) throw new Error(`Chapter ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.chapters, updated)
      return updated
    },

    async deleteChapter(id) {
      const db = await getDb()
      const locs = await db.getAllFromIndex(STORES.character_locations, 'chapter_id', id)
      const tx = db.transaction(STORES.character_locations, 'readwrite')
      await Promise.all(locs.map((l) => tx.store.delete(l.id)))
      await tx.done
      await db.delete(STORES.chapters, id)
    },

    // ---- Characters -----------------------------------------------------
    async listCharacters(projectId) {
      const rows = await byProject(STORES.characters, projectId)
      return rows.sort((a, b) => a.name.localeCompare(b.name))
    },

    async createCharacter(projectId, { name }) {
      const db = await getDb()
      const character = makeCharacter({ project_id: projectId, name })
      await db.put(STORES.characters, character)
      return character
    },

    async updateCharacter(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.characters, id)
      if (!existing) throw new Error(`Character ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.characters, updated)
      return updated
    },

    async deleteCharacter(id) {
      const db = await getDb()
      const all = await db.getAll(STORES.character_locations)
      const locs = all.filter((l) => l.character_id === id)
      const tx = db.transaction(STORES.character_locations, 'readwrite')
      await Promise.all(locs.map((l) => tx.store.delete(l.id)))
      await tx.done
      await db.delete(STORES.characters, id)
    },

    // ---- Places ---------------------------------------------------------
    async listPlaces(projectId) {
      const rows = await byProject(STORES.places, projectId)
      return rows.sort((a, b) => a.name.localeCompare(b.name))
    },

    async createPlace(projectId, { name }) {
      const db = await getDb()
      const place = makePlace({ project_id: projectId, name })
      await db.put(STORES.places, place)
      return place
    },

    async updatePlace(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.places, id)
      if (!existing) throw new Error(`Place ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.places, updated)
      return updated
    },

    async deletePlace(id) {
      const db = await getDb()
      const all = await db.getAll(STORES.character_locations)
      // Detach the place from any rows, drop rows that become empty.
      const tx = db.transaction(STORES.character_locations, 'readwrite')
      await Promise.all(
        all
          .filter((l) => l.place_id === id)
          .map((l) =>
            l.character_id
              ? tx.store.put({ ...l, place_id: null })
              : tx.store.delete(l.id),
          ),
      )
      await tx.done
      await db.delete(STORES.places, id)
    },

    // ---- Character locations -------------------------------------------
    async listCharacterLocations(projectId, { chapterId } = {}) {
      const rows = await byProject(STORES.character_locations, projectId)
      return chapterId ? rows.filter((r) => r.chapter_id === chapterId) : rows
    },

    async setCharacterLocation(projectId, { chapterId, characterId, placeId }) {
      const db = await getDb()
      const rows = await db.getAllFromIndex(STORES.character_locations, 'chapter_id', chapterId)
      const existing = rows.find((r) => r.character_id === characterId)
      if (existing) {
        const updated = { ...existing, place_id: placeId ?? null }
        await db.put(STORES.character_locations, updated)
        return updated
      }
      const row = makeCharacterLocation({
        project_id: projectId,
        chapter_id: chapterId,
        character_id: characterId,
        place_id: placeId ?? null,
      })
      await db.put(STORES.character_locations, row)
      return row
    },

    async removeCharacterLocation(projectId, { chapterId, characterId }) {
      const db = await getDb()
      const rows = await db.getAllFromIndex(STORES.character_locations, 'chapter_id', chapterId)
      const existing = rows.find((r) => r.character_id === characterId)
      if (existing) await db.delete(STORES.character_locations, existing.id)
    },

    // Place present without a bound character (character_id = null).
    async setPlacePresent(projectId, { chapterId, placeId }) {
      const db = await getDb()
      const rows = await db.getAllFromIndex(STORES.character_locations, 'chapter_id', chapterId)
      const existing = rows.find((r) => r.character_id == null && r.place_id === placeId)
      if (existing) return existing
      const row = makeCharacterLocation({
        project_id: projectId,
        chapter_id: chapterId,
        character_id: null,
        place_id: placeId,
      })
      await db.put(STORES.character_locations, row)
      return row
    },

    async removePlacePresent(projectId, { chapterId, placeId }) {
      const db = await getDb()
      const rows = await db.getAllFromIndex(STORES.character_locations, 'chapter_id', chapterId)
      const existing = rows.find((r) => r.character_id == null && r.place_id === placeId)
      if (existing) await db.delete(STORES.character_locations, existing.id)
    },

    // ---- Events ---------------------------------------------------------
    async listEvents(projectId) {
      const rows = await byProject(STORES.events, projectId)
      return rows.sort(
        (a, b) => (a.story_order || 0) - (b.story_order || 0) || a.title.localeCompare(b.title),
      )
    },

    async createEvent(projectId, { title }) {
      const db = await getDb()
      const event = makeEvent({ project_id: projectId, title })
      await db.put(STORES.events, event)
      return event
    },

    async updateEvent(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.events, id)
      if (!existing) throw new Error(`Event ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.events, updated)
      return updated
    },

    async deleteEvent(id) {
      const db = await getDb()
      await db.delete(STORES.events, id)
    },

    // ---- Portrait images (local backend: blobs in IndexedDB) -----------
    async uploadPortrait(characterId, blob, { ext = 'webp' } = {}) {
      const db = await getDb()
      const path = `local/${characterId}/${crypto.randomUUID()}.${ext}`
      await db.put(STORES.portraits, { path, blob })
      return path
    },

    async getPortraitUrl(path) {
      if (!path) return null
      const db = await getDb()
      const row = await db.get(STORES.portraits, path)
      if (!row) return null
      return URL.createObjectURL(row.blob)
    },

    async deletePortrait(path) {
      if (!path) return
      const db = await getDb()
      await db.delete(STORES.portraits, path)
    },
  }
}
