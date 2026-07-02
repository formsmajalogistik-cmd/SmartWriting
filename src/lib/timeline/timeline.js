// Pure timeline maths for the map's chapter scrubber — NO React, NO Three.js,
// so it stays unit-testable and reusable (the route/journey layer, built later,
// can read the same ordering + per-chapter placements). It joins three tables:
//   chapters (+ project books for order) · character_locations · events.

// Flatten this project's chapters into a single book → chapter reading order:
// books in their stored order, each book's chapters by `number`, then loose
// chapters (book === null) last. Any orphan chapter (book id not in the book
// list) is appended rather than dropped, so scrubbing never hides a chapter.
export function orderedChapters(chapters, books = []) {
  const byBook = (bookId) =>
    chapters
      .filter((c) => c.book === bookId)
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  const out = []
  for (const b of books) out.push(...byBook(b.id))
  out.push(...byBook(null))
  const seen = new Set(out.map((c) => c.id))
  for (const c of chapters) if (!seen.has(c.id)) out.push(c)
  return out
}

// Where every character is during the chapter at orderedChapterIds[index].
// Returns a Map character_id → place_id with CARRY-FORWARD: if a character has
// no location-defining row for this chapter, they keep their most recent prior
// placement (they stay where they last were). A character never placed up to
// and including this chapter is absent from the map (don't show them).
//
// Only rows with BOTH character_id and place_id set define a location; a
// present-but-unplaced row (place_id null) doesn't move or clear the carry.
export function placementsForChapterIndex(locations, orderedChapterIds, index) {
  const result = new Map()
  if (index < 0 || index >= orderedChapterIds.length) return result
  const pos = new Map(orderedChapterIds.map((id, i) => [id, i]))
  const best = new Map() // character_id → { pos, place_id } at the latest pos ≤ index
  for (const loc of locations) {
    if (!loc.character_id || !loc.place_id) continue
    const p = pos.get(loc.chapter_id)
    if (p === undefined || p > index) continue // unknown chapter, or in the future
    const cur = best.get(loc.character_id)
    if (!cur || p >= cur.pos) best.set(loc.character_id, { pos: p, place_id: loc.place_id })
  }
  for (const [cid, v] of best) result.set(cid, v.place_id)
  return result
}

// Events linked to a chapter via their card.chapter_ids list.
export function eventsForChapter(events, chapterId) {
  if (!chapterId) return []
  return events.filter(
    (e) => Array.isArray(e.card?.chapter_ids) && e.card.chapter_ids.includes(chapterId),
  )
}

// Distinct colours for character journey lines (cycled by character order).
export const JOURNEY_COLORS = [
  '#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#b5179e',
  '#ff9f1c', '#8338ec', '#3a86ff', '#fb5607', '#2ec4b6',
]

// A character's JOURNEY up to the chapter at orderedChapterIds[upToIndex]:
// the ordered sequence of DISTINCT places they occupy (their path through the
// world), collapsing consecutive stays in the same place. Only rows with a
// place_id define a waypoint; carry-forward means staying put adds no waypoint,
// so the LAST waypoint is exactly the scrubber's carried-forward current place.
// Returns [{ placeId, index }] in travel order (index = chapter position).
export function journeyWaypoints(locations, orderedChapterIds, upToIndex, characterId) {
  if (upToIndex < 0) return []
  const pos = new Map(orderedChapterIds.map((id, i) => [id, i]))
  const rows = []
  for (const loc of locations) {
    if (loc.character_id !== characterId || !loc.place_id) continue
    const p = pos.get(loc.chapter_id)
    if (p === undefined || p > upToIndex) continue
    rows.push({ p, placeId: loc.place_id })
  }
  rows.sort((a, b) => a.p - b.p)
  const out = []
  for (const r of rows) {
    if (!out.length || out[out.length - 1].placeId !== r.placeId) {
      out.push({ placeId: r.placeId, index: r.p })
    }
  }
  return out
}
