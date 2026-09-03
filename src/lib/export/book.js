// Book typesetting for the PDF export.
//
// The manuscript used to come out as a generic A4 document, which says nothing
// useful about length: A4 at 11pt holds roughly twice the text of a paperback
// page, so the page count was about half of what the printed book would be.
// This module lays the story out on a real trim size with book margins,
// a serif face, justified paragraphs and first-line indents, so the resulting
// page count is a believable estimate for pacing.
//
// ENGINE LIMITS worth knowing (pdfmake 0.2.x), both handled below:
//   • `pageMargins` is set once for the whole document — margins cannot be
//     MIRRORED per recto/verso. The binding (inner) margin is therefore applied
//     to the left of every page: the text block has exactly the width a
//     mirrored layout would give it, so pagination is identical; only the
//     position on the sheet differs (every page looks like a recto).
//   • no hyphenation support, so justified German lines can run loose.
import { countWords } from '../progress.js'

const MM = 2.834645669 // 1 mm in PDF points

export const mm = (v) => Math.round(v * MM * 100) / 100

// Paperback trims. Margins are in mm: inner (binding side), outer, top, bottom.
export const TRIM_PRESETS = [
  {
    id: 'tb125',
    label: 'Taschenbuch 12,5 × 20 cm',
    width: 125, height: 200,
    margins: { inner: 17, outer: 12, top: 14, bottom: 16 },
    fontSize: 10.5, leading: 14.5,
  },
  {
    id: 'pb135',
    label: 'Paperback 13,5 × 21,5 cm',
    width: 135, height: 215,
    margins: { inner: 18, outer: 13, top: 15, bottom: 17 },
    fontSize: 10.5, leading: 15,
  },
  {
    id: 'a5',
    label: 'A5 14,8 × 21 cm',
    width: 148, height: 210,
    margins: { inner: 20, outer: 15, top: 16, bottom: 18 },
    fontSize: 11, leading: 15.5,
  },
]
export const DEFAULT_TRIM = 'tb125'
export const trimById = (id) => TRIM_PRESETS.find((t) => t.id === id) || TRIM_PRESETS[0]

// Times is one of the 14 standard PDF fonts: every reader supplies it, so the
// book gets a serif face with NO embedded font (small files, no font licence
// travels along). Only the metrics travel — see public/pdf-fonts/README.txt.
// WinAnsi covers what German prose needs: umlauts, ß and the guillemets »«.
export const BOOK_FONTS = {
  Times: {
    normal: 'Times-Roman',
    bold: 'Times-Bold',
    italics: 'Times-Italic',
    bolditalics: 'Times-BoldItalic',
  },
}
export const BOOK_AFM_FILES = ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic']

// A first-line indent, as a novel sets it (~1em). pdfmake has no text-indent
// property and TRIMS leading spaces unless told otherwise — without
// preserveLeadingSpaces the indent silently disappears.
// (Both flags matter: a run of only spaces is otherwise measured and then
// discarded again as trailing whitespace, leaving no indent at all.)
const indentRun = () => ({ text: '    ', preserveLeadingSpaces: true, preserveTrailingSpaces: true })

// ---- content shaping -------------------------------------------------------

// Turn html-to-pdfmake output into book paragraphs: justified, no space
// between them, first line indented — except the paragraph that OPENS a
// chapter or follows a scene break, as in print.
export function shapeProse(nodes) {
  const out = []
  let atOpening = true // no indent on the first paragraph of a chapter/scene
  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      out.push(node)
      continue
    }
    // <hr> arrives as a drawn line; a novel uses an asterism instead.
    if (node.canvas) {
      out.push({ text: '* * *', style: 'sceneBreak' })
      atOpening = true
      continue
    }
    if (node.text !== undefined) {
      const isHeading = Array.isArray(node.style) && node.style.some((s) => /^h[1-6]$/.test(s))
      const shaped = { ...node, margin: [0, 0, 0, 0] }
      if (isHeading) {
        shaped.alignment = 'center'
        shaped.margin = [0, 10, 0, 6]
        out.push(shaped)
        atOpening = true
        continue
      }
      shaped.alignment = 'justify'
      if (!atOpening) {
        shaped.text = Array.isArray(shaped.text)
          ? [indentRun(), ...shaped.text]
          : [indentRun(), { text: shaped.text }]
      }
      atOpening = false
      out.push(shaped)
      continue
    }
    out.push(node)
    atOpening = false
  }
  return out
}

// ---- per-chapter info page -------------------------------------------------

// Where each present character starts and (optionally) ends this chapter.
function characterLines(chapter, snapshot) {
  const placeName = (id) => snapshot.places?.find((p) => p.id === id)?.name || null
  const rows = (snapshot.locations || []).filter((l) => l.chapter_id === chapter.id && l.character_id)
  return rows
    .map((l) => {
      const name = snapshot.characters?.find((c) => c.id === l.character_id)?.name || '(unbekannt)'
      const from = placeName(l.place_id)
      const to = placeName(l.end_place_id)
      // "→" is not in WinAnsi, which the standard PDF fonts use — spell it out.
      if (from && to && to !== from) return `${name}: von ${from} bis ${to}`
      if (from) return `${name}: ${from}`
      return name
    })
    .sort((a, b) => a.localeCompare(b))
}

function placeLines(chapter, snapshot) {
  const ids = new Set(
    (snapshot.locations || [])
      .filter((l) => l.chapter_id === chapter.id)
      .flatMap((l) => [l.place_id, l.end_place_id])
      .filter(Boolean),
  )
  return [...ids]
    .map((id) => snapshot.places?.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

function eventLines(chapter, snapshot) {
  return (snapshot.events || [])
    .filter((e) => (e.card?.chapter_ids ?? []).includes(chapter.id))
    .map((e) => e.title)
    .filter(Boolean)
}

// One info page per chapter. Every node is tagged with the SAME id prefix so
// the layout pass can record EVERY page the block occupies (a long cast list
// may run over); those pages are then left out of the body page numbering,
// keeping the story's page count truthful. pdfmake requires ids to be unique,
// hence the "#n" suffix — the recorder matches on the prefix.
export function infoPageNodes(chapter, snapshot, uid) {
  const id = () => uid(`info:${chapter.id}`)
  const nodes = [
    { text: 'Kapitel-Info', style: 'infoHead', pageBreak: 'before', id: id() },
    { text: `${chapter.number}. ${chapter.title || 'Kapitel'}`, style: 'infoTitle', id: id() },
  ]
  const row = (label, value) => {
    if (!value || (Array.isArray(value) && !value.length)) return
    nodes.push({ text: label, style: 'infoLabel', id: id() })
    nodes.push({
      text: Array.isArray(value) ? value.join(' · ') : String(value),
      style: 'infoValue',
      id: id(),
    })
  }
  row('POV', chapter.pov)
  row('Status', chapter.status)
  row('Zusammenfassung', chapter.summary)
  row('Figuren', characterLines(chapter, snapshot))
  row('Orte', placeLines(chapter, snapshot))
  row('Ereignisse', eventLines(chapter, snapshot))
  row('Wörter', countWords(chapter.body).toLocaleString('de-DE'))
  return nodes
}

// ---- document assembly -----------------------------------------------------

// Build the content array. `prose(chapter)` returns already-shaped pdfmake
// nodes for a chapter body (async conversion happens in the caller).
export function buildBookContent({ snapshot, groups, prose, infoPages }) {
  const content = []
  // pdfmake demands unique node ids; the recorder reads only the prefix.
  let n = 0
  const uid = (prefix) => `${prefix}#${n++}`
  // Title page — front matter, excluded from the body numbering.
  content.push(
    { text: snapshot.project?.name || 'Manuskript', style: 'bookTitle', id: uid('front') },
    { text: 'Manuskript', style: 'bookSubtitle', id: uid('front') },
  )
  for (const g of groups) {
    if (g.book) {
      // Half-title for each book: a printed page, so it counts — but bare.
      content.push({ text: g.book.title, style: 'partTitle', pageBreak: 'before', id: uid(`part:${g.book.id}`) })
    }
    for (const ch of g.chapters) {
      if (infoPages) content.push(...infoPageNodes(ch, snapshot, uid))
      content.push({
        text: ch.number != null ? `${ch.number}. ${ch.title || ''}`.trim() : ch.title || 'Kapitel',
        style: 'chapterTitle',
        pageBreak: 'before',
      })
      // Zero-height marker right after the heading: pdfmake skips nodes that
      // carry `pageBreak: 'before'` when reporting layout positions, so the
      // chapter's start page is recorded from this node instead.
      content.push({ text: ' ', id: uid(`chs:${ch.id}`), fontSize: 1, margin: [0, 0, 0, 0] })
      content.push(...prose(ch))
    }
  }
  return content
}

export function bookStyles(trim) {
  return {
    bookTitle: { fontSize: 22, bold: true, alignment: 'center', margin: [0, mm(45), 0, 8] },
    bookSubtitle: { fontSize: 11, italics: true, alignment: 'center', color: '#444' },
    partTitle: { fontSize: 18, bold: true, alignment: 'center', margin: [0, mm(50), 0, 0] },
    chapterTitle: { fontSize: 14, bold: true, alignment: 'center', margin: [0, mm(28), 0, mm(10)] },
    sceneBreak: { alignment: 'center', margin: [0, trim.leading, 0, trim.leading] },
    infoHead: { fontSize: 8, characterSpacing: 1, color: '#777', margin: [0, 0, 0, mm(6)] },
    infoTitle: { fontSize: 13, bold: true, margin: [0, 0, 0, mm(5)] },
    infoLabel: { fontSize: 8, bold: true, color: '#666', margin: [0, mm(3), 0, 1] },
    infoValue: { fontSize: 9.5, margin: [0, 0, 0, 0] },
    runningHead: { fontSize: 8, italics: true, color: '#666', alignment: 'center' },
    folio: { fontSize: 9, alignment: 'center', color: '#333' },
    infoFolio: { fontSize: 7.5, italics: true, alignment: 'center', color: '#999' },
  }
}

// The document shell. `hooks` supplies the recording callback (pass 1) or the
// header/footer builders (pass 2) — the body layout is identical in both, so
// the page numbers recorded in pass 1 are exactly the ones pass 2 prints.
export function buildBookDoc({ trim, content, info, hooks = {} }) {
  return {
    info,
    pageSize: { width: mm(trim.width), height: mm(trim.height) },
    // [inner, top, outer, bottom] — see the note at the top of this file.
    pageMargins: [mm(trim.margins.inner), mm(trim.margins.top), mm(trim.margins.outer), mm(trim.margins.bottom)],
    defaultStyle: {
      font: 'Times',
      fontSize: trim.fontSize,
      lineHeight: trim.leading / trim.fontSize,
      alignment: 'justify',
    },
    styles: bookStyles(trim),
    content,
    ...(hooks.pageBreakBefore ? { pageBreakBefore: hooks.pageBreakBefore } : {}),
    ...(hooks.header ? { header: hooks.header } : {}),
    ...(hooks.footer ? { footer: hooks.footer } : {}),
  }
}

// ---- page bookkeeping ------------------------------------------------------

export function newRecord() {
  return { front: new Set(), info: new Set(), parts: new Set(), chapterStart: new Map(), pageCount: 0 }
}

// pdfmake calls this for every laid-out node (one argument only — more
// parameters make it walk the whole node list per node).
export function makeRecorder(rec) {
  return (node) => {
    const raw = node?.id
    const pages = node?.pageNumbers || []
    if (!raw || !pages.length) return false
    const id = raw.split('#')[0] // ids are unique per node; the prefix classifies
    if (id === 'front') pages.forEach((p) => rec.front.add(p))
    else if (id.startsWith('info:')) pages.forEach((p) => rec.info.add(p))
    else if (id.startsWith('part:')) pages.forEach((p) => rec.parts.add(p))
    else if (id.startsWith('chs:')) rec.chapterStart.set(id.slice(4), pages[0])
    return false
  }
}

// Body numbering: title page and info pages don't get a number, and don't
// consume one either — so "page 200" is the 200th page of the STORY.
export function bodyNumbering(rec, pageCount) {
  const map = new Map()
  let n = 0
  for (let p = 1; p <= pageCount; p++) {
    if (rec.front.has(p) || rec.info.has(p)) continue
    map.set(p, ++n)
  }
  return { map, total: n }
}

// Pages per chapter, in body pages (info pages in between never count).
export function chapterPageCounts(rec, numbering, chapters) {
  const starts = chapters
    .map((ch) => ({ ch, page: rec.chapterStart.get(ch.id) }))
    .filter((x) => x.page != null)
    .sort((a, b) => a.page - b.page)
  return starts.map((entry, i) => {
    const from = numbering.map.get(entry.page)
    const nextPage = starts[i + 1]?.page
    const to = nextPage != null ? numbering.map.get(nextPage) : numbering.total + 1
    return {
      id: entry.ch.id,
      title: entry.ch.title,
      number: entry.ch.number,
      startPage: from ?? null,
      pages: from != null && to != null ? Math.max(1, to - from) : 1,
    }
  })
}
