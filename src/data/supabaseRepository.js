// Supabase implementation of the repository contract documented in
// repository.js. Same method signatures and return shapes as the local
// implementation, so the UI and store are untouched.
//
// Reads are scoped by the active project (and RLS restricts them to the
// current user server-side). Writes set user_id = auth.uid() and the
// appropriate project_id. Books still live in projects.settings.books.
import { supabase, currentUserId } from './supabaseClient.js'

// Private Storage bucket for character portraits. Access is governed by the
// bucket's RLS policies (user-scoped by path); images are served via short-
// lived signed URLs.
const PORTRAIT_BUCKET = 'character-portraits'
const SIGNED_URL_TTL = 3600 // seconds

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Supabase-Fehler')
  return data
}

export function createSupabaseRepository() {
  return {
    // ---- Projects -------------------------------------------------------
    async listProjects() {
      return unwrap(
        await supabase.from('projects').select('*').order('created_at', { ascending: true }),
      )
    },

    async createProject({ name }) {
      const user_id = await currentUserId()
      return unwrap(
        await supabase
          .from('projects')
          .insert({
            user_id,
            name: name?.trim() || 'Neues Projekt',
            settings: { conlang_enabled: false, books: [] },
          })
          .select()
          .single(),
      )
    },

    async updateProject(id, patch) {
      return unwrap(
        await supabase.from('projects').update(patch).eq('id', id).select().single(),
      )
    },

    async deleteProject(id) {
      // Child rows cascade via ON DELETE CASCADE.
      unwrap(await supabase.from('projects').delete().eq('id', id))
    },

    // ---- Books (live in projects.settings.books) ------------------------
    async createBook(projectId, { title }) {
      const project = unwrap(
        await supabase.from('projects').select('settings').eq('id', projectId).single(),
      )
      const books = [
        ...(project.settings?.books ?? []),
        { id: crypto.randomUUID(), title: title?.trim() || 'Neues Buch' },
      ]
      const settings = { ...project.settings, books }
      return unwrap(
        await supabase.from('projects').update({ settings }).eq('id', projectId).select().single(),
      )
    },

    async renameBook(projectId, bookId, title) {
      const project = unwrap(
        await supabase.from('projects').select('settings').eq('id', projectId).single(),
      )
      const books = (project.settings?.books ?? []).map((b) =>
        b.id === bookId ? { ...b, title: title?.trim() || b.title } : b,
      )
      const settings = { ...project.settings, books }
      return unwrap(
        await supabase.from('projects').update({ settings }).eq('id', projectId).select().single(),
      )
    },

    async deleteBook(projectId, bookId) {
      const project = unwrap(
        await supabase.from('projects').select('settings').eq('id', projectId).single(),
      )
      const books = (project.settings?.books ?? []).filter((b) => b.id !== bookId)
      // Delete chapters in this book; character_locations cascade via chapter FK.
      unwrap(
        await supabase.from('chapters').delete().eq('project_id', projectId).eq('book', bookId),
      )
      const settings = { ...project.settings, books }
      return unwrap(
        await supabase.from('projects').update({ settings }).eq('id', projectId).select().single(),
      )
    },

    // ---- Chapters -------------------------------------------------------
    async listChapters(projectId) {
      return unwrap(
        await supabase
          .from('chapters')
          .select('*')
          .eq('project_id', projectId)
          .order('number', { ascending: true }),
      )
    },

    async createChapter(projectId, { book, title, number }) {
      const user_id = await currentUserId()
      let nextNumber = number
      if (nextNumber == null) {
        const existing = unwrap(
          await supabase.from('chapters').select('number, book').eq('project_id', projectId),
        )
        const inBook = existing.filter((c) => (c.book ?? null) === (book ?? null))
        nextNumber = inBook.length ? Math.max(...inBook.map((c) => c.number || 0)) + 1 : 1
      }
      const insert = { user_id, project_id: projectId, book: book ?? null, number: nextNumber }
      if (title?.trim()) insert.title = title.trim()
      const chapter = unwrap(await supabase.from('chapters').insert(insert).select().single())
      // Every chapter starts with one version; chapters.body mirrors it.
      const version = unwrap(
        await supabase
          .from('chapter_versions')
          .insert({
            user_id,
            project_id: projectId,
            chapter_id: chapter.id,
            version_number: 1,
            label: 'Version 1',
            body: '',
          })
          .select()
          .single(),
      )
      return unwrap(
        await supabase
          .from('chapters')
          .update({ active_version_id: version.id })
          .eq('id', chapter.id)
          .select()
          .single(),
      )
    },

    async updateChapter(id, patch) {
      return unwrap(
        await supabase.from('chapters').update(patch).eq('id', id).select().single(),
      )
    },

    async deleteChapter(id) {
      // character_locations + chapter_versions cascade via chapter FK.
      unwrap(await supabase.from('chapters').delete().eq('id', id))
    },

    // ---- Chapter versions (PROSE only; chapters.body mirrors active) ----
    async listChapterVersions(projectId, { chapterId } = {}) {
      let q = supabase.from('chapter_versions').select('*').eq('project_id', projectId)
      if (chapterId) q = q.eq('chapter_id', chapterId)
      return unwrap(await q.order('version_number', { ascending: true }))
    },

    async createChapterVersion(projectId, { chapterId, label, body }) {
      const user_id = await currentUserId()
      const existing = unwrap(
        await supabase
          .from('chapter_versions')
          .select('version_number')
          .eq('chapter_id', chapterId),
      )
      const nextNumber = existing.length
        ? Math.max(...existing.map((v) => v.version_number || 0)) + 1
        : 1
      return unwrap(
        await supabase
          .from('chapter_versions')
          .insert({
            user_id,
            project_id: projectId,
            chapter_id: chapterId,
            version_number: nextNumber,
            label: label?.trim() || `Version ${nextNumber}`,
            body: body ?? '',
          })
          .select()
          .single(),
      )
    },

    async updateChapterVersion(id, patch) {
      const version = unwrap(
        await supabase.from('chapter_versions').update(patch).eq('id', id).select().single(),
      )
      // Keep the chapter body mirror in sync if this is the active version.
      if (patch.body != null) {
        const chapter = unwrap(
          await supabase
            .from('chapters')
            .select('id, active_version_id')
            .eq('id', version.chapter_id)
            .single(),
        )
        if (chapter.active_version_id === id) {
          unwrap(
            await supabase.from('chapters').update({ body: patch.body }).eq('id', chapter.id),
          )
        }
      }
      return version
    },

    async deleteChapterVersion(id) {
      const version = unwrap(
        await supabase.from('chapter_versions').select('id, chapter_id').eq('id', id).single(),
      )
      const chapter = unwrap(
        await supabase.from('chapters').select('active_version_id').eq('id', version.chapter_id).single(),
      )
      if (chapter.active_version_id === id) {
        throw new Error('Die aktive Version kann nicht gelöscht werden.')
      }
      unwrap(await supabase.from('chapter_versions').delete().eq('id', id))
    },

    async setActiveVersion(chapterId, versionId) {
      const version = unwrap(
        await supabase.from('chapter_versions').select('body').eq('id', versionId).single(),
      )
      return unwrap(
        await supabase
          .from('chapters')
          .update({ active_version_id: versionId, body: version.body ?? '' })
          .eq('id', chapterId)
          .select()
          .single(),
      )
    },

    async saveActiveVersionBody(chapterId, body) {
      const chapter = unwrap(
        await supabase
          .from('chapters')
          .select('id, active_version_id')
          .eq('id', chapterId)
          .single(),
      )
      if (chapter.active_version_id) {
        unwrap(
          await supabase
            .from('chapter_versions')
            .update({ body })
            .eq('id', chapter.active_version_id),
        )
      }
      return unwrap(
        await supabase.from('chapters').update({ body }).eq('id', chapterId).select().single(),
      )
    },

    // ---- Terrain (per project; one row, upsert by project_id) -----------
    async getTerrain(projectId) {
      const { data, error } = await supabase
        .from('terrains')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle()
      if (error) throw new Error(error.message || 'Terrain konnte nicht geladen werden.')
      return data || null
    },

    async createTerrain(projectId, opts) {
      const user_id = await currentUserId()
      // ON CONFLICT (project_id) keeps it to one terrain per project even if two
      // tabs race the first create; ignoreDuplicates returns the existing row.
      const { data, error } = await supabase
        .from('terrains')
        .upsert({ user_id, project_id: projectId, ...opts }, {
          onConflict: 'project_id',
          ignoreDuplicates: true,
        })
        .select()
        .maybeSingle()
      if (error) throw new Error(error.message || 'Terrain konnte nicht erstellt werden.')
      if (data) return data
      // A duplicate was ignored — fetch the existing row.
      return unwrap(
        await supabase.from('terrains').select('*').eq('project_id', projectId).single(),
      )
    },

    async saveTerrain(projectId, patch) {
      const user_id = await currentUserId()
      const { data, error } = await supabase
        .from('terrains')
        .upsert({ user_id, project_id: projectId, ...patch }, { onConflict: 'project_id' })
        .select()
        .single()
      if (error) throw new Error(error.message || 'Terrain konnte nicht gespeichert werden.')
      return data
    },

    // ---- Characters -----------------------------------------------------
    async listCharacters(projectId) {
      return unwrap(
        await supabase
          .from('characters')
          .select('*')
          .eq('project_id', projectId)
          .order('name', { ascending: true }),
      )
    },

    async createCharacter(projectId, { name }) {
      const user_id = await currentUserId()
      const insert = { user_id, project_id: projectId }
      if (name?.trim()) insert.name = name.trim()
      return unwrap(await supabase.from('characters').insert(insert).select().single())
    },

    async updateCharacter(id, patch) {
      return unwrap(
        await supabase.from('characters').update(patch).eq('id', id).select().single(),
      )
    },

    async deleteCharacter(id) {
      // character_locations referencing this character cascade via FK.
      unwrap(await supabase.from('characters').delete().eq('id', id))
    },

    // ---- Places ---------------------------------------------------------
    async listPlaces(projectId) {
      return unwrap(
        await supabase
          .from('places')
          .select('*')
          .eq('project_id', projectId)
          .order('name', { ascending: true }),
      )
    },

    async createPlace(projectId, { name }) {
      const user_id = await currentUserId()
      const insert = { user_id, project_id: projectId }
      if (name?.trim()) insert.name = name.trim()
      return unwrap(await supabase.from('places').insert(insert).select().single())
    },

    async updatePlace(id, patch) {
      return unwrap(
        await supabase.from('places').update(patch).eq('id', id).select().single(),
      )
    },

    async deletePlace(id) {
      // Drop "place present" rows (no character); rows with a character get
      // place_id nulled via ON DELETE SET NULL.
      unwrap(
        await supabase
          .from('character_locations')
          .delete()
          .eq('place_id', id)
          .is('character_id', null),
      )
      unwrap(await supabase.from('places').delete().eq('id', id))
    },

    // ---- Character locations -------------------------------------------
    async listCharacterLocations(projectId, { chapterId } = {}) {
      let q = supabase.from('character_locations').select('*').eq('project_id', projectId)
      if (chapterId) q = q.eq('chapter_id', chapterId)
      return unwrap(await q)
    },

    async setCharacterLocation(projectId, { chapterId, characterId, placeId }) {
      const rows = unwrap(
        await supabase
          .from('character_locations')
          .select('*')
          .eq('chapter_id', chapterId)
          .eq('character_id', characterId),
      )
      if (rows.length) {
        return unwrap(
          await supabase
            .from('character_locations')
            .update({ place_id: placeId ?? null })
            .eq('id', rows[0].id)
            .select()
            .single(),
        )
      }
      const user_id = await currentUserId()
      return unwrap(
        await supabase
          .from('character_locations')
          .insert({
            user_id,
            project_id: projectId,
            chapter_id: chapterId,
            character_id: characterId,
            place_id: placeId ?? null,
          })
          .select()
          .single(),
      )
    },

    async removeCharacterLocation(projectId, { chapterId, characterId }) {
      unwrap(
        await supabase
          .from('character_locations')
          .delete()
          .eq('chapter_id', chapterId)
          .eq('character_id', characterId),
      )
    },

    async setPlacePresent(projectId, { chapterId, placeId }) {
      const rows = unwrap(
        await supabase
          .from('character_locations')
          .select('*')
          .eq('chapter_id', chapterId)
          .is('character_id', null)
          .eq('place_id', placeId),
      )
      if (rows.length) return rows[0]
      const user_id = await currentUserId()
      return unwrap(
        await supabase
          .from('character_locations')
          .insert({
            user_id,
            project_id: projectId,
            chapter_id: chapterId,
            character_id: null,
            place_id: placeId,
          })
          .select()
          .single(),
      )
    },

    async removePlacePresent(projectId, { chapterId, placeId }) {
      unwrap(
        await supabase
          .from('character_locations')
          .delete()
          .eq('chapter_id', chapterId)
          .is('character_id', null)
          .eq('place_id', placeId),
      )
    },

    // ---- Regions (map areas; per-cell assignment lives on the terrain) ---
    async listRegions(projectId) {
      return unwrap(
        await supabase
          .from('regions')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true }),
      )
    },
    async createRegion(projectId, { name, colour } = {}) {
      const user_id = await currentUserId()
      const insert = { user_id, project_id: projectId }
      if (name?.trim()) insert.name = name.trim()
      if (colour) insert.colour = colour
      return unwrap(await supabase.from('regions').insert(insert).select().single())
    },
    async updateRegion(id, patch) {
      return unwrap(await supabase.from('regions').update(patch).eq('id', id).select().single())
    },
    async deleteRegion(id) {
      unwrap(await supabase.from('regions').delete().eq('id', id))
    },

    // ---- Routes (authored ordered place paths) --------------------------
    async listRoutes(projectId) {
      return unwrap(
        await supabase
          .from('routes')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true }),
      )
    },
    async createRoute(projectId, opts = {}) {
      const user_id = await currentUserId()
      const insert = { user_id, project_id: projectId }
      if (opts.label?.trim()) insert.label = opts.label.trim()
      if (opts.colour) insert.colour = opts.colour
      if (Array.isArray(opts.place_ids)) insert.place_ids = opts.place_ids
      if (opts.book != null) insert.book = opts.book
      return unwrap(await supabase.from('routes').insert(insert).select().single())
    },
    async updateRoute(id, patch) {
      return unwrap(await supabase.from('routes').update(patch).eq('id', id).select().single())
    },
    async deleteRoute(id) {
      unwrap(await supabase.from('routes').delete().eq('id', id))
    },

    // ---- Ideas (Ideen brainstorming scratchpad) --------------------------
    async listIdeas(projectId) {
      return unwrap(
        await supabase
          .from('ideas')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false }),
      )
    },
    async createIdea(projectId, opts = {}) {
      const user_id = await currentUserId()
      const insert = { user_id, project_id: projectId }
      if (opts.title?.trim()) insert.title = opts.title.trim()
      if (typeof opts.content === 'string') insert.content = opts.content
      if (Array.isArray(opts.tags)) insert.tags = opts.tags
      if (opts.pinned != null) insert.pinned = !!opts.pinned
      return unwrap(await supabase.from('ideas').insert(insert).select().single())
    },
    async updateIdea(id, patch) {
      return unwrap(await supabase.from('ideas').update(patch).eq('id', id).select().single())
    },
    async deleteIdea(id) {
      unwrap(await supabase.from('ideas').delete().eq('id', id))
    },

    // ---- Praemali: custom lexicon entries + saved phrases ----------------
    async listCustomLexicon(projectId) {
      return unwrap(
        await supabase
          .from('custom_lexicon_entries')
          .select('*')
          .or(`project_id.eq.${projectId},project_id.is.null`)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      )
    },
    async createCustomLexicon(projectId, { entry_type, payload, global = false } = {}) {
      const user_id = await currentUserId()
      return unwrap(
        await supabase
          .from('custom_lexicon_entries')
          .insert({ user_id, project_id: global ? null : projectId, entry_type, payload })
          .select()
          .single(),
      )
    },
    async updateCustomLexicon(id, patch) {
      return unwrap(
        await supabase.from('custom_lexicon_entries').update(patch).eq('id', id).select().single(),
      )
    },
    async deleteCustomLexicon(id) {
      // Soft delete: propagates as a row update.
      unwrap(
        await supabase
          .from('custom_lexicon_entries')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id),
      )
    },

    async listSavedPhrases(projectId) {
      return unwrap(
        await supabase
          .from('saved_phrases')
          .select('*')
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      )
    },
    async createSavedPhrase(projectId, opts = {}) {
      const user_id = await currentUserId()
      const insert = { user_id, project_id: projectId }
      for (const k of ['register', 'praemali', 'gloss', 'translation', 'translation_de', 'tags', 'unresolved']) {
        if (opts[k] != null) insert[k] = opts[k]
      }
      return unwrap(await supabase.from('saved_phrases').insert(insert).select().single())
    },
    async updateSavedPhrase(id, patch) {
      return unwrap(await supabase.from('saved_phrases').update(patch).eq('id', id).select().single())
    },
    async deleteSavedPhrase(id) {
      unwrap(
        await supabase
          .from('saved_phrases')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id),
      )
    },

    // ---- Events ---------------------------------------------------------
    async listEvents(projectId) {
      return unwrap(
        await supabase
          .from('events')
          .select('*')
          .eq('project_id', projectId)
          .order('story_order', { ascending: true })
          .order('title', { ascending: true }),
      )
    },

    async createEvent(projectId, { title }) {
      const user_id = await currentUserId()
      const insert = {
        user_id,
        project_id: projectId,
        card: { description: '', involved_character_ids: [], chapter_ids: [], notes: '' },
      }
      if (title?.trim()) insert.title = title.trim()
      return unwrap(await supabase.from('events').insert(insert).select().single())
    },

    async updateEvent(id, patch) {
      return unwrap(await supabase.from('events').update(patch).eq('id', id).select().single())
    },

    async deleteEvent(id) {
      unwrap(await supabase.from('events').delete().eq('id', id))
    },

    // ---- Lexicon (read-only here; no UI yet — used by export) -----------
    async listLexicon(projectId) {
      const { data, error } = await supabase
        .from('lexicon')
        .select('*')
        .eq('project_id', projectId)
        .order('root', { ascending: true })
      // If the table is absent/unavailable, treat as "no lexicon".
      if (error) return []
      return data ?? []
    },

    // ---- Portrait images (Supabase Storage, PRIVATE bucket) -------------
    // Object path is `{uid}/{characterId}/{uuid}.{ext}`. The bucket's RLS
    // policies scope access to the user whose id is the first path segment
    // (see supabase/migrations/0002_character_portraits_storage.sql).
    async uploadPortrait(characterId, blob, { ext = 'webp', contentType } = {}) {
      const user_id = await currentUserId()
      const path = `${user_id}/${characterId}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from(PORTRAIT_BUCKET)
        .upload(path, blob, { contentType: contentType || blob.type, upsert: false })
      if (error) throw new Error(error.message || 'Upload fehlgeschlagen.')
      return path
    },

    async getPortraitUrl(path) {
      if (!path) return null
      const { data, error } = await supabase.storage
        .from(PORTRAIT_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL)
      if (error) throw new Error(error.message || 'Bild-URL konnte nicht erstellt werden.')
      return data.signedUrl
    },

    async deletePortrait(path) {
      if (!path) return
      const { error } = await supabase.storage.from(PORTRAIT_BUCKET).remove([path])
      if (error) throw new Error(error.message || 'Bild konnte nicht gelöscht werden.')
    },

    // ---- Drive backup linkage (per-user row in drive_backup, RLS) ------
    async getDriveLink() {
      const user_id = await currentUserId()
      const { data, error } = await supabase
        .from('drive_backup')
        .select('*')
        .eq('user_id', user_id)
        .maybeSingle()
      if (error) throw new Error(error.message || 'Drive-Verknüpfung konnte nicht geladen werden.')
      return data || null
    },
    // Upsert by user_id — only the provided columns are written, so a partial
    // patch (e.g. just { connected }) preserves the rest. RLS keeps it user-scoped.
    async saveDriveLink(patch) {
      const user_id = await currentUserId()
      const { data, error } = await supabase
        .from('drive_backup')
        .upsert({ user_id, ...patch }, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw new Error(error.message || 'Drive-Verknüpfung konnte nicht gespeichert werden.')
      return data
    },
  }
}
