// Assemble the single, authoritative JSON snapshot of a project.
//
// This file is the recoverable backbone: it contains EVERYTHING needed to
// rebuild the project — project + books, chapters (with body), characters,
// places, events, character_locations, and lexicon. The per-chapter Markdown
// files are the human-readable mirror; this JSON is the source of truth for a
// programmatic rebuild. Portrait bytes ship as separate files; each character
// carries its storage paths plus `portrait_file` (the primary) and
// `portrait_files` (every image, storage path → bundle file) so a rebuild can
// re-link the whole gallery, not just the cover image.
import { characterImagePaths, primaryImagePath, portraitBundleName } from '../portraits.js'

// The bundle file for a character's PRIMARY image (kept for compatibility with
// existing backups and rebuild tooling).
export function portraitFileName(c) {
  const primary = primaryImagePath(c)
  if (!primary) return null
  const index = characterImagePaths(c).indexOf(primary)
  return portraitBundleName(c, primary, Math.max(0, index))
}

// EVERY image of a character: storage path → bundle file, in gallery order,
// flagged so a rebuild knows which one is the primary. Secondary images used
// to be dropped from backups entirely; this is the map that recovers them.
export function portraitFileList(c) {
  const primary = primaryImagePath(c)
  return characterImagePaths(c).map((path, i) => ({
    path,
    file: portraitBundleName(c, path, i),
    primary: path === primary,
  }))
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
      portrait_file: portraitFileName(c), // primary image (bundle-relative)
      portrait_files: portraitFileList(c), // ALL images: storage path → file
    })),
    places: snapshot.places ?? [],
    events: snapshot.events ?? [],
    character_locations: snapshot.locations ?? [],
    regions: snapshot.regions ?? [],
    routes: snapshot.routes ?? [],
    geo_features: snapshot.geoFeatures ?? [],
    lexicon: snapshot.lexicon ?? [],
  }
}
