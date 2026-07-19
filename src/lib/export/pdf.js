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
import { noBlockquote } from '../markdown.js'
import { groupChaptersByBook } from './markdown.js'
import { triggerDownload } from './util.js'
import { CHARACTER_CONFIG, PLACE_CONFIG } from '../../components/cardConfig.js'

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

async function mdToContent(md, resolver) {
  const marked = new Marked({ breaks: true })
  marked.use(noBlockquote)
  marked.use(hashlinkExtension(resolver))
  const html = marked.parse(md || '')
  const htmlToPdfmake = (await import('html-to-pdfmake')).default
  const out = htmlToPdfmake(html, { window, classesStyles: HASH_CLASS_STYLES })
  return Array.isArray(out) ? out : [out]
}

function docToBlob(pdfMake, doc) {
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(doc).getBlob((blob) => resolve(blob))
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

// ---- Public: single chapter ----------------------------------------------
export async function exportChapterPdf(chapter, snapshot, filename, onStage) {
  const pdfMake = await getPdfMake(onStage)
  const resolver = makeResolver(snapshot.characters, snapshot.places, snapshot.regions, snapshot.geoFeatures)
  const content = [
    { text: chapter.title, style: 'h1' },
    ...(chapterMeta(chapter) ? [{ text: chapterMeta(chapter), style: 'meta' }] : []),
    ...(await mdToContent(chapter.body, resolver)),
  ]
  const blob = await docToBlob(pdfMake, baseDoc(content, { title: chapter.title }))
  triggerDownload(blob, filename)
  return blob
}

// ---- Public: whole manuscript (active versions, book order) ---------------
export async function exportManuscriptPdf(snapshot, filename, onStage) {
  const pdfMake = await getPdfMake(onStage)
  const resolver = makeResolver(snapshot.characters, snapshot.places, snapshot.regions, snapshot.geoFeatures)
  const groups = groupChaptersByBook(snapshot.project, snapshot.chapters)
  const content = [{ text: snapshot.project?.name || 'Manuskript', style: 'title' }]
  let first = true
  for (const g of groups) {
    if (g.book) {
      content.push({ text: g.book.title, style: 'h1', pageBreak: first ? undefined : 'before' })
      first = false
    }
    for (const ch of g.chapters) {
      content.push({
        text: `${ch.number}. ${ch.title}`,
        style: 'h2',
        pageBreak: first ? undefined : 'before',
      })
      first = false
      content.push(...(await mdToContent(ch.body, resolver)))
    }
  }
  const blob = await docToBlob(pdfMake, baseDoc(content, { title: snapshot.project?.name }))
  triggerDownload(blob, filename)
  return blob
}

// ---- Public: a character or place card (one page) -------------------------
async function portraitToJpegDataUrl(card, getPortraitUrl) {
  if (!card.card?.portrait_path || !getPortraitUrl) return null
  const url = await getPortraitUrl(card.card.portrait_path)
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
