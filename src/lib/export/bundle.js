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
import { buildWorldJson, portraitFileName } from './worldJson.js'

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
   - portraits/ : die Figuren-Porträtbilder (Kopien aus dem Speicher).
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

  // Portraits: fetch the bytes so the bundle is self-contained.
  const withPortrait = (snapshot.characters ?? []).filter((c) => c.card?.portrait_path)
  let i = 0
  for (const c of withPortrait) {
    i += 1
    onProgress?.(`Porträts werden geladen (${i}/${withPortrait.length}) …`)
    const target = portraitFileName(c)
    try {
      const url = await getPortraitUrl?.(c.card.portrait_path)
      if (!url) throw new Error('keine URL verfügbar')
      const resp = await fetch(url)
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const bytes = new Uint8Array(await resp.arrayBuffer())
      files.push({ path: target, bytes, mime: resp.headers.get('content-type') || 'application/octet-stream' })
    } catch (e) {
      warnings.push(`Porträt für „${c.name}“ konnte nicht eingebunden werden (${e.message}). Referenz bleibt in der JSON erhalten.`)
    }
  }

  return { root, files, warnings, portraitCount: withPortrait.length }
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
