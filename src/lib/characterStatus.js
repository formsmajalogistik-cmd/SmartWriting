// Per-book character life status (card.book_status: { [bookId]: status }).
//
// 'stirbt' = the death HAPPENS within that book; 'tot' = already dead
// throughout it. A book without an entry simply has no statement yet.
//
// The DERIVED status is computed AS OF a book (the app's ACTIVE book from the
// top-bar dropdown): the most recent per-book entry up to and including it.
// A 'stirbt' from an EARLIER book counts as 'tot' for later books (unless a
// later entry overrides it); 'stirbt' only shows for the book the death
// happens in. Without activeBookId the full book range is considered (the
// character's overall latest status — also what the legacy `status` column
// mirrors). Characters that predate the per-book model fall back to their old
// single `status` column, so the migration loses nothing without any write.
export const BOOK_STATUSES = ['lebt', 'stirbt', 'tot', 'unbekannt']

export function deriveCharacterStatus(character, books = [], activeBookId = null) {
  const map = character?.card?.book_status || {}
  const activeIdx = activeBookId ? books.findIndex((b) => b.id === activeBookId) : -1
  const end = activeIdx >= 0 ? activeIdx : books.length - 1
  let latest = ''
  let latestIdx = -1
  for (let i = 0; i <= end && i < books.length; i++) {
    if (map[books[i].id]) {
      latest = map[books[i].id]
      latestIdx = i
    }
  }
  if (!latest) return character?.status || ''
  if (latest === 'stirbt' && latestIdx < end) return 'tot' // died in an earlier book
  return latest
}
