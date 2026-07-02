// Writing-progress maths — pure, read-only. Word counts of the ACTIVE version
// body (mirrored onto chapters.body), rolled up per book and for the project.
import { CHAPTER_STATUSES } from '../data/types.js'

// Count words in a Markdown body. Whitespace-separated tokens, after stripping
// the most common Markdown markup so "**bold**" or "# Heading" don't skew the
// count. Good enough for a manuscript word count (no goals/targets attached).
export function countWords(text) {
  if (!text) return 0
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/[#*_>`~\-]+/g, ' ') // emphasis / headings / list markers
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // [label](url) → label
    .trim()
  if (!cleaned) return 0
  const m = cleaned.match(/\S+/g)
  return m ? m.length : 0
}

// Roll up per-book subtotals, a whole-project total, and a status breakdown.
// `books` is the project's ordered book list (settings.books); chapters with an
// unknown/missing book id are grouped under a trailing "loose" bucket.
// Returns { books: [{ id, title, chapters:[{id,number,title,status,words}],
//                      chapterCount, words }],
//           total: { chapterCount, words },
//           byStatus: { entwurf, aktiv, überarbeitung, final } }.
export function computeProgress(chapters = [], books = []) {
  const wordsOf = (ch) => countWords(ch.body || '')
  const known = new Set(books.map((b) => b.id))
  const groups = books.map((b) => ({ id: b.id, title: b.title, chapters: [], chapterCount: 0, words: 0 }))
  const loose = { id: null, title: 'Ohne Buch', chapters: [], chapterCount: 0, words: 0 }
  const byId = new Map(groups.map((g) => [g.id, g]))

  const byStatus = Object.fromEntries(CHAPTER_STATUSES.map((s) => [s, 0]))
  let totalWords = 0
  let totalChapters = 0

  for (const ch of chapters) {
    const w = wordsOf(ch)
    totalWords += w
    totalChapters++
    if (Object.prototype.hasOwnProperty.call(byStatus, ch.status)) byStatus[ch.status]++
    const g = ch.book != null && known.has(ch.book) ? byId.get(ch.book) : loose
    g.chapters.push({ id: ch.id, number: ch.number, title: ch.title, status: ch.status, words: w })
    g.chapterCount++
    g.words += w
  }

  for (const g of [...groups, loose]) g.chapters.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  const outBooks = groups.filter((g) => g.chapterCount > 0)
  if (loose.chapterCount > 0) outBooks.push(loose)

  return {
    books: outBooks,
    total: { chapterCount: totalChapters, words: totalWords },
    byStatus,
  }
}
