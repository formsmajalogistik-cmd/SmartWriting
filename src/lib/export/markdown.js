// Build human-readable Markdown for chapters + a compiled manuscript.
import { slugify, pad, toFrontmatter } from './util.js'

// Order chapters by book (project.settings.books order) then chapter number;
// chapters without a book go into a trailing "Ohne Buch" group.
export function groupChaptersByBook(project, chapters) {
  const books = project?.settings?.books ?? []
  const groups = books.map((b, i) => ({ book: b, bookIndex: i + 1, chapters: [] }))
  const loose = { book: null, bookIndex: books.length + 1, chapters: [] }
  const byId = new Map(groups.map((g) => [g.book.id, g]))
  for (const ch of chapters) {
    const g = (ch.book && byId.get(ch.book)) || loose
    g.chapters.push(ch)
  }
  for (const g of [...groups, loose]) {
    g.chapters.sort((a, b) => (a.number || 0) - (b.number || 0) || a.title.localeCompare(b.title))
  }
  return [...groups, loose].filter((g) => g.chapters.length)
}

// Distinct present character / place names for a chapter (from locations).
export function presentForChapter(chapterId, { locations, characters, places }) {
  const locs = locations.filter((l) => l.chapter_id === chapterId)
  const charIds = [...new Set(locs.filter((l) => l.character_id).map((l) => l.character_id))]
  const placeIds = [...new Set(locs.filter((l) => l.place_id).map((l) => l.place_id))]
  const cName = (id) => characters.find((c) => c.id === id)?.name || id
  const pName = (id) => places.find((p) => p.id === id)?.name || id
  return { characters: charIds.map(cName), places: placeIds.map(pName) }
}

// One chapter as a Markdown file: frontmatter (incl. ids for a faithful
// rebuild) + the verbatim body. Body is kept exact so it round-trips losslessly.
export function chapterToMarkdown(ch, snapshot) {
  const bookTitle = snapshot.project?.settings?.books?.find((b) => b.id === ch.book)?.title || ''
  const present = presentForChapter(ch.id, snapshot)
  const fm = toFrontmatter({
    id: ch.id,
    title: ch.title,
    book: bookTitle,
    book_id: ch.book || '',
    number: ch.number,
    version: ch.version ?? 1,
    status: ch.status,
    pov: ch.pov || '',
    summary: ch.summary || '',
    characters_present: present.characters,
    places_present: present.places,
    updated_at: ch.updated_at || '',
  })
  const body = (ch.body || '').replace(/\s+$/, '')
  return `${fm}\n\n${body}\n`
}

export function chapterFileName(ch) {
  return `${pad(ch.number)}_${slugify(ch.title, 'kapitel')}.md`
}
export function bookFolderName(group) {
  return group.book ? `${pad(group.bookIndex)}_${slugify(group.book.title, 'buch')}` : 'Ohne-Buch'
}

// The whole manuscript compiled in book order (active versions).
export function buildManuscriptMarkdown(snapshot) {
  const groups = groupChaptersByBook(snapshot.project, snapshot.chapters)
  let out = `# ${snapshot.project?.name || 'Manuskript'}\n`
  for (const g of groups) {
    if (g.book) out += `\n\n# ${g.book.title}\n`
    for (const ch of g.chapters) {
      out += `\n\n## ${ch.number}. ${ch.title}\n\n`
      out += (ch.body || '').trim() + '\n'
    }
  }
  return out + '\n'
}
