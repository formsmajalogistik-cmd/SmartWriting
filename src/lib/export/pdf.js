// Client-side PDF generation (readability layer — not for recovery).
//
// pdfmake (~1.3 MB) and its fonts (~855 kB) are heavy and only needed for the
// occasional PDF export. They are imported as URLs (`?url`) — Vite emits them as
// plain static assets, NOT as part of the JS module graph — and injected as
// <script> tags ONLY on the first PDF export. So they never load on app
// startup, never bloat the initial bundle, and don't trip the chunk-size
// warning. (The service worker also excludes them from precache; see
// vite.config.js.) Markdown/JSON export works without ever touching this file.
//
// Markdown is rendered to HTML (with the #Name extension) and converted to
// pdfmake content; #Name references appear as plain, styled text (no links).
import { Marked } from 'marked'
import pdfMakeUrl from 'pdfmake/build/pdfmake.min.js?url'
import vfsUrl from 'pdfmake/build/vfs_fonts.js?url'
import { makeResolver, hashlinkExtension } from '../hashlinks.js'
import { primaryImagePath } from '../portraits.js'
import { noBlockquote } from '../markdown.js'
import { groupChaptersByBook } from './markdown.js'
import { triggerDownload } from './util.js'
import { CHARACTER_CONFIG, PLACE_CONFIG } from '../../components/cardConfig.js'
import {
  mm,
  TRIM_PRESETS,
  DEFAULT_TRIM,
  trimById,
  BOOK_FONTS,
  BOOK_AFM_FILES,
  shapeProse,
  buildBookContent,
  buildBookDoc,
  newRecord,
  makeRecorder,
  bodyNumbering,
  chapterPageCounts,
} from './book.js'

export { TRIM_PRESETS, DEFAULT_TRIM }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pdf-src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded) return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Skript-Ladefehler')))
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.dataset.pdfSrc = src
    s.onload = () => {
      s.dataset.loaded = '1'
      resolve()
    }
    s.onerror = () => reject(new Error('PDF-Bibliothek konnte nicht geladen werden.'))
    document.head.appendChild(s)
  })
}

let _pdfMakePromise = null
// Lazily load pdfmake + fonts on first use. pdfmake.min.js (UMD) defines
// window.pdfMake; vfs_fonts.js then registers the fonts via
// pdfMake.addVirtualFileSystem(). onStage reports progress for the UI.
function getPdfMake(onStage) {
  if (!_pdfMakePromise) {
    _pdfMakePromise = (async () => {
      onStage?.('PDF-Bibliothek wird geladen …')
      await loadScript(pdfMakeUrl)
      await loadScript(vfsUrl)
      if (!window.pdfMake) throw new Error('PDF-Bibliothek nicht verfügbar.')
      return window.pdfMake
    })().catch((e) => {
      _pdfMakePromise = null // allow retry after a failed load
      throw e
    })
  }
  return _pdfMakePromise
}

const STYLES = {
  title: { fontSize: 26, bold: true, margin: [0, 0, 0, 6] },
  h1: { fontSize: 20, bold: true, margin: [0, 14, 0, 6] },
  h2: { fontSize: 15, bold: true, margin: [0, 10, 0, 4] },
  meta: { fontSize: 9, color: '#777', margin: [0, 0, 0, 12] },
  label: { fontSize: 10, bold: true, color: '#555', margin: [0, 8, 0, 1] },
}
const HASH_CLASS_STYLES = {
  hashlink: { color: '#4f46e5' },
  resolved: { color: '#4f46e5' },
  provisional: { color: '#b45309' },
  unresolved: { color: '#b91c1c' },
  ambiguous: { color: '#7e22ce' },
}

function baseDoc(content, info = {}) {
  return {
    info,
    pageSize: 'A4',
    pageMargins: [64, 64, 64, 64],
    defaultStyle: { fontSize: 11, lineHeight: 1.35 },
    styles: STYLES,
    content,
  }
}

async function mdToContent(md, resolver, opts = {}) {
  const marked = new Marked({ breaks: !opts.book }) // book prose: blank line = new paragraph
  marked.use(noBlockquote)
  marked.use(hashlinkExtension(resolver))
  const html = marked.parse(md || '')
  const htmlToPdfmake = (await import('html-to-pdfmake')).default
  const out = htmlToPdfmake(html, {
    window,
    classesStyles: HASH_CLASS_STYLES,
    // Book prose is one continuous flow: no gaps between paragraphs, and the
    // #Name links print as ordinary text (colour would be noise on paper).
    ...(opts.book
      ? {
          defaultStyles: {
            p: { margin: [0, 0, 0, 0] },
            h1: { fontSize: 13, bold: true, marginBottom: 4 },
            h2: { fontSize: 12, bold: true, marginBottom: 3 },
            h3: { fontSize: 11, bold: true, marginBottom: 3 },
            a: { color: '#000', decoration: '' },
          },
        }
      : {}),
  })
  const arr = Array.isArray(out) ? out : [out]
  return opts.book ? shapeProse(arr) : arr
}

// The standard-font metrics, fetched once on the first book export. pdfkit
// asks the virtual file system for "data/<font>.afm"; pdfmake's default VFS
// only carries Roboto, so book documents get their own VFS (card exports keep
// the default one and stay on Roboto).
let _afmPromise = null
function getBookVfs() {
  if (!_afmPromise) {
    _afmPromise = Promise.all(
      BOOK_AFM_FILES.map(async (name) => {
        const res = await fetch(`/pdf-fonts/${name}.afm`)
        if (!res.ok) throw new Error(`Schriftmetriken fehlen (${name}).`)
        return [`data/${name}.afm`, await res.text()]
      }),
    )
      .then(Object.fromEntries)
      .catch((e) => {
        _afmPromise = null // allow a retry on the next export
        throw e
      })
  }
  return _afmPromise
}

function docToBlob(pdfMake, doc, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const pdf = opts.book
        ? pdfMake.createPdf(doc, null, BOOK_FONTS, opts.vfs)
        : pdfMake.createPdf(doc)
      pdf.getBlob((blob) => resolve(blob))
    } catch (e) {
      reject(e)
    }
  })
}

function chapterMeta(ch) {
  const parts = []
  if (ch.status) parts.push(`Status: ${ch.status}`)
  if (ch.pov) parts.push(`POV: ${ch.pov}`)
  if (ch.summary) parts.push(ch.summary)
  return parts.join('   ·   ')
}

// ---- Book-formatted story PDF ---------------------------------------------
// Rendered TWICE on purpose. pdfmake reports where each node landed only after
// a full layout pass, so pass 1 records the page of every chapter opening and
// of every info page; pass 2 uses those to print running heads and BODY page
// numbers that skip the info pages. Headers and footers live in the margins,
// so adding them in pass 2 cannot move a single line of the story — the page
// numbers recorded in pass 1 are exactly the ones printed.
async function renderBook({ pdfMake, snapshot, groups, resolver, trim, infoPages, info, onStage }) {
  const proseByChapter = new Map()
  for (const g of groups) {
    for (const ch of g.chapters) {
      proseByChapter.set(ch.id, await mdToContent(ch.body, resolver, { book: true }))
    }
  }
  const buildContent = () =>
    buildBookContent({
      snapshot,
      groups,
      infoPages,
      // Fresh copies per pass: pdfmake annotates the nodes it lays out.
      prose: (ch) => structuredClone(proseByChapter.get(ch.id) || []),
    })

  onStage?.('Schriftmetriken werden geladen …')
  const vfs = await getBookVfs()

  onStage?.('Seiten werden umbrochen …')
  const rec = newRecord()
  await docToBlob(
    pdfMake,
    buildBookDoc({ trim, content: buildContent(), info, hooks: { pageBreakBefore: makeRecorder(rec) } }),
    { book: true, vfs },
  )

  onStage?.('Buchsatz wird erzeugt …')
  const chapterOpen = new Set(rec.chapterStart.values())
  const projectTitle = snapshot.project?.name || 'Manuskript'
  const bookOfChapter = new Map()
  for (const g of groups) for (const ch of g.chapters) bookOfChapter.set(ch.id, g.book?.title || projectTitle)
  const chapterTitleByPage = [...rec.chapterStart.entries()]
    .map(([id, page]) => {
      const ch = snapshot.chapters?.find((c) => c.id === id)
      return {
        page,
        chapter: ch ? `${ch.number != null ? `${ch.number}. ` : ''}${ch.title || ''}`.trim() : '',
        book: bookOfChapter.get(id) || projectTitle,
      }
    })
    .sort((a, b) => a.page - b.page)
  // The running head belongs to whichever chapter the page falls in.
  const headFor = (page) => {
    let cur = null
    for (const entry of chapterTitleByPage) {
      if (entry.page <= page) cur = entry
      else break
    }
    return cur
  }

  let numbering = null
  const captured = { pageCount: 0 }
  const numberingFor = (pageCount) => {
    if (!numbering || captured.pageCount !== pageCount) {
      captured.pageCount = pageCount
      numbering = bodyNumbering(rec, pageCount)
    }
    return numbering
  }

  const bare = (page) => rec.front.has(page) || rec.parts.has(page) || chapterOpen.has(page)
  const doc = buildBookDoc({
    trim,
    content: buildContent(),
    info,
    hooks: {
      header: (currentPage) => {
        if (rec.info.has(currentPage) || bare(currentPage)) return null
        // Verso carries the book, recto the chapter — the usual arrangement.
        const head = headFor(currentPage)
        const text = currentPage % 2 === 0 ? head?.book || projectTitle : head?.chapter || projectTitle
        return { text, style: 'runningHead', margin: [0, mm(trim.margins.top) - 16, 0, 0] }
      },
      footer: (currentPage, pageCount) => {
        const n = numberingFor(pageCount)
        if (rec.info.has(currentPage)) {
          return { text: 'Kapitel-Info (außerhalb der Seitenzählung)', style: 'infoFolio', margin: [0, 8, 0, 0] }
        }
        if (rec.front.has(currentPage) || bare(currentPage)) return null
        const num = n.map.get(currentPage)
        return num == null ? null : { text: String(num), style: 'folio', margin: [0, 8, 0, 0] }
      },
    },
  })
  const blob = await docToBlob(pdfMake, doc, { book: true, vfs })

  const chapters = snapshot.chapters ? chapterPageCounts(rec, numbering || bodyNumbering(rec, captured.pageCount), groups.flatMap((g) => g.chapters)) : []
  return {
    blob,
    bodyPages: (numbering || bodyNumbering(rec, captured.pageCount)).total,
    totalPages: captured.pageCount,
    infoPageCount: rec.info.size,
    chapters,
  }
}

// ---- Public: single chapter (same book format, for a per-chapter estimate) --
export async function exportChapterPdf(chapter, snapshot, filename, onStage, opts = {}) {
  const pdfMake = await getPdfMake(onStage)
  const resolver = makeResolver(snapshot.characters, snapshot.places, snapshot.regions, snapshot.geoFeatures)
  const trim = trimById(opts.trim || DEFAULT_TRIM)
  const result = await renderBook({
    pdfMake,
    snapshot: { ...snapshot, project: { ...snapshot.project, name: chapter.title || 'Kapitel' }, chapters: [chapter] },
    groups: [{ book: null, chapters: [chapter] }],
    resolver,
    trim,
    infoPages: !!opts.infoPages,
    info: { title: chapter.title },
    onStage,
  })
  triggerDownload(result.blob, filename)
  return result
}

// ---- Public: whole manuscript (active versions, book order) ---------------
export async function exportManuscriptPdf(snapshot, filename, onStage, opts = {}) {
  const pdfMake = await getPdfMake(onStage)
  const resolver = makeResolver(snapshot.characters, snapshot.places, snapshot.regions, snapshot.geoFeatures)
  const trim = trimById(opts.trim || DEFAULT_TRIM)
  const groups = groupChaptersByBook(snapshot.project, snapshot.chapters)
  const result = await renderBook({
    pdfMake,
    snapshot,
    groups,
    resolver,
    trim,
    infoPages: !!opts.infoPages,
    info: { title: snapshot.project?.name },
    onStage,
  })
  triggerDownload(result.blob, filename)
  return result
}

// ---- Public: a character or place card (one page) -------------------------
async function portraitToJpegDataUrl(card, getPortraitUrl) {
  const path = primaryImagePath(card)
  if (!path || !getPortraitUrl) return null
  const url = await getPortraitUrl(path)
  if (!url) return null
  const resp = await fetch(url)
  if (!resp.ok) return null
  const blob = await resp.blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.9)
}

function fieldRows(card, fields, fromCard) {
  const rows = []
  for (const f of fields) {
    let v = fromCard ? card.card?.[f.key] : card[f.key]
    if (Array.isArray(v)) v = v.filter(Boolean).join(', ')
    if (v == null || String(v).trim() === '') continue
    rows.push({ text: f.label, style: 'label' })
    rows.push({ text: String(v), margin: [0, 0, 0, 2] })
  }
  return rows
}

export async function exportCardPdf(kind, card, snapshot, opts, filename, onStage) {
  const pdfMake = await getPdfMake(onStage)
  const config = kind === 'character' ? CHARACTER_CONFIG : PLACE_CONFIG
  const content = []

  if (kind === 'character') {
    try {
      const dataUrl = await portraitToJpegDataUrl(card, opts?.getPortraitUrl)
      if (dataUrl) content.push({ image: dataUrl, width: 150, margin: [0, 0, 0, 12] })
    } catch {
      /* portrait optional in the PDF; skip on failure */
    }
  }

  content.push({ text: card.name || '(ohne Namen)', style: 'h1' })
  if (!card.name_final) content.push({ text: 'provisorischer Name', style: 'meta' })

  content.push(...fieldRows(card, config.topFields, false))
  if (config.detailFields) content.push(...fieldRows(card, config.detailFields, true))
  if (config.listFields) content.push(...fieldRows(card, config.listFields, true))
  if (config.physicalNotes) content.push(...fieldRows(card, config.physicalNotes, true))
  content.push(...fieldRows(card, config.cardFields, true))

  const blob = await docToBlob(pdfMake, baseDoc(content, { title: card.name }))
  triggerDownload(blob, filename)
  return blob
}
