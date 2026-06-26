// Client-side PDF generation (readability layer — not for recovery).
// pdfmake + html-to-pdfmake are lazy-loaded so they never bloat the app shell.
//
// Markdown is rendered to HTML (with the #Name extension) and converted to
// pdfmake content; #Name references appear as plain, styled text (no links).
import { Marked } from 'marked'
import { makeResolver, hashlinkExtension } from '../hashlinks.js'
import { groupChaptersByBook } from './markdown.js'
import { triggerDownload } from './util.js'
import { CHARACTER_CONFIG, PLACE_CONFIG } from '../../components/cardConfig.js'

let _pdfMakePromise = null
async function getPdfMake() {
  if (!_pdfMakePromise) {
    _pdfMakePromise = (async () => {
      const mod = await import('pdfmake/build/pdfmake')
      const fontsMod = await import('pdfmake/build/vfs_fonts')
      const pdfMake = mod.default || mod
      const vfs =
        fontsMod.default?.pdfMake?.vfs ||
        fontsMod.pdfMake?.vfs ||
        fontsMod.default?.vfs ||
        fontsMod.vfs
      if (vfs) pdfMake.vfs = vfs
      return pdfMake
    })()
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
export async function exportChapterPdf(chapter, snapshot, filename) {
  const pdfMake = await getPdfMake()
  const resolver = makeResolver(snapshot.characters, snapshot.places)
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
export async function exportManuscriptPdf(snapshot, filename) {
  const pdfMake = await getPdfMake()
  const resolver = makeResolver(snapshot.characters, snapshot.places)
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

export async function exportCardPdf(kind, card, snapshot, opts, filename) {
  const pdfMake = await getPdfMake()
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
