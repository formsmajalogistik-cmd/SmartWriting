// "anwesend" vs. "erwähnt" — how a character relates to a chapter or a book.
//
// This is NOT a life status (lebt / stirbt / tot / unbekannt live elsewhere);
// it is a separate axis describing presence:
//   • chapter: a character_locations row carries presence 'anwesend' (on stage,
//     may have a start/end place) or 'erwaehnt' (only mentioned — never placed:
//     no map token, no route segment, no carry-forward);
//   • book: card.books lists the books a character APPEARS in ("tritt auf"),
//     card.books_mentioned the books they are ONLY MENTIONED in.
// Machine values are ASCII ('erwaehnt'); labels are German ("erwähnt").
import { extractHashRefs } from './hashlinks.js'

export const PRESENT = 'anwesend'
export const MENTIONED = 'erwaehnt'
export const PRESENCE_LABELS = { [PRESENT]: 'anwesend', [MENTIONED]: 'erwähnt' }

// Rows written before the presence column existed count as present.
export const presenceOf = (loc) => (loc?.presence === MENTIONED ? MENTIONED : PRESENT)
export const isMentionedLoc = (loc) => presenceOf(loc) === MENTIONED
// A row that can put a character on the map: a present character with a place.
export const isPlacedLoc = (loc) => !!loc?.character_id && !!loc?.place_id && !isMentionedLoc(loc)

// The characters linked to one chapter, split by presence (card objects, by name).
export function chapterCast(chapterId, locations = [], characters = []) {
  const byId = new Map(characters.map((c) => [c.id, c]))
  const present = []
  const mentioned = []
  const seen = new Set()
  for (const l of locations) {
    if (l.chapter_id !== chapterId || !l.character_id || seen.has(l.character_id)) continue
    const c = byId.get(l.character_id)
    if (!c) continue
    seen.add(l.character_id)
    ;(isMentionedLoc(l) ? mentioned : present).push(c)
  }
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'de')
  return { present: present.sort(byName), mentioned: mentioned.sort(byName), linked: seen }
}

// ASSIST — characters a chapter's text links via #Name (incl. aliases and
// genitive forms) that are not linked to the chapter at all. Suggestion only:
// nothing is ever added automatically.
export function unlinkedTextMentions(body, resolver, linkedIds) {
  const out = []
  const seen = new Set()
  for (const ref of extractHashRefs(body || '', resolver)) {
    if (!ref.resolved || ref.card?._kind !== 'character') continue
    const id = ref.card.id
    if (linkedIds.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name: ref.card.name, written: ref.name })
  }
  return out
}

// --- books -------------------------------------------------------------------
const list = (v) => (Array.isArray(v) ? v : [])

// 'auftritt' | 'erwaehnt' | null for one book.
export function bookPresence(character, bookId) {
  if (!bookId) return null
  if (list(character?.card?.books).includes(bookId)) return 'auftritt'
  if (list(character?.card?.books_mentioned).includes(bookId)) return 'erwaehnt'
  return null
}
export const hasBookData = (character) =>
  list(character?.card?.books).length + list(character?.card?.books_mentioned).length > 0

// The Figuren book filter. Characters WITHOUT any appearance data are always
// shown (unfilled cards must never vanish); "nur erwähnt" characters are shown
// only when `includeMentioned` is on.
export function matchesBookFilter(character, bookId, { includeMentioned = true } = {}) {
  if (!bookId || !hasBookData(character)) return true
  const p = bookPresence(character, bookId)
  if (p === 'auftritt') return true
  if (p === 'erwaehnt') return includeMentioned
  return false
}

// The card patch that sets one book to 'auftritt' | 'erwaehnt' | null — the two
// lists are kept disjoint (a book is either one or the other, never both).
export function setBookPresencePatch(card, bookId, value) {
  const books = new Set(list(card?.books))
  const mentioned = new Set(list(card?.books_mentioned))
  books.delete(bookId)
  mentioned.delete(bookId)
  if (value === 'auftritt') books.add(bookId)
  if (value === 'erwaehnt') mentioned.add(bookId)
  const patch = { books: [...books], books_mentioned: [...mentioned] }
  // "Wird eingeführt" only makes sense for a book the character appears in.
  if (value !== 'auftritt' && card?.introduced_in === bookId) patch.introduced_in = ''
  return patch
}
