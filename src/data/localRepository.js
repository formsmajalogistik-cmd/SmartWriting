// Local-first repository implementation backed by IndexedDB.
// Implements the contract documented in repository.js. Everything here is
// replaceable wholesale by a Supabase implementation with the same signatures.
import { getDb, STORES } from './db.js'
import {
  makeProject,
  makeChapter,
  makeChapterVersion,
  makeTerrain,
  makeCharacter,
  makePlace,
  makeCharacterLocation,
  makeEvent,
  makeRegion,
  makeRoute,
  makeGeoFeature,
  makeIdea,
  makeCustomLexiconEntry,
  makeSavedPhrase,
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
        STORES.chapter_versions,
        STORES.terrains,
        STORES.characters,
        STORES.places,
        STORES.character_locations,
        STORES.events,
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
        const vers = await db.getAllFromIndex(STORES.chapter_versions, 'chapter_id', ch.id)
        const vtx = db.transaction(STORES.chapter_versions, 'readwrite')
        await Promise.all(vers.map((v) => vtx.store.delete(v.id)))
        await vtx.done
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
      // Every chapter starts with one version; the chapter mirrors its body.
      const version = makeChapterVersion({
        project_id: projectId,
        chapter_id: chapter.id,
        version_number: 1,
        label: 'Version 1',
        body: '',
      })
      chapter.active_version_id = version.id
      await db.put(STORES.chapter_versions, version)
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
      // Cascade: drop this chapter's versions.
      const vers = await db.getAllFromIndex(STORES.chapter_versions, 'chapter_id', id)
      const vtx = db.transaction(STORES.chapter_versions, 'readwrite')
      await Promise.all(vers.map((v) => vtx.store.delete(v.id)))
      await vtx.done
      await db.delete(STORES.chapters, id)
    },

    // ---- Chapter versions (PROSE only; chapters.body mirrors active) ----
    async listChapterVersions(projectId, { chapterId } = {}) {
      const db = await getDb()
      const rows = chapterId
        ? await db.getAllFromIndex(STORES.chapter_versions, 'chapter_id', chapterId)
        : await db.getAllFromIndex(STORES.chapter_versions, 'project_id', projectId)
      return rows.sort((a, b) => (a.version_number || 0) - (b.version_number || 0))
    },

    async createChapterVersion(projectId, { chapterId, label, body }) {
      const db = await getDb()
      const existing = await db.getAllFromIndex(STORES.chapter_versions, 'chapter_id', chapterId)
      const nextNumber = existing.length
        ? Math.max(...existing.map((v) => v.version_number || 0)) + 1
        : 1
      const version = makeChapterVersion({
        project_id: projectId,
        chapter_id: chapterId,
        version_number: nextNumber,
        label: label?.trim() || `Version ${nextNumber}`,
        body: body ?? '',
      })
      await db.put(STORES.chapter_versions, version)
      return version
    },

    async updateChapterVersion(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.chapter_versions, id)
      if (!existing) throw new Error(`Chapter version ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.chapter_versions, updated)
      // If this is the active version, keep the chapter body mirror in sync.
      if (patch.body != null) {
        const chapter = await db.get(STORES.chapters, existing.chapter_id)
        if (chapter && chapter.active_version_id === id) {
          await db.put(STORES.chapters, { ...chapter, body: patch.body, updated_at: nowIso() })
        }
      }
      return updated
    },

    async deleteChapterVersion(id) {
      const db = await getDb()
      const version = await db.get(STORES.chapter_versions, id)
      if (!version) return
      const chapter = await db.get(STORES.chapters, version.chapter_id)
      if (chapter && chapter.active_version_id === id) {
        throw new Error('Die aktive Version kann nicht gelöscht werden.')
      }
      await db.delete(STORES.chapter_versions, id)
    },

    // Make `versionId` the chapter's active version and mirror its body.
    async setActiveVersion(chapterId, versionId) {
      const db = await getDb()
      const chapter = await db.get(STORES.chapters, chapterId)
      const version = await db.get(STORES.chapter_versions, versionId)
      if (!chapter || !version) throw new Error('Kapitel oder Version nicht gefunden.')
      const updated = {
        ...chapter,
        active_version_id: versionId,
        body: version.body ?? '',
        updated_at: nowIso(),
      }
      await db.put(STORES.chapters, updated)
      return updated
    },

    // Write the active version's body (used by the editor) and mirror it.
    async saveActiveVersionBody(chapterId, body) {
      const db = await getDb()
      const chapter = await db.get(STORES.chapters, chapterId)
      if (!chapter) throw new Error(`Chapter ${chapterId} not found`)
      if (chapter.active_version_id) {
        const version = await db.get(STORES.chapter_versions, chapter.active_version_id)
        if (version) {
          await db.put(STORES.chapter_versions, { ...version, body, updated_at: nowIso() })
        }
      }
      const updated = { ...chapter, body, updated_at: nowIso() }
      await db.put(STORES.chapters, updated)
      return updated
    },

    // ---- Terrain (per project; one row, upsert by project_id) -----------
    async getTerrain(projectId) {
      const db = await getDb()
      const rows = await db.getAllFromIndex(STORES.terrains, 'project_id', projectId)
      return rows[0] || null
    },

    async createTerrain(projectId, opts) {
      const db = await getDb()
      const existing = await db.getAllFromIndex(STORES.terrains, 'project_id', projectId)
      if (existing[0]) return existing[0] // one terrain per project
      const terrain = makeTerrain({ project_id: projectId, ...opts })
      await db.put(STORES.terrains, terrain)
      return terrain
    },

    async saveTerrain(projectId, patch) {
      const db = await getDb()
      const rows = await db.getAllFromIndex(STORES.terrains, 'project_id', projectId)
      const existing = rows[0]
      if (!existing) {
        // Upsert: create if missing so a save never silently no-ops.
        const terrain = makeTerrain({ project_id: projectId, ...patch })
        await db.put(STORES.terrains, terrain)
        return terrain
      }
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.terrains, updated)
      return updated
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

    // placeId = START of the chapter; endPlaceId = optional END (movement).
    // Pass `undefined` for a field to leave it unchanged on an existing row;
    // pass null to clear it.
    async setCharacterLocation(projectId, { chapterId, characterId, placeId, endPlaceId }) {
      const db = await getDb()
      const rows = await db.getAllFromIndex(STORES.character_locations, 'chapter_id', chapterId)
      const existing = rows.find((r) => r.character_id === characterId)
      if (existing) {
        const updated = { ...existing }
        if (placeId !== undefined) updated.place_id = placeId ?? null
        if (endPlaceId !== undefined) updated.end_place_id = endPlaceId ?? null
        await db.put(STORES.character_locations, updated)
        return updated
      }
      const row = makeCharacterLocation({
        project_id: projectId,
        chapter_id: chapterId,
        character_id: characterId,
        place_id: placeId ?? null,
        end_place_id: endPlaceId ?? null,
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

    // ---- Regions (map areas; per-cell assignment lives on the terrain) ---
    async listRegions(projectId) {
      const rows = await byProject(STORES.regions, projectId)
      return rows.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    },
    async createRegion(projectId, { name, colour } = {}) {
      const db = await getDb()
      const region = makeRegion({ project_id: projectId, name, colour })
      await db.put(STORES.regions, region)
      return region
    },
    async updateRegion(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.regions, id)
      if (!existing) throw new Error(`Region ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.regions, updated)
      return updated
    },
    async deleteRegion(id) {
      const db = await getDb()
      await db.delete(STORES.regions, id)
    },

    // ---- Routes (authored ordered place paths) --------------------------
    async listRoutes(projectId) {
      const rows = await byProject(STORES.routes, projectId)
      return rows.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    },
    async createRoute(projectId, opts = {}) {
      const db = await getDb()
      const route = makeRoute({ project_id: projectId, ...opts })
      await db.put(STORES.routes, route)
      return route
    },
    async updateRoute(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.routes, id)
      if (!existing) throw new Error(`Route ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.routes, updated)
      return updated
    },
    async deleteRoute(id) {
      const db = await getDb()
      await db.delete(STORES.routes, id)
    },

    // ---- Geo features (named geography as map text labels) ---------------
    async listGeoFeatures(projectId) {
      const rows = await byProject(STORES.geo_features, projectId)
      return rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    },
    async createGeoFeature(projectId, opts = {}) {
      const db = await getDb()
      const feature = makeGeoFeature({ project_id: projectId, ...opts })
      await db.put(STORES.geo_features, feature)
      return feature
    },
    async updateGeoFeature(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.geo_features, id)
      if (!existing) throw new Error(`GeoFeature ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.geo_features, updated)
      return updated
    },
    async deleteGeoFeature(id) {
      const db = await getDb()
      await db.delete(STORES.geo_features, id)
    },

    // ---- Ideas (Ideen brainstorming scratchpad) --------------------------
    async listIdeas(projectId) {
      const rows = await byProject(STORES.ideas, projectId)
      // Newest first; the UI floats pinned ideas on top of that.
      return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    },
    async createIdea(projectId, opts = {}) {
      const db = await getDb()
      const idea = makeIdea({ project_id: projectId, ...opts })
      await db.put(STORES.ideas, idea)
      return idea
    },
    async updateIdea(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.ideas, id)
      if (!existing) throw new Error(`Idea ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.ideas, updated)
      return updated
    },
    async deleteIdea(id) {
      const db = await getDb()
      await db.delete(STORES.ideas, id)
    },

    // ---- Praemali: custom lexicon entries + saved phrases ----------------
    // project_id NULL means "all projects", so list = getAll + filter (nulls
    // aren't indexed). Deletes are SOFT (deleted_at) so they propagate across
    // devices as ordinary row updates via the sync queue.
    async listCustomLexicon(projectId) {
      const db = await getDb()
      const all = await db.getAll(STORES.custom_lexicon_entries)
      return all
        .filter((e) => !e.deleted_at && (e.project_id == null || e.project_id === projectId))
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    },
    async createCustomLexicon(projectId, { entry_type, payload, global = false } = {}) {
      const db = await getDb()
      const entry = makeCustomLexiconEntry({
        project_id: global ? null : projectId,
        entry_type,
        payload,
      })
      await db.put(STORES.custom_lexicon_entries, entry)
      return entry
    },
    async updateCustomLexicon(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.custom_lexicon_entries, id)
      if (!existing) throw new Error(`Lexicon entry ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.custom_lexicon_entries, updated)
      return updated
    },
    async deleteCustomLexicon(id) {
      const db = await getDb()
      const existing = await db.get(STORES.custom_lexicon_entries, id)
      if (!existing) return
      await db.put(STORES.custom_lexicon_entries, {
        ...existing,
        deleted_at: nowIso(),
        updated_at: nowIso(),
      })
    },

    async listSavedPhrases(projectId) {
      const db = await getDb()
      const rows = await db.getAllFromIndex(STORES.saved_phrases, 'project_id', projectId)
      return rows
        .filter((p) => !p.deleted_at)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    },
    async createSavedPhrase(projectId, opts = {}) {
      const db = await getDb()
      const phrase = makeSavedPhrase({ project_id: projectId, ...opts })
      await db.put(STORES.saved_phrases, phrase)
      return phrase
    },
    async updateSavedPhrase(id, patch) {
      const db = await getDb()
      const existing = await db.get(STORES.saved_phrases, id)
      if (!existing) throw new Error(`Phrase ${id} not found`)
      const updated = { ...existing, ...patch, updated_at: nowIso() }
      await db.put(STORES.saved_phrases, updated)
      return updated
    },
    async deleteSavedPhrase(id) {
      const db = await getDb()
      const existing = await db.get(STORES.saved_phrases, id)
      if (!existing) return
      await db.put(STORES.saved_phrases, { ...existing, deleted_at: nowIso(), updated_at: nowIso() })
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

    // ---- Lexicon (local backend has no lexicon store yet) --------------
    async listLexicon() {
      return []
    },

    // ---- Drive backup linkage (local: single IndexedDB row) ------------
    async getDriveLink() {
      const db = await getDb()
      return (await db.get(STORES.drive, 'me')) || null
    },
    async saveDriveLink(patch) {
      const db = await getDb()
      const existing =
        (await db.get(STORES.drive, 'me')) || {
          id: 'me',
          connected: false,
          root_folder_id: null,
          links: {},
        }
      const updated = { ...existing, ...patch, id: 'me', updated_at: new Date().toISOString() }
      await db.put(STORES.drive, updated)
      return updated
    },

    // ---- Portrait images (local backend: blobs in IndexedDB) -----------
    async uploadPortrait(characterId, blob, { ext = 'webp' } = {}) {
      const db = await getDb()
      const path = `local/${characterId}/${crypto.randomUUID()}.${ext}`
      await db.put(STORES.portraits, { path, blob })
      return path
    },

    // Mirror a remote image blob into the local store under ITS OWN path (used
    // by the local-first read-through fallback so images work offline later).
    async cachePortrait(path, blob) {
      const db = await getDb()
      await db.put(STORES.portraits, { path, blob })
    },

    async getPortraitUrl(path) {
      if (!path) return null
      const db = await getDb()
      const row = await db.get(STORES.portraits, path)
      if (!row) return null
      return URL.createObjectURL(row.blob)
    },

    // Raw bytes (no object URL). Used to lift images that were only ever
    // stored locally into Supabase Storage, so other devices and the Drive
    // backup can see them.
    async getPortraitBlob(path) {
      if (!path) return null
      const db = await getDb()
      return (await db.get(STORES.portraits, path))?.blob ?? null
    },

    async deletePortrait(path) {
      if (!path) return
      const db = await getDb()
      await db.delete(STORES.portraits, path)
    },
  }
}
