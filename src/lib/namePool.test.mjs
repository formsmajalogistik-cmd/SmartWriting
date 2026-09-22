// Namenspool test suite. Plain node — run with:
//   npm run test:namepool
// Covers live "used" derivation, region matching, collision warnings, the
// filters/random pick, and the IDEMPOTENT import of the real seed registry.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import {
  usedNameIndex,
  matchRegion,
  regionLabel,
  regionKey,
  regionOptions,
  collisionPrefix,
  parseNamePoolJson,
  planNamePoolImport,
  decorate,
  filterPool,
  pickRandom,
  tagOptions,
  categoryOptions,
} from './namePool.js'

const here = dirname(fileURLToPath(import.meta.url))
const seedRaw = JSON.parse(readFileSync(join(here, '../../seed/ilema-namenspool.json'), 'utf8'))

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

const REGIONS = [
  { id: 'r-adn', name: 'Adneroth' },
  { id: 'r-agr', name: 'Agrinal' },
  { id: 'r-dwe', name: 'Dwenrih' },
  { id: 'r-rum', name: 'Rumatia' },
  { id: 'r-wan', name: 'Wanilomnir' },
]
// The pool rows an import would produce (used as the "already imported" state).
const asRows = (create) =>
  create.map((c, i) => ({ id: `n${i}`, project_id: 'p1', hidden: false, notes: '', ...c }))

console.log('\n# Used names are derived live from the character cards')

test('a character name and its aliases mark pool names as used', () => {
  const idx = usedNameIndex([
    { id: 'c1', name: 'Bram', card: {} },
    { id: 'c2', name: 'Ilka', card: { aliases: ['Die Graue', 'Yrsa'] } },
  ])
  assert.equal(idx.get('bram').character.id, 'c1')
  assert.equal(idx.get('yrsa').character.id, 'c2')
  assert.equal(idx.get('yrsa').alias, 'Yrsa')
  assert.equal(idx.get('die graue').character.id, 'c2')
  assert.equal(idx.has('edda'), false)
})

test('matching is case-insensitive and ignores surrounding space', () => {
  const idx = usedNameIndex([{ id: 'c1', name: '  bRAm ', card: {} }])
  assert.ok(idx.has('bram'))
})

test('deleting the character frees the name again (nothing is stored)', () => {
  const pool = [{ id: 'n1', name: 'Bram', gender: 'männlich', category: 'Vorname', tags: [] }]
  const withChar = decorate(pool, { characters: [{ id: 'c1', name: 'Bram', card: {} }] })
  assert.ok(withChar[0].used)
  const without = decorate(pool, { characters: [] })
  assert.equal(without[0].used, null)
})

console.log('\n# Regions: card match, free-text fallback')

test('a region name matches its card, case-insensitively', () => {
  assert.equal(matchRegion(REGIONS, 'adneroth')?.id, 'r-adn')
  assert.equal(matchRegion(REGIONS, 'Porsiran (Hauptstadt)'), null)
  assert.equal(matchRegion(REGIONS, ''), null)
})

test('the label falls back to the text (and survives a deleted region card)', () => {
  assert.equal(regionLabel({ region_id: 'r-adn' }, REGIONS), 'Adneroth')
  assert.equal(regionLabel({ region_id: null, region_text: 'Porsiran (Hauptstadt)' }, REGIONS), 'Porsiran (Hauptstadt)')
  assert.equal(regionLabel({ region_id: 'gone', region_text: 'Adneroth' }, REGIONS), 'Adneroth')
  assert.equal(regionKey({ region_id: 'gone', region_text: 'Adneroth' }, REGIONS), 't:adneroth')
})

console.log('\n# Collision warnings follow the EDITABLE prefix list')

test('a protected prefix flags the name, case-insensitively', () => {
  assert.equal(collisionPrefix('Valsk', seedRaw.collision_prefixes), 'Val')
  assert.equal(collisionPrefix('tandric', seedRaw.collision_prefixes), 'Tan')
  assert.equal(collisionPrefix('Bram', seedRaw.collision_prefixes), null)
})

test('editing the list changes the warnings live', () => {
  assert.equal(collisionPrefix('Bram', []), null)
  assert.equal(collisionPrefix('Bram', ['Bra']), 'Bra')
  assert.equal(collisionPrefix('Valsk', ['Tan']), null) // prefix removed → no warning
})

test('the seed file and the live rule agree on the flagged names', () => {
  const flaggedInFile = seedRaw.names.filter((n) => n.collision_warning).map((n) => n.name).sort()
  const flaggedLive = seedRaw.names
    .filter((n) => collisionPrefix(n.name, seedRaw.collision_prefixes))
    .map((n) => n.name)
    .sort()
  assert.deepEqual(flaggedLive, flaggedInFile)
})

console.log('\n# Import: the whole registry, once')

test('the seed file parses (210 names, 10 prefixes)', () => {
  const parsed = parseNamePoolJson(seedRaw)
  assert.equal(parsed.error, null)
  assert.equal(parsed.names.length, seedRaw.names.length)
  assert.equal(parsed.names.length, 210)
  assert.deepEqual(parsed.prefixes, seedRaw.collision_prefixes)
})

test('a bare array of names is accepted; junk is rejected with a German message', () => {
  assert.equal(parseNamePoolJson([{ name: 'Bram', region: 'Agrinal' }]).names.length, 1)
  assert.ok(parseNamePoolJson({ foo: 1 }).error)
  assert.ok(parseNamePoolJson('nope').error)
  assert.ok(parseNamePoolJson({ names: [{ name: '' }] }).error)
})

test('every name is imported, regions matched to cards where they exist', () => {
  const parsed = parseNamePoolJson(seedRaw)
  const plan = planNamePoolImport(parsed.names, { pool: [], regions: REGIONS })
  assert.equal(plan.create.length, 210)
  assert.equal(plan.skipped, 0)
  const adn = plan.create.find((c) => c.name === 'Brendson')
  assert.equal(adn.region_id, 'r-adn')
  assert.equal(adn.region_text, '')
  const capital = plan.create.find((c) => c.name === 'Adristan')
  assert.equal(capital.region_id, null)
  assert.equal(capital.region_text, 'Porsiran (Hauptstadt)')
  assert.deepEqual(plan.matchedRegions.unmatched, ['Porsiran (Hauptstadt)'])
})

test('re-importing the same file adds nothing', () => {
  const parsed = parseNamePoolJson(seedRaw)
  const first = planNamePoolImport(parsed.names, { pool: [], regions: REGIONS })
  const again = planNamePoolImport(parsed.names, { pool: asRows(first.create), regions: REGIONS })
  assert.equal(again.create.length, 0)
  assert.equal(again.skipped, 210)
})

test('a name already in the pool by hand is skipped, spelling and case aside', () => {
  const pool = [{ id: 'x', name: ' bram ', region_id: 'r-agr', region_text: '' }]
  const plan = planNamePoolImport(parseNamePoolJson(seedRaw).names, { pool, regions: REGIONS })
  assert.equal(plan.skipped, 1)
  assert.equal(plan.create.some((c) => c.name === 'Bram'), false)
})

test('the same name in ANOTHER region is a separate entry', () => {
  const pool = [{ id: 'x', name: 'Bram', region_id: 'r-adn', region_text: '' }]
  const plan = planNamePoolImport([{ name: 'Bram', region: 'Agrinal', gender: 'männlich', category: 'Vorname', tags: [] }], {
    pool,
    regions: REGIONS,
  })
  assert.equal(plan.create.length, 1)
  assert.equal(plan.create[0].region_id, 'r-agr')
})

test('importing again after the region CARD appeared does not duplicate', () => {
  const parsed = parseNamePoolJson(seedRaw)
  // First import with no region cards at all → everything as free text.
  const first = planNamePoolImport(parsed.names, { pool: [], regions: [] })
  assert.equal(first.create.length, 210)
  // Now the cards exist; the stored rows still carry the same region TEXT.
  const again = planNamePoolImport(parsed.names, { pool: asRows(first.create), regions: REGIONS })
  assert.equal(again.create.length, 0)
  assert.equal(again.skipped, 210)
})

console.log('\n# Browsing: filters, hidden names, random pick')

const POOL = [
  { id: '1', name: 'Bram', region_id: 'r-agr', region_text: '', gender: 'männlich', category: 'Vorname', tags: ['Wirt/Händler'], notes: '', hidden: false },
  { id: '2', name: 'Edda', region_id: 'r-agr', region_text: '', gender: 'weiblich', category: 'Vorname', tags: ['Alt'], notes: '', hidden: false },
  { id: '3', name: 'Valsk', region_id: 'r-dwe', region_text: '', gender: 'weiblich', category: 'Vorname', tags: [], notes: '', hidden: false },
  { id: '4', name: 'Adristan', region_id: null, region_text: 'Porsiran (Hauptstadt)', gender: 'männlich', category: 'Vorname', tags: [], notes: 'Kanzleischreiber', hidden: false },
  { id: '5', name: 'Brendtam', region_id: 'r-adn', region_text: '', gender: 'neutral', category: 'Praemali-Patronym (-tam)', tags: [], notes: '', hidden: true },
]
const CHARS = [{ id: 'c1', name: 'Edda', card: {} }]
const dec = () => decorate(POOL, { characters: CHARS, regions: REGIONS, prefixes: ['Val'] })

test('used names are hidden by default and shown on request', () => {
  assert.equal(filterPool(dec(), {}).some((d) => d.entry.name === 'Edda'), false)
  const withUsed = filterPool(dec(), { showUsed: true })
  const edda = withUsed.find((d) => d.entry.name === 'Edda')
  assert.equal(edda.used.character.id, 'c1')
})

test('hidden names never show unless asked for', () => {
  assert.equal(filterPool(dec(), {}).some((d) => d.entry.name === 'Brendtam'), false)
  assert.equal(filterPool(dec(), { showHidden: true }).some((d) => d.entry.name === 'Brendtam'), true)
})

test('region / gender / category / tag / search filter', () => {
  assert.deepEqual(filterPool(dec(), { region: 'r:r-agr' }).map((d) => d.entry.name), ['Bram'])
  assert.deepEqual(filterPool(dec(), { region: 't:porsiran (hauptstadt)' }).map((d) => d.entry.name), ['Adristan'])
  assert.deepEqual(filterPool(dec(), { gender: 'weiblich' }).map((d) => d.entry.name), ['Valsk'])
  assert.deepEqual(filterPool(dec(), { tag: 'Wirt/Händler' }).map((d) => d.entry.name), ['Bram'])
  assert.deepEqual(filterPool(dec(), { category: 'Vorname' }).map((d) => d.entry.name), ['Bram', 'Valsk', 'Adristan'])
  assert.deepEqual(filterPool(dec(), { query: 'kanzlei' }).map((d) => d.entry.name), ['Adristan'])
  assert.deepEqual(filterPool(dec(), { query: 'dwenrih' }).map((d) => d.entry.name), ['Valsk'])
})

test('the warning rides along with the row', () => {
  const valsk = dec().find((d) => d.entry.name === 'Valsk')
  assert.equal(valsk.warning, 'Val')
  assert.equal(dec().find((d) => d.entry.name === 'Bram').warning, null)
})

test('the random pick only ever offers a free, visible name', () => {
  const list = filterPool(dec(), { showUsed: true, showHidden: true })
  for (let i = 0; i < 50; i++) {
    const p = pickRandom(list, Math.random)
    assert.ok(p)
    assert.equal(p.used, null)
    assert.equal(p.entry.hidden, false)
  }
  assert.equal(pickRandom([]), null)
  // Respects the current filters: nothing free in Agrinal but Bram.
  const agrinal = filterPool(dec(), { region: 'r:r-agr' })
  assert.equal(pickRandom(agrinal, () => 0).entry.name, 'Bram')
})

test('filter dropdowns list what is actually in the pool', () => {
  assert.deepEqual(regionOptions(POOL, REGIONS).map((o) => o.label), [
    'Adneroth', 'Agrinal', 'Dwenrih', 'Porsiran (Hauptstadt)',
  ])
  assert.deepEqual(tagOptions(POOL), ['Alt', 'Wirt/Händler'])
  assert.deepEqual(categoryOptions(POOL), ['Praemali-Patronym (-tam)', 'Vorname'])
})

console.log(`\n${failed === 0 ? 'PASS ✅' : 'FAIL ❌'} (${passed} passed, ${failed} failed)`)
process.exit(failed === 0 ? 0 : 1)
