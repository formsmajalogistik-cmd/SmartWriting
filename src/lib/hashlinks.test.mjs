// #Name linking test suite. Plain node — run with:
//   npm run test:hashlinks
// Covers resolution (names, aliases, German genitive forms), ambiguity, the
// rendered markup, and rename safety.
import assert from 'node:assert/strict'
import {
  makeResolver,
  extractHashRefs,
  renderHashlink,
  genitiveStems,
  findNameOccurrences,
  replaceNameReferences,
} from './hashlinks.js'

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

const char = (name, extra = {}) => ({ id: name.toLowerCase(), name, name_final: true, card: {}, ...extra })
const place = (name, extra = {}) => ({ id: 'p-' + name.toLowerCase(), name, name_final: true, card: {}, ...extra })

const CHARACTERS = [
  char('Zalvia'),
  char('Mortius'),
  char('Amrex'),
  char('Santal Porsiran'),
  char('Fenna', { name_final: false }),
  char('Ilka', { card: { aliases: ['Die Graue'] } }),
]
const PLACES = [place('Thalen')]
const resolver = makeResolver(CHARACTERS, PLACES, [{ id: 'r1', name: 'Nordmark' }], [
  { id: 'g1', name: 'Silberfluss' },
])

const refsOf = (text) => extractHashRefs(text, resolver)
const one = (text) => {
  const r = refsOf(text)
  assert.equal(r.length, 1, `expected exactly one ref in ${JSON.stringify(text)}, got ${r.length}`)
  return r[0]
}

console.log('\n# Plain resolution')

test('a card name resolves; an unknown word does not', () => {
  assert.equal(one('Da ging #Zalvia los.').card.name, 'Zalvia')
  const miss = one('Da ging #Varlea los.')
  assert.equal(miss.resolved, false)
  assert.equal(miss.name, 'Varlea')
})

test('multi-word names win over their first word', () => {
  assert.equal(one('#Santal Porsiran nickte.').name, 'Santal Porsiran')
})

test('aliases resolve but report the card and its main name', () => {
  const ref = one('#Die Graue schwieg.')
  assert.equal(ref.card.name, 'Ilka')
  assert.equal(ref.card._alias, 'Die Graue')
})

test('regions and geo features resolve too', () => {
  assert.equal(one('in #Nordmark').card._kind, 'region')
  assert.equal(one('am #Silberfluss').card._kind, 'geo')
})

console.log('\n# German genitive / inflected forms (no alias needed)')

test('stems are derived longest-suffix-first', () => {
  assert.deepEqual(genitiveStems('Zalvias'), ['Zalvia'])
  assert.deepEqual(genitiveStems('Amrexes'), ['Amrex', 'Amrexe'])
  assert.deepEqual(genitiveStems("Mortius'"), ['Mortius'])
  assert.deepEqual(genitiveStems("Zalvia's"), ['Zalvia'])
  assert.deepEqual(genitiveStems('Zalvia'), [])
})

test("#Zalvias Bogen resolves to Zalvia, text untouched", () => {
  const ref = one('Er nahm #Zalvias Bogen.')
  assert.equal(ref.card.name, 'Zalvia')
  assert.equal(ref.name, 'Zalvias') // the written form, exactly as typed
  assert.ok(renderHashlink(resolver, ref.name).includes('>#Zalvias<'))
})

test("bare apostrophe after s/x resolves (#Mortius', #Amrex')", () => {
  assert.equal(one("#Mortius' Schwert").card.name, 'Mortius')
  assert.equal(one("#Mortius' Schwert").name, "Mortius'")
  assert.equal(one("#Amrex' Reich").card.name, 'Amrex')
  assert.equal(one('#Mortius’ Schwert').card.name, 'Mortius')
})

test("'s and -es forms resolve", () => {
  assert.equal(one("#Zalvia's Bogen").card.name, 'Zalvia')
  assert.equal(one('#Amrexes Reich').card.name, 'Amrex')
})

test('multi-word names inflect as well', () => {
  const ref = one('#Santal Porsirans Blick')
  assert.equal(ref.card.name, 'Santal Porsiran')
  assert.equal(ref.name, 'Santal Porsirans')
})

test('genitive of a place / region / geo feature resolves', () => {
  assert.equal(one('#Thalens Tore').card.name, 'Thalen')
  assert.equal(one('#Nordmarks Grenze').card._kind, 'region')
  assert.equal(one('#Silberflusses Ufer').card.name, 'Silberfluss')
})

test('an exact card name always beats a stem', () => {
  const r2 = makeResolver([char('Zalvia'), char('Zalvias')], [])
  const ref = extractHashRefs('#Zalvias Bogen', r2)[0]
  assert.equal(ref.name, 'Zalvias')
  assert.equal(ref.card.name, 'Zalvias')
})

test('an inflected form matching two cards stays ambiguous, never guessed', () => {
  const r2 = makeResolver([char('Hann'), char('Hanne')], [])
  const ref = extractHashRefs('#Hannes Blick', r2)[0]
  assert.equal(ref.ambiguous, true)
  assert.equal(ref.resolved, false)
  assert.equal(ref.matches.length, 2)
  assert.ok(renderHashlink(r2, ref.name).includes('hashlink ambiguous'))
})

test('provisional styling follows the CARD, whichever form was written', () => {
  assert.equal(one('#Fennas Hand').provisional, true)
  assert.ok(renderHashlink(resolver, 'Fennas').includes('hashlink resolved provisional'))
})

test('the genitive of an alias resolves to the card', () => {
  assert.equal(one('#Die Graues Stimme').card.name, 'Ilka')
})

test('a stray genitive of an unknown name stays unresolved', () => {
  const ref = one('#Varleas Hand')
  assert.equal(ref.resolved, false)
  assert.equal(ref.ambiguous, false)
  assert.ok(renderHashlink(resolver, ref.name).includes('hashlink unresolved'))
})

test('headings are never treated as links', () => {
  assert.equal(refsOf('# Kapitel eins').length, 0)
  assert.equal(refsOf('## Szene').length, 0)
})

test('several refs in one paragraph all resolve, with correct offsets', () => {
  const refs = refsOf('#Zalvias Bogen, #Mortius’ Schwert und #Thalen.')
  assert.deepEqual(
    refs.map((r) => r.card.name),
    ['Zalvia', 'Mortius', 'Thalen'],
  )
  for (const r of refs) assert.equal('#Zalvias Bogen, #Mortius’ Schwert und #Thalen.'[r.index], '#')
})

console.log('\n# Rename safety')

test('renaming carries the genitive ending over', () => {
  const text = 'Er nahm #Zalvias Bogen. #Zalvia schwieg.'
  const { text: out, count } = replaceNameReferences(text, 'Zalvia', 'Larenn')
  assert.equal(count, 2)
  assert.equal(out, 'Er nahm #Larenns Bogen. #Larenn schwieg.')
})

test('a new name ending in a sibilant takes the bare apostrophe', () => {
  const { text: out } = replaceNameReferences('#Zalvias Bogen', 'Zalvia', 'Mortius')
  assert.equal(out, "#Mortius' Bogen")
})

test('occurrences report index, length and suffix', () => {
  const occ = findNameOccurrences("#Mortius' Schwert, #Mortius, #Mortiusberg", 'Mortius')
  assert.equal(occ.length, 2) // "#Mortiusberg" is a different word
  assert.deepEqual(occ[0], { index: 0, length: 9, suffix: "'" })
  assert.deepEqual(occ[1], { index: 19, length: 8, suffix: '' })
})

test('a name that is not referenced leaves the text alone', () => {
  const { text: out, count } = replaceNameReferences('#Zalvia ging.', 'Thalen', 'Weiden')
  assert.equal(count, 0)
  assert.equal(out, '#Zalvia ging.')
})

console.log(`\n${failed === 0 ? 'PASS ✅' : 'FAIL ❌'} (${passed} passed, ${failed} failed)`)
process.exit(failed === 0 ? 0 : 1)
