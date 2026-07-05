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

// terrains — id, project_id, user_id, width, height, sea_level, heights
//            (base64 Uint8Array of per-cell height steps), terrain_types
//            (base64 Uint8Array of colour overrides, or null), settings, updated_at.
// One terrain per project (Phase 3, Stage A). Only the PROSE… no — only the
// per-cell heights are versioned data here; markers/timeline/routes (later
// stages) read places/character_locations and sit on top of this grid.
export function makeTerrain({ project_id, width, height, sea_level, heights, terrain_types, regions, settings }) {
  return {
    id: newId(),
    user_id: LOCAL_USER_ID,
    project_id,
    width,
    height,
    sea_level: sea_level ?? 2,
    heights: heights ?? '',
    terrain_types: terrain_types ?? null,
    // Per-cell region-slot assignment (base64 Uint8Array), or null = unassigned.
    regions: regions ?? null,
    settings: settings ?? {},
    created_at: nowIso(),
    updated_at: nowIso(),
  }
}

// regions — id, project_id, user_id, name, colour, created_at, updated_at.
// Map areas: a definition row per region; the per-cell assignment lives on the
// terrain (terrains.regions byte layer + settings.region_slots).
export function makeRegion({ project_id, name, colour }) {
  return {
    id: newId(),
    user_id: LOCAL_USER_ID,
    project_id,
    name: name?.trim() || 'Region',
    colour: colour || '#e0b341',
    created_at: nowIso(),
    updated_at: nowIso(),
  }
}

// routes — id, project_id, user_id, label, place_ids (ordered array),
//          colour, book, created_at, updated_at. Authored journey lines.
export function makeRoute({ project_id, label, colour, place_ids, book }) {
  return {
    id: newId(),
    user_id: LOCAL_USER_ID,
    project_id,
    label: label?.trim() || 'Route',
    place_ids: Array.isArray(place_ids) ? place_ids : [],
    colour: colour || '#e0b341',
    book: book ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
}

// ideas — quick brainstorming captures (Ideen tab): optional short title,
// free text content (light Markdown), optional tag strings, pinned flag.
export function makeIdea({ project_id, title, content, tags, pinned }) {
  return {
    id: newId(),
    user_id: LOCAL_USER_ID,
    project_id,
    title: title?.trim() || '',
    content: content ?? '',
    tags: Array.isArray(tags) ? tags : [],
    pinned: !!pinned,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
}

// custom_lexicon_entries — user additions to the Praemali base lexicon.
// payload mirrors the base lexicon entry shape for its entry_type; `override`
// entries shadow a base root by payload.root. project_id null = all projects.
export function makeCustomLexiconEntry({ project_id = null, entry_type, payload }) {
  return {
    id: newId(),
    user_id: LOCAL_USER_ID,
    project_id,
    entry_type,
    payload: payload ?? {},
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
  }
}

// saved_phrases — sentences saved from the Praemali builder, entered manually,
// or paste-imported. `translation` = EN meaning, `translation_de` = DE meaning;
// `unresolved` stores the validation pass's unknown tokens (flags persist until
// re-validation clears them).
export function makeSavedPhrase({
  project_id = null,
  register,
  praemali,
  gloss,
  translation,
  translation_de,
  tags,
  unresolved,
}) {
  return {
    id: newId(),
    user_id: LOCAL_USER_ID,
    project_id,
    register: register || 'common',
    praemali: praemali || '',
    gloss: gloss || '',
    translation: translation || '',
    translation_de: translation_de || '',
    tags: Array.isArray(tags) ? tags : [],
    unresolved: Array.isArray(unresolved) ? unresolved : [],
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
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
