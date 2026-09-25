// Character-relationship test suite. Plain node — run with:
//   npm run test:relations
// Covers symmetric vs directional types (automatic inverses), derived family
// links, the integrity rules, the graph filters and both layouts.
import assert from 'node:assert/strict'
import {
  REL_TYPES,
  forwardLabel,
  backwardLabel,
  isSymmetric,
  relationsOf,
  parentIds,
  childIds,
  spouseIds,
  siblingIds,
  derivedFor,
  derivedForWithUncertainty,
  findDuplicate,
  findReverseConflict,
  wouldCycle,
  findCycles,
  buildGraph,
  generations,
  familyLayout,
  forceLayout,
} from './relationships.js'
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

// --- a small cast -----------------------------------------------------------
const C = (id, name, role = 'minor', books = []) => ({ id, name, role, name_final: true, card: { books } })
const CHARS = [
  C('ulf', 'Ulf'), C('yrsa', 'Yrsa'),
  C('brend', 'Brend'), C('frida', 'Frida'), C('halla', 'Halla'), C('torvik', 'Torvik'),
  C('zalvia', 'Zalvia', 'protagonist', ['b1']), C('mortius', 'Mortius', 'antagonist', ['b1']),
  C('kelda', 'Kelda'), C('amrex', 'Amrex'), C('nekta', 'Nekta'),
  C('sertorius', 'Sertorius', 'randfigur', ['b2']), C('palmiro', 'Palmiro', 'randfigur'),
  C('sawl', 'Sawl', 'deity'),
]
let seq = 0
const rel = (from, to, type, extra = {}) => ({
  id: `r${++seq}`, project_id: 'p1', from_character_id: from, to_character_id: to,
  type, note: '', started_book: null, ended_book: null, uncertain: false,
  created_at: `2026-01-${String(seq).padStart(2, '0')}`, ...extra,
})
const RELS = [
  rel('ulf', 'brend', 'elternteil'), rel('yrsa', 'brend', 'elternteil'),
  rel('ulf', 'halla', 'elternteil'), rel('yrsa', 'halla', 'elternteil'),
  rel('ulf', 'yrsa', 'ehepartner'),
  rel('brend', 'frida', 'ehepartner'),
  rel('brend', 'zalvia', 'elternteil'), rel('frida', 'zalvia', 'elternteil'),
  rel('brend', 'mortius', 'elternteil'), rel('frida', 'mortius', 'elternteil'),
  rel('halla', 'torvik', 'ehepartner'), rel('halla', 'kelda', 'elternteil'),
  rel('zalvia', 'amrex', 'ehepartner'), rel('zalvia', 'nekta', 'elternteil'),
  rel('sertorius', 'zalvia', 'mentor'),
  rel('zalvia', 'palmiro', 'feind'),
  // an unrevealed parentage: Sawl is Amrex's parent, but not public fact
  rel('sawl', 'amrex', 'elternteil', { uncertain: true }),
]
const nameOf = (id) => CHARS.find((c) => c.id === id)?.name || id
const namesOf = (list) => list.map(nameOf).sort()

console.log('\n# Types: symmetric vs directional')

test('every type is either symmetric or carries an inverse', () => {
  for (const t of REL_TYPES) {
    if (t.symmetric) assert.equal(t.inverse, undefined, `${t.key} is symmetric and needs no inverse`)
    else assert.ok(t.inverse, `${t.key} needs an inverse label`)
  }
})

test('a symmetric type reads the same from both sides', () => {
  assert.equal(forwardLabel('geschwister'), 'Geschwister')
  assert.equal(backwardLabel('geschwister'), 'Geschwister')
  assert.equal(isSymmetric('ehepartner'), true)
})

test('a directional type reads its inverse on the other side', () => {
  assert.deepEqual([forwardLabel('elternteil'), backwardLabel('elternteil')], ['Elternteil', 'Kind'])
  assert.deepEqual([forwardLabel('mentor'), backwardLabel('mentor')], ['Mentor', 'Schüler'])
  assert.deepEqual([forwardLabel('herr'), backwardLabel('herr')], ['Herr', 'Dienender'])
})

console.log('\n# One row, correct label on both cards')

test('the parent sees "Kind", the child sees "Elternteil" — entered once', () => {
  const stored = RELS.filter((r) => r.type === 'elternteil' && r.from_character_id === 'brend' && r.to_character_id === 'zalvia')
  assert.equal(stored.length, 1)
  const onParent = relationsOf('brend', RELS).find((e) => e.otherId === 'zalvia')
  const onChild = relationsOf('zalvia', RELS).find((e) => e.otherId === 'brend')
  assert.equal(onParent.label, 'Elternteil') // Brend IS the Elternteil
  assert.equal(onChild.label, 'Kind') // …so Zalvia is shown as his Kind
  assert.equal(onParent.outgoing, true)
  assert.equal(onChild.outgoing, false)
})

test('the mentor relation appears as Schüler on the student card', () => {
  assert.equal(relationsOf('zalvia', RELS).find((e) => e.otherId === 'sertorius').label, 'Schüler')
  assert.equal(relationsOf('sertorius', RELS).find((e) => e.otherId === 'zalvia').label, 'Mentor')
})

test('a symmetric row shows the same label on both cards', () => {
  assert.equal(relationsOf('zalvia', RELS).find((e) => e.otherId === 'palmiro').label, 'Feind')
  assert.equal(relationsOf('palmiro', RELS).find((e) => e.otherId === 'zalvia').label, 'Feind')
})

console.log('\n# Derived family links')

test('the chain itself reads correctly', () => {
  assert.deepEqual(namesOf(parentIds('zalvia', RELS)), ['Brend', 'Frida'])
  assert.deepEqual(namesOf(childIds('brend', RELS)), ['Mortius', 'Zalvia'])
  assert.deepEqual(namesOf(spouseIds('zalvia', RELS)), ['Amrex'])
  assert.deepEqual(namesOf(siblingIds('zalvia', RELS)), ['Mortius'])
})

test('grandparents, grandchildren, aunts/uncles, cousins, nieces/nephews', () => {
  const d = derivedFor('zalvia', RELS)
  const of = (kind) => namesOf(d.filter((x) => x.kind === kind).map((x) => x.otherId))
  assert.deepEqual(of('grandparent'), ['Ulf', 'Yrsa'])
  assert.deepEqual(of('sibling'), ['Mortius']) // never entered, shares both parents
  assert.deepEqual(of('auntUncle'), ['Halla'])
  assert.deepEqual(of('cousin'), ['Kelda'])
  assert.deepEqual(namesOf(derivedFor('ulf', RELS).filter((x) => x.kind === 'grandchild').map((x) => x.otherId)),
    ['Kelda', 'Mortius', 'Zalvia'])
  assert.deepEqual(namesOf(derivedFor('halla', RELS).filter((x) => x.kind === 'nieceNephew').map((x) => x.otherId)),
    ['Mortius', 'Zalvia'])
})

test('in-laws: Schwager/Schwägerin, Schwiegereltern, Schwiegerkind', () => {
  // Torvik married Halla → Halla's siblings are his siblings-in-law.
  assert.deepEqual(namesOf(derivedFor('torvik', RELS).filter((x) => x.kind === 'siblingInLaw').map((x) => x.otherId)),
    ['Brend'])
  // Amrex married Zalvia → Zalvia's parents are his parents-in-law.
  assert.deepEqual(namesOf(derivedFor('amrex', RELS).filter((x) => x.kind === 'parentInLaw').map((x) => x.otherId)),
    ['Brend', 'Frida'])
  // …and from Brend's side Amrex is the Schwiegerkind.
  assert.deepEqual(namesOf(derivedFor('brend', RELS).filter((x) => x.kind === 'childInLaw').map((x) => x.otherId)),
    ['Amrex'])
})

test('an ENTERED relationship is never also reported as derived', () => {
  const withExplicit = [...RELS, rel('zalvia', 'mortius', 'geschwister')]
  const d = derivedFor('zalvia', withExplicit)
  assert.equal(d.some((x) => x.otherId === 'mortius'), false)
  // …while the explicit row is of course still there.
  assert.equal(relationsOf('zalvia', withExplicit).some((e) => e.otherId === 'mortius' && e.label === 'Geschwister'), true)
})

test('nobody is their own relative', () => {
  for (const c of CHARS) {
    assert.equal(derivedFor(c.id, RELS).some((d) => d.otherId === c.id), false, `${c.name} derived to itself`)
  }
})

test('what follows from an UNCERTAIN row is marked uncertain', () => {
  const d = derivedForWithUncertainty('sawl', RELS)
  const zal = d.find((x) => x.otherId === 'zalvia')
  assert.equal(zal.kind, 'childInLaw') // Sawl's child Amrex married Zalvia
  assert.equal(zal.uncertain, true)
  // Without the secret row the link does not exist at all.
  assert.equal(derivedFor('sawl', RELS.filter((r) => !r.uncertain)).length, 0)
  // A link that does NOT depend on it stays certain.
  assert.equal(derivedForWithUncertainty('zalvia', RELS).find((x) => x.otherId === 'kelda').uncertain, undefined)
})

console.log('\n# Integrity')

test('a duplicate is found in either direction for symmetric types', () => {
  const dup = { from_character_id: 'palmiro', to_character_id: 'zalvia', type: 'feind' }
  assert.ok(findDuplicate(RELS, dup))
  assert.ok(findDuplicate(RELS, { ...dup, from_character_id: 'zalvia', to_character_id: 'palmiro' }))
  assert.equal(findDuplicate(RELS, { ...dup, type: 'rivale' }), null)
})

test('for a directional type only the SAME direction is a duplicate', () => {
  assert.ok(findDuplicate(RELS, { from_character_id: 'brend', to_character_id: 'zalvia', type: 'elternteil' }))
  assert.equal(findDuplicate(RELS, { from_character_id: 'zalvia', to_character_id: 'brend', type: 'elternteil' }), null)
})

test('the reversed directional fact is reported as a contradiction', () => {
  const conflict = findReverseConflict(RELS, { from_character_id: 'zalvia', to_character_id: 'brend', type: 'elternteil' })
  assert.equal(conflict.from_character_id, 'brend')
  assert.equal(findReverseConflict(RELS, { from_character_id: 'zalvia', to_character_id: 'palmiro', type: 'feind' }), null)
})

test('editing a row does not flag itself as its own duplicate', () => {
  const row = RELS.find((r) => r.from_character_id === 'brend' && r.to_character_id === 'zalvia')
  assert.equal(findDuplicate(RELS, row, row.id), null)
})

test('a parent/child cycle is detected before it is created', () => {
  assert.equal(wouldCycle(RELS, 'zalvia', 'brend'), true) // Zalvia is Brend's descendant
  assert.equal(wouldCycle(RELS, 'nekta', 'ulf'), true) // …two generations down
  assert.equal(wouldCycle(RELS, 'palmiro', 'zalvia'), false)
  assert.equal(wouldCycle(RELS, 'zalvia', 'zalvia'), true) // self
  assert.equal(findCycles(RELS).length, 0)
  const looped = [...RELS, rel('nekta', 'brend', 'elternteil')]
  assert.equal(findCycles(looped).length > 0, true)
})

console.log('\n# Overview graph: filters and focus')

const g = (opts) => buildGraph({ characters: CHARS, relationships: RELS, ...opts })

test('all characters are nodes; entered and derived edges are marked', () => {
  const { nodes, edges } = g({})
  assert.equal(nodes.length, CHARS.length)
  assert.ok(edges.some((e) => !e.derived && e.label === 'Elternteil'))
  assert.ok(edges.some((e) => e.derived && e.label === 'Cousine/Cousin'))
})

test('derived edges can be switched off', () => {
  const { edges } = g({ showDerived: false })
  assert.equal(edges.some((e) => e.derived), false)
  assert.equal(edges.length, RELS.length)
})

test('filtering by type keeps only those edges', () => {
  const { edges } = g({ types: ['feind'], showDerived: false })
  assert.equal(edges.length, 1)
  assert.equal(edges[0].label, 'Feind')
})

test('uncertain relationships can be hidden, with their consequences', () => {
  const shown = g({})
  assert.ok(shown.edges.some((e) => e.uncertain))
  const hidden = g({ showUncertain: false })
  assert.equal(hidden.edges.some((e) => e.uncertain), false)
  assert.equal(hidden.edges.some((e) => e.from === 'sawl' || e.to === 'sawl'), false)
})

test('the group filter (Hauptliste / Randfiguren / Pantheon) narrows the cast', () => {
  const rand = g({ groupMatch: (c) => c.role === 'randfigur' })
  assert.deepEqual(namesOf(rand.nodes.map((n) => n.id)), ['Palmiro', 'Sertorius'])
  const pantheon = g({ groupMatch: (c) => c.role === 'deity' })
  assert.deepEqual(namesOf(pantheon.nodes.map((n) => n.id)), ['Sawl'])
})

test('the book filter keeps characters without appearance data', () => {
  const { nodes } = g({ bookId: 'b1' })
  const names = namesOf(nodes.map((n) => n.id))
  assert.ok(names.includes('Zalvia') && names.includes('Mortius'))
  assert.equal(names.includes('Sertorius'), false) // marked as book 2 only
  assert.ok(names.includes('Ulf')) // no appearance data → never hidden
})

test('"nur Familie" keeps only family edges', () => {
  const { edges } = g({ familyOnly: true })
  assert.ok(edges.length > 0)
  assert.deepEqual(
    [...new Set(edges.map((e) => e.type))].sort(),
    ['ehepartner', 'elternteil'],
  )
  assert.equal(edges.some((e) => e.derived), false)
})

test('focus isolates a neighbourhood', () => {
  const one = g({ focusId: 'zalvia', focusDepth: 1, showDerived: false })
  assert.deepEqual(namesOf(one.nodes.map((n) => n.id)), ['Amrex', 'Brend', 'Frida', 'Nekta', 'Palmiro', 'Sertorius', 'Zalvia'])
  const two = g({ focusId: 'zalvia', focusDepth: 2, showDerived: false })
  assert.ok(two.nodes.length > one.nodes.length)
  assert.ok(namesOf(two.nodes.map((n) => n.id)).includes('Ulf'))
})

console.log('\n# Layouts')

test('generations run top to bottom', () => {
  const gen = generations(CHARS, RELS)
  assert.equal(gen.get('ulf'), 0)
  assert.equal(gen.get('brend'), 1)
  assert.equal(gen.get('zalvia'), 2)
  assert.equal(gen.get('nekta'), 3)
  assert.equal(gen.get('kelda'), 2) // cousin sits on Zalvia's level
})

test('the family tree puts children below their parents and never overlaps', () => {
  const nodes = CHARS.filter((c) => c.id !== 'palmiro' && c.id !== 'sertorius')
  const pos = familyLayout(nodes, RELS)
  assert.equal(pos.size, nodes.length)
  assert.ok(pos.get('zalvia').y > pos.get('brend').y, 'child below parent')
  assert.ok(pos.get('nekta').y > pos.get('zalvia').y)
  // no two nodes of one generation share a spot
  const rows = new Map()
  for (const [id, p] of pos) {
    const row = rows.get(p.y) || []
    row.push({ id, x: p.x })
    rows.set(p.y, row)
  }
  for (const row of rows.values()) {
    const xs = row.map((r) => r.x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 150, `columns too close: ${xs[i] - xs[i - 1]}`)
  }
  // deterministic
  const again = familyLayout(nodes, RELS)
  for (const [id, p] of pos) assert.equal(again.get(id).x, p.x)
})

test('the network layout places every node, deterministically and finitely', () => {
  const { nodes, edges } = g({})
  const pos = forceLayout(nodes, edges, { width: 1000, height: 700, iterations: 60 })
  assert.equal(pos.size, nodes.length)
  for (const p of pos.values()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'finite coordinates')
  }
  const again = forceLayout(nodes, edges, { width: 1000, height: 700, iterations: 60 })
  for (const [id, p] of pos) assert.equal(again.get(id).x, p.x)
  // a single node and an empty graph must not blow up
  assert.equal(forceLayout([CHARS[0]], []).size, 1)
  assert.equal(forceLayout([], []).size, 0)
  assert.equal(familyLayout([], []).size, 0)
})

console.log('\n# Export')

test('the world JSON carries the relationships verbatim', () => {
  const json = buildWorldJson({ project: { id: 'p1', name: 'Ilema' }, characters: CHARS, relationships: RELS })
  assert.equal(json.relationships.length, RELS.length)
  assert.equal(json.relationships[0].from_character_id, 'ulf')
  assert.equal(buildWorldJson({}).relationships.length, 0)
})

console.log(`\n${failed === 0 ? 'PASS ✅' : 'FAIL ❌'} (${passed} passed, ${failed} failed)`)
process.exit(failed === 0 ? 0 : 1)
