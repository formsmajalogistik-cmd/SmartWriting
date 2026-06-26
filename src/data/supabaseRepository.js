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
      return unwrap(await supabase.from('chapters').insert(insert).select().single())
    },

    async updateChapter(id, patch) {
      return unwrap(
        await supabase.from('chapters').update(patch).eq('id', id).select().single(),
      )
    },

    async deleteChapter(id) {
      // character_locations cascade via chapter FK.
      unwrap(await supabase.from('chapters').delete().eq('id', id))
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
  }
}
