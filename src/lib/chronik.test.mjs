// Chronik test suite. Plain node — run with:
//   npm run test:chronik
// Covers honest fuzzy dating, the one-source-of-truth event link, filters,
// era bands, book starts, both scales and the lane packing.
import assert from 'node:assert/strict'
import {
  compactOffset,
  describeOffset,
  describeEntryDate,
  fuzzyRange,
  entryView,
  filterEntries,
  sortEntries,
  eraLabels,
  eraBands,
  bookStarts,
  overviewScale,
  storyWindow,
  storyScale,
  assignLanes,
  isSpan,
} from './chronik.js'
import { cleanTimelinePatch, makeTimelineEntry } from '../data/types.js'
import { buildWorldJson } from './export/worldJson.js'

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name}\n    ${e.message}`)
  }
}

const E = (id, year_offset, extra = {}) => ({
  id, project_id: 'p', title: id, description: '', year_offset, year_precision: 'exakt',
  duration_years: null, era_label: '', related_character_ids: [], related_place_ids: [],
  related_region_ids: [], event_id: null, visibility: 'oeffentlich', created_at: `2026-01-01T00:00:0${id.length % 10}`,
  ...extra,
})

console.log('\n# Readable, honest offsets')

test('compact offsets read like the spec', () => {
  assert.equal(compactOffset(-312), '-312 Jahre')
  assert.equal(compactOffset(0), 'Jahr 0')
  assert.equal(compactOffset(4), '+4 Jahre')
  assert.equal(compactOffset(1), '+1 Jahr')
  assert.equal(compactOffset(-200, 'ungefaehr'), '~-200 Jahre')
  assert.equal(compactOffset(-247, 'jahrzehnt'), '~-250 Jahre')
  assert.equal(compactOffset(-250, 'jahrhundert'), '3. Jh. vor Buch 1')
})

test('long forms never claim more precision than given', () => {
  assert.equal(describeOffset(-312), '312 Jahre vor Buch 1')
  assert.equal(describeOffset(-200, 'ungefaehr'), '~200 Jahre vor Buch 1')
  assert.equal(describeOffset(0), 'Jahr 0 · Beginn Buch 1')
  assert.equal(describeOffset(0, 'ungefaehr'), 'um den Beginn von Buch 1')
  assert.equal(describeOffset(4), '4 Jahre nach Beginn von Buch 1')
  assert.equal(describeOffset(-247, 'jahrzehnt'), 'um 250 Jahre vor Buch 1 (aufs Jahrzehnt)')
  assert.equal(describeOffset(-250, 'jahrhundert'), 'im 3. Jahrhundert vor Buch 1')
  assert.equal(describeOffset(-40, 'jahrhundert'), 'im 1. Jahrhundert vor Buch 1')
  assert.equal(describeOffset(130, 'jahrhundert'), 'im 2. Jahrhundert nach Beginn von Buch 1')
})

test('spans add their length and end', () => {
  const span = E('krieg', -312, { duration_years: 12 })
  assert.equal(isSpan(span), true)
  assert.equal(describeEntryDate(span), '312 Jahre vor Buch 1 · 12 Jahre lang (bis -300 Jahre)')
  assert.equal(isSpan(E('x', 0, { duration_years: 0 })), false)
})

test('fuzzy ranges: exact = point, decade = ±5, century = the whole century', () => {
  assert.deepEqual(fuzzyRange(E('a', -312)), [-312, -312])
  assert.deepEqual(fuzzyRange(E('a', -200, { year_precision: 'ungefaehr' })), [-200, -200])
  assert.deepEqual(fuzzyRange(E('a', -247, { year_precision: 'jahrzehnt' })), [-255, -245])
  assert.deepEqual(fuzzyRange(E('a', -250, { year_precision: 'jahrhundert' })), [-300, -200])
  assert.deepEqual(fuzzyRange(E('a', 30, { year_precision: 'jahrhundert' })), [0, 100])
})

console.log('\n# Data hygiene')

test('patches keep integers, never send "" to the event uuid, dedupe id lists', () => {
  const c = cleanTimelinePatch({
    year_offset: '-312.4', duration_years: '', event_id: '', year_precision: 'nonsense',
    visibility: 'x', related_character_ids: ['a', 'a', '', 'b'],
  })
  assert.equal(c.year_offset, -312)
  assert.equal(c.duration_years, null)
  assert.equal(c.event_id, null)
  assert.equal(c.year_precision, 'exakt')
  assert.equal(c.visibility, 'oeffentlich')
  assert.deepEqual(c.related_character_ids, ['a', 'b'])
  assert.equal(cleanTimelinePatch({ duration_years: -3 }).duration_years, 0)
  const made = makeTimelineEntry({ project_id: 'p', title: 'Gründung', year_offset: -400 })
  assert.equal(made.year_offset, -400)
  assert.deepEqual(made.related_region_ids, [])
})

console.log('\n# One source of truth: linked events')

const EVENTS = [
  { id: 'ev1', title: 'Fall von Thalen', place_id: 'pl1', card: { description: 'Die Stadt fällt.', involved_character_ids: ['zal'] } },
]

test('an entry linked to an event shows the event, not a copy', () => {
  const v = entryView(E('x', -3, { title: 'alt', event_id: 'ev1', related_character_ids: ['mor'] }), { events: EVENTS })
  assert.equal(v.title, 'Fall von Thalen')
  assert.equal(v.description, 'Die Stadt fällt.')
  assert.deepEqual(v.characterIds.sort(), ['mor', 'zal'])
  assert.deepEqual(v.placeIds, ['pl1'])
})

test('a deleted event leaves the entry readable', () => {
  const v = entryView(E('x', -3, { title: 'eigener Titel', event_id: 'gone' }), { events: EVENTS })
  assert.equal(v.eventMissing, true)
  assert.equal(v.title, 'eigener Titel')
})

console.log('\n# Filters, eras, ordering')

const ENTRIES = [
  E('gruendung', -1200, { era_label: 'Altes Reich', year_precision: 'jahrhundert', related_region_ids: ['nord'] }),
  E('krieg', -312, { era_label: 'Altes Reich', duration_years: 12, related_character_ids: ['mor'] }),
  E('seuche', -200, { year_precision: 'ungefaehr', visibility: 'verborgen', related_place_ids: ['pl2'] }),
  E('fall', -3, { event_id: 'ev1' }),
  E('beginn', 0, { title: 'Aufbruch' }),
  E('kroenung', 4, { era_label: 'Neue Zeit', related_character_ids: ['zal'] }),
]
const PLACES = [{ id: 'pl1', region_id: 'sued' }, { id: 'pl2', region_id: 'nord' }]
const ids = (list) => list.map((v) => v.entry.id)

test('chronological order by year_offset', () => {
  assert.deepEqual(sortEntries([...ENTRIES].reverse()).map((e) => e.id), ['gruendung', 'krieg', 'seuche', 'fall', 'beginn', 'kroenung'])
})

test('era, visibility, character (incl. via the event), place, region filters', () => {
  const opts = { events: EVENTS, places: PLACES }
  assert.deepEqual(ids(filterEntries(ENTRIES, { era: 'Altes Reich' }, opts)), ['gruendung', 'krieg'])
  assert.deepEqual(ids(filterEntries(ENTRIES, { visibility: 'verborgen' }, opts)), ['seuche'])
  assert.deepEqual(ids(filterEntries(ENTRIES, { characterId: 'zal' }, opts)), ['fall', 'kroenung'])
  assert.deepEqual(ids(filterEntries(ENTRIES, { placeId: 'pl1' }, opts)), ['fall'])
  // region: directly, or through a place lying in it
  assert.deepEqual(ids(filterEntries(ENTRIES, { regionId: 'nord' }, opts)), ['gruendung', 'seuche'])
  assert.deepEqual(ids(filterEntries(ENTRIES, { regionId: 'sued' }, opts)), ['fall'])
})

test('eras become bands over all their entries', () => {
  assert.deepEqual(eraLabels(ENTRIES), ['Altes Reich', 'Neue Zeit'])
  const bands = eraBands(ENTRIES)
  const altes = bands.find((b) => b.label === 'Altes Reich')
  // -1200 "aufs Jahrhundert" = the 12th century before Book 1 (years 1101–1200
  // before), the same convention as "1st century = years 1–100".
  assert.equal(altes.start, -1200)
  assert.equal(altes.end, -300) // the war ends 12 years after -312
})

console.log('\n# Book starts')

test('Book 1 is year 0; later books at the offsets set (or not yet placed)', () => {
  const starts = bookStarts([{ id: 'b1', title: 'Die Lichter' }, { id: 'b2', title: 'Zwei' }, { id: 'b3', title: 'Drei' }], { b2: 3, b1: 99 })
  assert.deepEqual(starts.map((s) => s.offset), [0, 3, null])
  assert.equal(starts[0].fixed, true)
})

console.log('\n# Scales: deep history never squashes the story')

test('overview (symlog): the story years stay apart even next to -1200', () => {
  const sc = overviewScale([-1200, -312, 0, 4], 1000)
  const gapStory = sc.x(4) - sc.x(0)
  const gapHistory = sc.x(-312) - sc.x(-1200)
  assert.ok(gapStory > 60, `4 story years get real width (${gapStory.toFixed(0)}px)`)
  assert.ok(gapHistory < gapStory * 3, 'deep history is compressed')
  assert.ok(sc.x(-1200) >= 40 && sc.x(4) <= 960, 'everything inside the frame')
  assert.ok(sc.ticks.includes(0) && sc.ticks.includes(-1000) && sc.ticks.includes(1))
})

test('a linear scale would squash the story — the reason for the overview', () => {
  const lin = storyScale([-1200, 4], 1000)
  assert.ok(lin.x(4) - lin.x(0) < 5)
})

test('story window spans Book 1 to past the last placed book', () => {
  const starts = bookStarts([{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }], { b2: 3, b3: 7 })
  const w = storyWindow(starts, ENTRIES)
  assert.equal(w[0], -10)
  assert.ok(w[1] >= 17)
  const sc = storyScale(w, 1000)
  assert.ok(sc.x(1) - sc.x(0) > 20, 'one story year is clearly visible')
  assert.ok(sc.ticks.includes(0))
})

test('lanes keep overlapping labels apart', () => {
  const { lanes, count } = assignLanes([
    { id: 'a', x1: 0, x2: 100 },
    { id: 'b', x1: 50, x2: 150 },
    { id: 'c', x1: 120, x2: 200 },
  ])
  assert.equal(count, 2)
  assert.notEqual(lanes.get('a'), lanes.get('b'))
  assert.equal(lanes.get('a'), lanes.get('c'))
})

console.log('\n# Export')

test('the world JSON carries the Chronik', () => {
  const json = buildWorldJson({ project: { id: 'p', name: 'Ilema', settings: { bookYearOffsets: { b2: 3 } } }, timelineEntries: ENTRIES })
  assert.equal(json.timeline_entries.length, ENTRIES.length)
  assert.equal(json.project.settings.bookYearOffsets.b2, 3)
  assert.deepEqual(buildWorldJson({}).timeline_entries, [])
})

console.log(`\n${failed === 0 ? 'PASS ✅' : 'FAIL ❌'} (${passed} passed, ${failed} failed)`)
process.exit(failed === 0 ? 0 : 1)
