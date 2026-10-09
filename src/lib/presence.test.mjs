// "anwesend" vs. "erwähnt" test suite. Plain node — run with:
//   npm run test:presence
// Covers the presence helpers, the map timeline (tokens, carry-forward,
// journeys), the per-chapter PDF info page, the Markdown frontmatter, the book
// appearance filter and the text-mention assist.
import assert from 'node:assert/strict'
import {
  PRESENT,
  MENTIONED,
  presenceOf,
  isMentionedLoc,
  isPlacedLoc,
  chapterCast,
  unlinkedTextMentions,
  bookPresence,
  hasBookData,
  matchesBookFilter,
  setBookPresencePatch,
} from './presence.js'
import { placementsForChapterIndex, lastKnownPlaceBefore, journeyWaypoints } from './timeline/timeline.js'
import { infoPageNodes } from './export/book.js'
import { presentForChapter, chapterToMarkdown } from './export/markdown.js'
import { makeResolver } from './hashlinks.js'
import { makeCharacterLocation } from '../data/types.js'
import { panelMode } from '../components/chapterLayout.js'

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

const CH = ['c1', 'c2', 'c3']
const loc = (chapter_id, character_id, place_id = null, extra = {}) => ({
  id: `${chapter_id}-${character_id}-${place_id}`,
  chapter_id,
  character_id,
  place_id,
  end_place_id: null,
  ...extra,
})

console.log('\n# Presence on a chapter link')

test('legacy rows (no column yet) read as anwesend', () => {
  assert.equal(presenceOf({ character_id: 'a', place_id: 'p' }), PRESENT)
  assert.equal(presenceOf({ presence: 'erwaehnt' }), MENTIONED)
  assert.equal(isMentionedLoc({ presence: 'anwesend' }), false)
})

test('a new mentioned link never carries a place', () => {
  const row = makeCharacterLocation({ project_id: 'p1', chapter_id: 'c1', character_id: 'a', place_id: 'x', end_place_id: 'y', presence: 'erwaehnt' })
  assert.equal(row.presence, 'erwaehnt')
  assert.equal(row.place_id, null)
  assert.equal(row.end_place_id, null)
  const present = makeCharacterLocation({ project_id: 'p1', chapter_id: 'c1', character_id: 'a', place_id: 'x' })
  assert.equal(present.presence, 'anwesend')
  assert.equal(present.place_id, 'x')
})

test('only present rows with a place can be placed', () => {
  assert.equal(isPlacedLoc(loc('c1', 'a', 'p')), true)
  assert.equal(isPlacedLoc(loc('c1', 'a', null)), false)
  assert.equal(isPlacedLoc(loc('c1', 'a', 'p', { presence: 'erwaehnt' })), false) // stale place ignored
  assert.equal(isPlacedLoc(loc('c1', null, 'p')), false) // a place row
})

test('the chapter cast is split into anwesend and erwähnt', () => {
  const chars = [{ id: 'a', name: 'Zalvia' }, { id: 'b', name: 'Brend' }, { id: 'c', name: 'Amrex' }]
  const locs = [loc('c1', 'a', 'p'), loc('c1', 'b', null, { presence: 'erwaehnt' }), loc('c2', 'c', 'p'), loc('c1', null, 'p')]
  const cast = chapterCast('c1', locs, chars)
  assert.deepEqual(cast.present.map((c) => c.name), ['Zalvia'])
  assert.deepEqual(cast.mentioned.map((c) => c.name), ['Brend'])
  assert.deepEqual([...cast.linked].sort(), ['a', 'b'])
})

console.log('\n# Map timeline: a mentioned character is never placed')

test('no token for a mentioned character', () => {
  const locs = [loc('c1', 'a', 'p1'), loc('c1', 'b', 'p1', { presence: 'erwaehnt' })]
  const at = placementsForChapterIndex(locs, CH, 0)
  assert.equal(at.has('a'), true)
  assert.equal(at.has('b'), false)
})

test('being mentioned later does not move or clear the carried position', () => {
  // a is at p1 in chapter 1, only mentioned in chapter 2 → still at p1 in 2
  const locs = [loc('c1', 'a', 'p1'), loc('c2', 'a', 'p9', { presence: 'erwaehnt' })]
  assert.equal(placementsForChapterIndex(locs, CH, 1).get('a').placeId, 'p1')
  assert.equal(placementsForChapterIndex(locs, CH, 2).get('a').placeId, 'p1')
})

test('carry-forward prefill skips mentions', () => {
  const locs = [loc('c1', 'a', 'p1'), loc('c2', 'a', 'p9', { presence: 'erwaehnt' })]
  assert.equal(lastKnownPlaceBefore(locs, CH, 2, 'a'), 'p1')
})

test('journeys (routes) get no segment from a mention', () => {
  const locs = [
    loc('c1', 'a', 'p1'),
    loc('c2', 'a', 'p9', { presence: 'erwaehnt', end_place_id: 'p8' }),
    loc('c3', 'a', 'p2'),
  ]
  assert.deepEqual(journeyWaypoints(locs, CH, 2, 'a').map((w) => w.placeId), ['p1', 'p2'])
})

console.log('\n# PDF info page and Markdown export')

const SNAP = {
  characters: [{ id: 'a', name: 'Zalvia' }, { id: 'b', name: 'Brend' }],
  places: [{ id: 'p1', name: 'Thalen' }, { id: 'p9', name: 'Gehöft' }],
  events: [],
  locations: [loc('c1', 'a', 'p1'), loc('c1', 'b', 'p9', { presence: 'erwaehnt' })],
}
const CHAPTER = { id: 'c1', number: 1, title: 'Aufbruch', pov: '', status: 'entwurf', summary: '', body: 'Text' }

test('the info page lists mentioned characters separately, without a place', () => {
  let n = 0
  const nodes = infoPageNodes(CHAPTER, SNAP, (p) => `${p}#${n++}`)
  const texts = nodes.map((x) => x.text)
  const present = texts[texts.indexOf('Figuren (anwesend)') + 1]
  const mentioned = texts[texts.indexOf('Erwähnt') + 1]
  assert.equal(present, 'Zalvia: Thalen')
  assert.equal(mentioned, 'Brend')
  const places = texts[texts.indexOf('Orte') + 1]
  assert.equal(places, 'Thalen') // a stale place on a mention is not a chapter place
})

test('the Markdown frontmatter separates present and mentioned', () => {
  const p = presentForChapter('c1', SNAP)
  assert.deepEqual(p.characters, ['Zalvia'])
  assert.deepEqual(p.mentioned, ['Brend'])
  assert.deepEqual(p.places, ['Thalen'])
  const md = chapterToMarkdown(CHAPTER, { ...SNAP, project: { settings: { books: [] } } })
  assert.match(md, /characters_present:\n {2}- "Zalvia"/)
  assert.match(md, /characters_mentioned:\n {2}- "Brend"/)
})

console.log('\n# Book appearances: tritt auf vs. nur erwähnt')

const card = (books, mentioned) => ({ card: { books, books_mentioned: mentioned } })

test('per-book presence reads both lists', () => {
  assert.equal(bookPresence(card(['b1'], ['b2']), 'b1'), 'auftritt')
  assert.equal(bookPresence(card(['b1'], ['b2']), 'b2'), 'erwaehnt')
  assert.equal(bookPresence(card(['b1'], ['b2']), 'b3'), null)
  assert.equal(hasBookData(card([], [])), false)
})

test('the book filter includes or excludes "nur erwähnt" on request', () => {
  const m = card([], ['b1'])
  assert.equal(matchesBookFilter(m, 'b1'), true)
  assert.equal(matchesBookFilter(m, 'b1', { includeMentioned: false }), false)
  assert.equal(matchesBookFilter(card(['b1'], []), 'b1', { includeMentioned: false }), true)
  assert.equal(matchesBookFilter(card(['b2'], []), 'b1'), false)
  assert.equal(matchesBookFilter(card([], []), 'b1', { includeMentioned: false }), true) // no data → shown
})

test('setting a book keeps the two lists disjoint', () => {
  const c = { books: ['b1'], books_mentioned: ['b2'], introduced_in: 'b1' }
  const toMention = setBookPresencePatch(c, 'b1', 'erwaehnt')
  assert.deepEqual(toMention.books, [])
  assert.deepEqual(toMention.books_mentioned.sort(), ['b1', 'b2'])
  assert.equal(toMention.introduced_in, '') // "wird eingeführt" only for an appearance
  const back = setBookPresencePatch({ ...c, ...toMention }, 'b1', 'auftritt')
  assert.deepEqual(back.books, ['b1'])
  assert.deepEqual(back.books_mentioned, ['b2'])
  const cleared = setBookPresencePatch(c, 'b2', null)
  assert.deepEqual(cleared.books_mentioned, [])
})

console.log('\n# Assist: #Names in the text that are not linked')

test('a resolved character mention that is not linked is suggested once', () => {
  const chars = [
    { id: 'a', name: 'Zalvia', name_final: true, card: {} },
    { id: 'b', name: 'Mortius', name_final: true, card: {} },
    { id: 'c', name: 'Ilka', name_final: true, card: { aliases: ['Die Graue'] } },
  ]
  const resolver = makeResolver(chars, [{ id: 'p', name: 'Thalen', card: {} }])
  const body = '#Zalvias Bogen. #Mortius schwieg. #Mortius ging. #Die Graue kam. #Thalen lag still. #Varlea?'
  const out = unlinkedTextMentions(body, resolver, new Set(['a']))
  assert.deepEqual(out.map((x) => x.name), ['Mortius', 'Ilka']) // linked Zalvia, place, unknown name skipped
  assert.equal(out[1].written, 'Die Graue')
})

console.log('\n# Layout: the writing column never shrinks for a panel')

test('panels go side by side only when the column keeps its measure', () => {
  const col = 672
  assert.equal(panelMode(col + 32 + 320 + 300, col), 'split')
  assert.equal(panelMode(col + 32 + 320 + 299, col), 'tabs')
  assert.equal(panelMode(col + 32 + 320, col), 'tabs')
  assert.equal(panelMode(col + 32 + 319, col), 'drawer')
  assert.equal(panelMode(390, col), 'drawer') // a phone in portrait
})

console.log(`\n${failed === 0 ? 'PASS ✅' : 'FAIL ❌'} (${passed} passed, ${failed} failed)`)
process.exit(failed === 0 ? 0 : 1)
