// Assemble the single, authoritative JSON snapshot of a project.
//
// This file is the recoverable backbone: it contains EVERYTHING needed to
// rebuild the project — project + books, chapters (with body), characters,
// places, events, character_locations, and lexicon. The per-chapter Markdown
// files are the human-readable mirror; this JSON is the source of truth for a
// programmatic rebuild. Portrait bytes ship as separate files; each character
// carries both its storage `portrait_path` and the bundle-relative
// `portrait_file` so a rebuild can re-link images.
import { slugify, extFromPath } from './util.js'

export function portraitFileName(c) {
  if (!c.card?.portrait_path) return null
  const ext = extFromPath(c.card.portrait_path, 'img')
  return `portraits/${slugify(c.name, 'figur')}-${c.id}.${ext}`
}

export function buildWorldJson(snapshot, exportedAt = new Date().toISOString()) {
  return {
    // `schema` is an internal, versioned identifier for rebuild tooling — keep stable.
    schema: 'smartwriting/project-export@1',
    app: 'Lumini Writing',
    exported_at: exportedAt,
    note:
      'Vollständiger Projekt-Snapshot zur Wiederherstellung. Die .md-Dateien sind die lesbare Spiegelung; diese JSON ist die maßgebliche Quelle.',
    project: {
      id: snapshot.project?.id ?? null,
      name: snapshot.project?.name ?? '',
      settings: snapshot.project?.settings ?? {},
      created_at: snapshot.project?.created_at ?? null,
    },
    chapters: (snapshot.chapters ?? []).map((c) => ({
      id: c.id,
      project_id: c.project_id,
      book: c.book ?? null,
      number: c.number,
      title: c.title,
      version: c.version ?? 1,
      status: c.status,
      pov: c.pov ?? '',
      summary: c.summary ?? '',
      body: c.body ?? '',
      updated_at: c.updated_at ?? null,
    })),
    characters: (snapshot.characters ?? []).map((c) => ({
      ...c,
      portrait_file: portraitFileName(c),
    })),
    places: snapshot.places ?? [],
    events: snapshot.events ?? [],
    character_locations: snapshot.locations ?? [],
    regions: snapshot.regions ?? [],
    lexicon: snapshot.lexicon ?? [],
  }
}
