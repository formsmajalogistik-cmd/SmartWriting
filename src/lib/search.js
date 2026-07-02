// Manuscript-wide search — pure, in-memory, case-insensitive.
//
// Chapters are already loaded (with their active-version body mirrored onto
// chapters.body) for the active project, so searching that array is instant for
// a full trilogy — no per-keystroke round-trip to the data layer. We match the
// ACTIVE version body of every chapter and, cheaply, card names too.

const SNIPPET_CTX = 42 // characters of context on each side of a match
const MAX_SNIPPETS = 3 // snippets shown per chapter (count still reports the rest)

// Build a display snippet around a match at [idx, idx+len) in `body`, with the
// surrounding text split into pre / match / post so the UI can highlight it.
// Whitespace is collapsed for a tidy one-line snippet; `start`/`end` are the
// ORIGINAL body offsets so a click can jump the editor to the match.
function makeSnippet(body, idx, len) {
  const from = Math.max(0, idx - SNIPPET_CTX)
  const to = Math.min(body.length, idx + len + SNIPPET_CTX)
  const clean = (s) => s.replace(/\s+/g, ' ')
  return {
    start: idx,
    end: idx + len,
    pre: (from > 0 ? '… ' : '') + clean(body.slice(from, idx)),
    match: clean(body.slice(idx, idx + len)),
    post: clean(body.slice(idx + len, to)) + (to < body.length ? ' …' : ''),
  }
}

// Search chapter bodies + (optionally) card names for `query`.
// Returns { chapters: [{ chapterId, book, number, title, count, snippets }],
//           cards:    [{ kind, id, name, name_final }] }.
// Chapter results are ordered by book (using `books` order) then chapter number.
export function searchManuscript(query, { chapters = [], books = [], characters = [], places = [], events = [] } = {}) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return { chapters: [], cards: [] }

  const bookIndex = new Map(books.map((b, i) => [b.id, i]))
  const chapterResults = []
  for (const ch of chapters) {
    const body = ch.body || ''
    if (!body) continue
    const hay = body.toLowerCase()
    let idx = hay.indexOf(q)
    if (idx === -1) continue
    let count = 0
    const snippets = []
    while (idx !== -1) {
      count++
      if (snippets.length < MAX_SNIPPETS) snippets.push(makeSnippet(body, idx, q.length))
      idx = hay.indexOf(q, idx + q.length)
    }
    chapterResults.push({
      chapterId: ch.id,
      book: ch.book ?? null,
      number: ch.number,
      title: ch.title,
      count,
      snippets,
    })
  }
  chapterResults.sort(
    (a, b) =>
      (bookIndex.has(a.book) ? bookIndex.get(a.book) : Number.MAX_SAFE_INTEGER) -
        (bookIndex.has(b.book) ? bookIndex.get(b.book) : Number.MAX_SAFE_INTEGER) ||
      (a.number ?? 0) - (b.number ?? 0),
  )

  const cards = []
  for (const c of characters) if ((c.name || '').toLowerCase().includes(q)) cards.push({ kind: 'character', id: c.id, name: c.name, name_final: c.name_final })
  for (const p of places) if ((p.name || '').toLowerCase().includes(q)) cards.push({ kind: 'place', id: p.id, name: p.name, name_final: p.name_final })
  for (const e of events) if ((e.title || '').toLowerCase().includes(q)) cards.push({ kind: 'event', id: e.id, name: e.title, name_final: true })

  return { chapters: chapterResults, cards }
}
