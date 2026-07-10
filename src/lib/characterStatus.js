// Per-book character life status (card.book_status: { [bookId]: status }).
//
// 'stirbt' = the death HAPPENS within that book; 'tot' = already dead
// throughout it. A book without an entry simply has no statement yet.
//
// The DERIVED current status is the entry of the LATEST book (in the project's
// book order) that has one — that's what lists, previews and the status filter
// show. Characters that predate the per-book model fall back to their old
// single `status` column, so the migration loses nothing without any write.
export const BOOK_STATUSES = ['lebt', 'stirbt', 'tot', 'unbekannt']

export function deriveCharacterStatus(character, books = []) {
  const map = character?.card?.book_status || {}
  let latest = ''
  for (const b of books) {
    if (map[b.id]) latest = map[b.id]
  }
  return latest || character?.status || ''
}
