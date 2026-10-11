// CHRONIK — the in-universe timeline. Pure computation (no React, no DOM), so
// dating, filters and both scales are unit-tested.
//
// Dating is relative to the story: year_offset = whole years relative to the
// START of Book 1 (0 = Beginn Buch 1, negative = before). Later books begin at
// offsets the author sets (project.settings.bookYearOffsets). Fuzzy dates are
// shown HONESTLY — "~200 Jahre vor Buch 1", "im 3. Jahrhundert vor Buch 1" —
// never with a precision the author didn't claim.

export const PRECISIONS = ['exakt', 'ungefaehr', 'jahrzehnt', 'jahrhundert']
export const PRECISION_LABELS = {
  exakt: 'exakt',
  ungefaehr: 'ungefähr',
  jahrzehnt: 'aufs Jahrzehnt',
  jahrhundert: 'aufs Jahrhundert',
}
export const VISIBILITIES = ['oeffentlich', 'verborgen']
export const VISIBILITY_LABELS = { oeffentlich: 'öffentlich bekannt', verborgen: 'verborgen' }

const int = (v) => Math.round(Number(v) || 0)
const jahre = (n) => (Math.abs(n) === 1 ? '1 Jahr' : `${Math.abs(n)} Jahre`)
const uniq = (list) => [...new Set((list || []).filter(Boolean))]

export const isSpan = (e) => e?.duration_years != null && int(e.duration_years) > 0
export const entryStart = (e) => int(e?.year_offset)
export const entryEnd = (e) => entryStart(e) + (isSpan(e) ? int(e.duration_years) : 0)

// --- readable offsets --------------------------------------------------------
// Compact form for axes and lists: "Jahr 0", "-312 Jahre", "+4 Jahre";
// "~" marks a fuzzy date, centuries read "3. Jh. vor Buch 1".
export function compactOffset(offset, precision = 'exakt') {
  const n = int(offset)
  if (precision === 'jahrhundert') return centuryText(n, true)
  const base = n === 0 ? 'Jahr 0' : `${n > 0 ? '+' : '-'}${jahre(n)}`
  if (precision === 'exakt') return base
  if (precision === 'jahrzehnt') {
    const d = Math.round(n / 10) * 10
    return d === 0 ? '~Jahr 0' : `~${d > 0 ? '+' : '-'}${jahre(d)}`
  }
  return `~${base}`
}

function centuryText(n, compact) {
  if (n === 0) return compact ? '~Jahr 0 (Jh.)' : 'im Jahrhundert um den Beginn von Buch 1'
  const c = Math.ceil(Math.abs(n) / 100) || 1
  if (compact) return `${c}. Jh. ${n < 0 ? 'vor' : 'nach'} Buch 1`
  return n < 0 ? `im ${c}. Jahrhundert vor Buch 1` : `im ${c}. Jahrhundert nach Beginn von Buch 1`
}

// Long, honest form for the detail and the list: "312 Jahre vor Buch 1",
// "~200 Jahre vor Buch 1", "um 250 Jahre vor Buch 1 (aufs Jahrzehnt)",
// "im 3. Jahrhundert vor Buch 1", "Jahr 0 · Beginn Buch 1".
export function describeOffset(offset, precision = 'exakt') {
  const n = int(offset)
  if (precision === 'jahrhundert') return centuryText(n, false)
  if (precision === 'jahrzehnt') {
    const d = Math.round(n / 10) * 10
    if (d === 0) return 'im Jahrzehnt um den Beginn von Buch 1'
    return `um ${jahre(d)} ${d < 0 ? 'vor Buch 1' : 'nach Beginn von Buch 1'} (aufs Jahrzehnt)`
  }
  const fuzzy = precision === 'ungefaehr'
  if (n === 0) return fuzzy ? 'um den Beginn von Buch 1' : 'Jahr 0 · Beginn Buch 1'
  const text = n < 0 ? `${jahre(n)} vor Buch 1` : `${jahre(n)} nach Beginn von Buch 1`
  return fuzzy ? `~${text}` : text
}

// The whole dating of an entry, spans included.
export function describeEntryDate(entry) {
  const start = describeOffset(entry?.year_offset, entry?.year_precision)
  if (!isSpan(entry)) return start
  const until = compactOffset(entryEnd(entry), entry?.year_precision)
  return `${start} · ${jahre(int(entry.duration_years))} lang (bis ${until})`
}

// How uncertain the START is, as a year interval: an exact year is a point; a
// decade covers ±5 years; a century covers that whole century. "ungefähr"
// claims no particular width, so it stays a point (drawn dashed instead).
export function fuzzyRange(entry) {
  const n = entryStart(entry)
  switch (entry?.year_precision) {
    case 'jahrzehnt': {
      const d = Math.round(n / 10) * 10
      return [d - 5, d + 5]
    }
    case 'jahrhundert': {
      if (n === 0) return [-50, 50]
      const c = Math.ceil(Math.abs(n) / 100) || 1
      return n < 0 ? [-c * 100, -(c - 1) * 100] : [(c - 1) * 100, c * 100]
    }
    default:
      return [n, n]
  }
}

// --- one source of truth: an entry linked to an event shows the EVENT ---------
export function entryView(entry, { events = [] } = {}) {
  const ev = entry?.event_id ? events.find((e) => e.id === entry.event_id) || null : null
  return {
    entry,
    event: ev,
    eventMissing: !!entry?.event_id && !ev,
    title: ev ? ev.title || '(Ereignis ohne Titel)' : entry?.title || '(ohne Titel)',
    description: ev ? ev.card?.description || '' : entry?.description || '',
    characterIds: uniq([...(entry?.related_character_ids || []), ...(ev?.card?.involved_character_ids || [])]),
    placeIds: uniq([...(entry?.related_place_ids || []), ev?.place_id]),
    regionIds: uniq(entry?.related_region_ids || []),
  }
}

// --- filters -------------------------------------------------------------------
// era, character, place, region (a place inside the region counts too) and
// visibility. Returns entry views in chronological order.
export function filterEntries(entries = [], filters = {}, { events = [], places = [] } = {}) {
  const { era = '', characterId = '', placeId = '', regionId = '', visibility = '' } = filters
  const placeRegion = new Map(places.map((p) => [p.id, p.region_id || null]))
  return sortEntries(entries)
    .map((e) => entryView(e, { events }))
    .filter((v) => {
      const e = v.entry
      if (era && (e.era_label || '') !== era) return false
      if (visibility && (e.visibility || 'oeffentlich') !== visibility) return false
      if (characterId && !v.characterIds.includes(characterId)) return false
      if (placeId && !v.placeIds.includes(placeId)) return false
      if (regionId && !v.regionIds.includes(regionId) && !v.placeIds.some((p) => placeRegion.get(p) === regionId)) {
        return false
      }
      return true
    })
}

export function sortEntries(entries = []) {
  return [...entries].sort(
    (a, b) => entryStart(a) - entryStart(b) || entryEnd(b) - entryEnd(a) || (a.created_at || '').localeCompare(b.created_at || ''),
  )
}

export function eraLabels(entries = []) {
  return uniq(entries.map((e) => (e.era_label || '').trim())).sort((a, b) => a.localeCompare(b, 'de'))
}

// Eras as bands: every era label spans from its earliest to its latest entry
// (fuzzy ranges and spans included). A span entry named after the era makes the
// band as long as the author wants it.
export function eraBands(entries = []) {
  const bands = new Map()
  for (const e of entries) {
    const label = (e.era_label || '').trim()
    if (!label) continue
    const [lo, hi] = fuzzyRange(e)
    const start = Math.min(lo, entryStart(e))
    const end = Math.max(hi, entryEnd(e))
    const b = bands.get(label)
    if (!b) bands.set(label, { label, start, end })
    else {
      b.start = Math.min(b.start, start)
      b.end = Math.max(b.end, end)
    }
  }
  return [...bands.values()].sort((a, b) => a.start - b.start || a.label.localeCompare(b.label, 'de'))
}

// --- book starts -----------------------------------------------------------
// Book 1 (the first book) begins at year 0 by definition; later books at the
// offset the author set (null = not placed yet).
export function bookStarts(books = [], offsets = {}) {
  return books.map((b, i) => ({
    id: b.id,
    title: b.title || `Buch ${i + 1}`,
    index: i,
    fixed: i === 0,
    offset: i === 0 ? 0 : Number.isFinite(offsets?.[b.id]) ? offsets[b.id] : null,
  }))
}

// --- scales ----------------------------------------------------------------
// OVERVIEW: a symmetric logarithmic axis. 1, 10, 100, 1000 years from Book 1
// are equally far apart, so deep history and the trilogy's own handful of
// years are both readable — the story is never squashed into one point.
export const symlog = (x) => Math.sign(x) * Math.log10(1 + Math.abs(x))
export const symexp = (y) => Math.sign(y) * (10 ** Math.abs(y) - 1)

export function overviewScale(years, width, pad = 40) {
  const lo = Math.min(0, ...years)
  const hi = Math.max(0, ...years)
  let a = symlog(lo)
  let b = symlog(hi)
  if (b - a < 1) {
    a -= 0.5
    b += 0.5
  }
  const span = b - a
  a -= span * 0.04
  b += span * 0.04
  const x = (year) => pad + ((symlog(year) - a) / (b - a)) * (width - pad * 2)
  const ticks = [0]
  for (let p = 0; p <= 6; p++) {
    const v = 10 ** p
    if (symlog(v) <= b) ticks.push(v)
    if (symlog(-v) >= a) ticks.push(-v)
  }
  return { x, ticks: ticks.sort((m, n) => m - n), domain: [symexp(a), symexp(b)], kind: 'overview' }
}

// STORY: a plain linear axis over the story's own years (a little before Book 1
// up to past the last placed book). Entries outside are counted at the edges.
export function storyWindow(starts = [], entries = []) {
  const placed = starts.filter((s) => s.offset != null).map((s) => s.offset)
  const lastBook = Math.max(0, ...placed)
  const cap = lastBook + 50
  let hi = Math.max(10, lastBook + 10)
  for (const e of entries) {
    const s = entryStart(e)
    if (s >= 0 && s <= cap) hi = Math.max(hi, Math.min(entryEnd(e), cap) + 2)
  }
  return [-10, hi]
}

export function storyScale([lo, hi], width, pad = 40) {
  const x = (year) => pad + ((year - lo) / (hi - lo)) * (width - pad * 2)
  const range = hi - lo
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => range / s <= 12) || 1000
  const ticks = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)
  if (!ticks.includes(0)) ticks.push(0)
  return { x, ticks: ticks.sort((m, n) => m - n), domain: [lo, hi], kind: 'story' }
}

// Stack overlapping items into lanes (greedy, by left edge), so labels never
// sit on top of each other. items: [{ id, x1, x2 }] in pixels.
export function assignLanes(items, gap = 8) {
  const laneEnds = []
  const lanes = new Map()
  for (const it of [...items].sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2)) {
    let lane = laneEnds.findIndex((end) => end + gap <= it.x1)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(it.x2)
    } else laneEnds[lane] = it.x2
    lanes.set(it.id, lane)
  }
  return { lanes, count: laneEnds.length }
}
