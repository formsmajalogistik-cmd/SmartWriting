// Data shapes — mirror SPEC §3 (Supabase tables). Every non-project record
// carries `project_id`. These factories define defaults in one place so the
// eventual Supabase implementation can return identical shapes.
//
// NOTE: `user_id` is kept on records for forward-compatibility with Supabase
// RLS, but is only ever assigned a placeholder locally. The Supabase service
// role key must NEVER reach the client — only the anon key + per-user auth.

export const LOCAL_USER_ID = 'local-user'

export const CHAPTER_STATUSES = ['entwurf', 'aktiv', 'überarbeitung', 'final']

// Worldbuilding card vocabularies (Phase 2).
export const CHARACTER_ROLES = ['protagonist', 'antagonist', 'companion', 'minor', 'deity']
export const CHARACTER_LIFE_STATUSES = ['lebt', 'tot', 'unbekannt']

// Collision-resistant id without external deps.
export function newId() {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return rand
}

export function nowIso() {
  return new Date().toISOString()
}

// projects — id, user_id, name, created_at, settings (json)
// settings.books holds the per-project book list: [{ id, title }]
export function makeProject({ name }) {
  return {
    id: newId(),
    user_id: LOCAL_USER_ID,
    name: name?.trim() || 'Neues Projekt',
    created_at: nowIso(),
    settings: {
      conlang_enabled: false,
      books: [],
    },
  }
}

// chapters — id, project_id, book, number, title, version, status, pov,
//            summary, body (Markdown), updated_at
export function makeChapter({ project_id, book, number, title }) {
  return {
    id: newId(),
    project_id,
    book: book ?? null, // book id (see project.settings.books)
    number: number ?? 1,
    title: title?.trim() || 'Neues Kapitel',
    version: 1,
    status: 'entwurf',
    pov: '',
    summary: '',
    body: '', // MIRROR of the active version's body (source of truth: chapter_versions)
    active_version_id: null,
    updated_at: nowIso(),
  }
}

// chapter_versions — id, project_id, chapter_id, version_number, label, body.
// Versions hold ONLY the prose; all chapter metadata stays on the chapter row.
export function makeChapterVersion({ project_id, chapter_id, version_number, label, body }) {
  return {
    id: newId(),
    project_id,
    chapter_id,
    version_number: version_number ?? 1,
    label: label ?? `Version ${version_number ?? 1}`,
    body: body ?? '',
    created_at: nowIso(),
    updated_at: nowIso(),
  }
}

// characters — id, project_id, name, name_final, role, origin,
//              language_name, status, card, updated_at
export function makeCharacter({ project_id, name }) {
  return {
    id: newId(),
    project_id,
    name: name?.trim() || 'Namenlos',
    name_final: false,
    role: '',
    origin: '',
    language_name: '',
    status: '',
    card: {},
    updated_at: nowIso(),
  }
}

// places — id, project_id, name, name_final, region, place_type,
//          language_name, coords, card, updated_at
export function makePlace({ project_id, name }) {
  return {
    id: newId(),
    project_id,
    name: name?.trim() || 'Unbenannter Ort',
    name_final: false,
    region: '',
    place_type: '',
    language_name: '',
    coords: null, // 3D position, set in Phase 3
    card: {},
    updated_at: nowIso(),
  }
}

// character_locations — id, project_id, character_id, chapter_id, place_id
// Timeline backbone. Meaning of a row:
//   character_id set, place_id null  -> character present, location unset
//   character_id set, place_id set   -> character present at place
//   character_id null, place_id set  -> place present in chapter (no character)
export function makeCharacterLocation({ project_id, character_id, chapter_id, place_id }) {
  return {
    id: newId(),
    project_id,
    character_id: character_id ?? null,
    chapter_id,
    place_id: place_id ?? null,
  }
}

// events — id, project_id, user_id, title, place_id, book, story_order,
//          card (jsonb: description, involved_character_ids[], chapter_ids[], notes)
export function makeEvent({ project_id, title }) {
  return {
    id: newId(),
    user_id: LOCAL_USER_ID,
    project_id,
    title: title?.trim() || 'Neues Ereignis',
    place_id: null,
    book: null,
    story_order: 0,
    card: {
      description: '',
      involved_character_ids: [],
      chapter_ids: [],
      notes: '',
    },
    updated_at: nowIso(),
  }
}
