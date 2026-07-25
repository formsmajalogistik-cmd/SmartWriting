// The recoverable-export engine.
//
// `buildRecoverableBundle` produces an in-memory list of files
// (`{ path, bytes, mime }`). This is the reusable core: `bundleToZip` turns it
// into a downloadable ZIP now, and the upcoming Google Drive integration can
// reuse the SAME file list and upload each entry individually — no rework.
import { strToU8, zip } from 'fflate'
import { slugify, pad, extFromPath } from './util.js'
import {
  groupChaptersByBook,
  chapterToMarkdown,
  chapterFileName,
  bookFolderName,
  buildManuscriptMarkdown,
} from './markdown.js'
import { buildWorldJson } from './worldJson.js'
import { characterImagePaths, primaryImagePath, portraitBundleName, isLocalOnlyPath } from '../portraits.js'

const leafOf = (p) => String(p || '').split('/').pop()

const README = (projectName) => `Lumini Writing — Export: ${projectName}

Dieses Bundle enthält ZWEI Dinge:

1) WIEDERHERSTELLBARES BACKUP (maßgeblich)
   - world-data.json : vollständiger Projekt-Snapshot (Projekt, Bücher,
     Kapitel inkl. Text, Figuren, Orte, Ereignisse, character_locations,
     Lexikon). Aus dieser Datei lässt sich das Projekt vollständig
     wiederherstellen.
   - chapters/<Buch>/<NN>_<Titel>.md : ein Markdown pro Kapitel mit
     Frontmatter (Titel, Buch, Nummer, Status, POV, Zusammenfassung,
     anwesende Figuren/Orte) — die lesbare Spiegelung der Kapitel.
   - portraits/ : ALLE Bilder der Figuren (Kopien aus dem Speicher) — das
     Hauptbild als <name>-<id>.<ext>, weitere Galeriebilder als -2, -3 …
     In world-data.json ordnet „portrait_files“ jedem Speicherpfad die Datei zu.
   - manuscript.md : das komplette Manuskript in Buch-Reihenfolge (bequem).

2) Markdown/JSON ist das wiederherstellbare Backup. PDFs (separat aus der
   App) sind nur zum Lesen, nicht zur Wiederherstellung gedacht.

Format: Markdown (Text) + JSON (Weltdaten) — bewusst offen und lesbar, damit
das Projekt unabhängig von dieser App weiterlebt.
`

// snapshot: { project, chapters, characters, places, events, locations, lexicon }
// opts: { getPortraitUrl, onProgress }
export async function buildRecoverableBundle(snapshot, { getPortraitUrl, onProgress } = {}) {
  const files = []
  const warnings = []
  const projectName = snapshot.project?.name || 'Projekt'
  const root = slugify(projectName, 'projekt')
  const addText = (path, text, mime = 'text/plain') =>
    files.push({ path, bytes: strToU8(text), mime })

  addText('README.txt', README(projectName))
  addText('world-data.json', JSON.stringify(buildWorldJson(snapshot), null, 2), 'application/json')

  // One Markdown file per chapter, organised by book/number.
  const groups = groupChaptersByBook(snapshot.project, snapshot.chapters)
  for (const g of groups) {
    const folder = bookFolderName(g)
    for (const ch of g.chapters) {
      addText(`chapters/${folder}/${chapterFileName(ch)}`, chapterToMarkdown(ch, snapshot), 'text/markdown')
    }
  }

  // Convenience: the whole manuscript compiled in book order.
  addText('manuscript.md', buildManuscriptMarkdown(snapshot), 'text/markdown')

  // Portraits: fetch the bytes so the bundle is self-contained. EVERY image of
  // every character ships — the primary AND the rest of the gallery — because a
  // backup that silently drops secondary images is not recoverable. Paths come
  // from the shared resolver, so a card whose primary was never set (gallery
  // only) is no longer skipped.
  const jobs = []
  for (const c of snapshot.characters ?? []) {
    const primary = primaryImagePath(c)
    characterImagePaths(c).forEach((path, i) => {
      jobs.push({ character: c, path, target: portraitBundleName(c, path, i), isPrimary: path === primary })
    })
  }
  let done = 0
  let embedded = 0
  for (const job of jobs) {
    done += 1
    onProgress?.(`Porträts werden geladen (${done}/${jobs.length}) …`)
    const { character: c, path, target } = job
    // Say WHAT failed and WHY: the author can act on "liegt nur auf einem
    // anderen Gerät" but not on "keine URL verfügbar".
    const warn = (reason) =>
      warnings.push(
        `Bild „${leafOf(target)}“ von „${c.name}“ konnte nicht eingebunden werden: ${reason}. ` +
          `Die Referenz (${path}) bleibt in der JSON erhalten.`,
      )
    let url
    try {
      url = await getPortraitUrl?.(path)
    } catch (e) {
      warn(`Bild-URL konnte nicht erstellt werden (${e?.message || 'unbekannter Fehler'})`)
      continue
    }
    if (!url) {
      warn(
        isLocalOnlyPath(path)
          ? 'das Bild wurde nur lokal in einem anderen Browser/Gerät gespeichert und ist hier nicht vorhanden'
          : 'keine Bild-URL erhalten (Datei fehlt vermutlich im Speicher)',
      )
      continue
    }
    try {
      const resp = await fetch(url)
      if (!resp.ok) {
        warn(
          resp.status === 404 || resp.status === 400
            ? `Datei nicht im Speicher gefunden (HTTP ${resp.status})`
            : `Download fehlgeschlagen (HTTP ${resp.status})`,
        )
        continue
      }
      const bytes = new Uint8Array(await resp.arrayBuffer())
      files.push({ path: target, bytes, mime: resp.headers.get('content-type') || 'application/octet-stream' })
      embedded += 1
    } catch (e) {
      warn(`Download fehlgeschlagen (${e?.message || 'Netzwerkfehler'})`)
    }
  }

  return { root, files, warnings, portraitCount: embedded, portraitTotal: jobs.length }
}

// Turn the file list into a ZIP Blob (fflate).
export function bundleToZip(bundle) {
  return new Promise((resolve, reject) => {
    const tree = {}
    for (const f of bundle.files) tree[`${bundle.root}/${f.path}`] = f.bytes
    zip(tree, { level: 6 }, (err, data) =>
      err ? reject(err) : resolve(new Blob([data], { type: 'application/zip' })),
    )
  })
}

export { pad, extFromPath }
