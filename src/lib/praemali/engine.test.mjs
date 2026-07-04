// Praemali engine + merge-layer test suite. Plain node — run with:
//   npm run test:praemali
// Verifies the known-good sentences from the conlang reference EXACTLY, plus
// merge-layer safety (base update never loses custom entries; overrides shadow).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { mergeLexicon, searchLexicon, disambiguationFor, findRootCollision, levenshtein } from './lexicon.js'
import {
  assembleSentence,
  buildVerbPhrase,
  pluralize,
  compareAdjective,
  constructState,
  nounClassFor,
  applyTemplate,
} from './engine.js'

const here = dirname(fileURLToPath(import.meta.url))
const base = JSON.parse(readFileSync(join(here, '../../data/praemali_lexicon_v2.json'), 'utf8'))
const lex = mergeLexicon(base, [])
const root = (k) => lex.rootsByKey.get(k)

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

console.log('\n# Canonical sentences (conlang reference — must reproduce exactly)')

test('Common SVO: Tal kafiran nokten. (He carries the light.)', () => {
  const r = assembleSentence({
    register: 'common',
    mode: 'action',
    slots: {
      subject: { form: 'tal', cls: 'sentient', gloss: 'he' },
      verb: { aspectForm: root('K-F-R').forms.imperfective, aspect: 'imperfective', gloss: 'carry', root: root('K-F-R') },
      object: { form: root('N-K-T').forms.noun, gloss: 'light' },
    },
  })
  assert.equal(r.sentence, 'Tal kafiran nokten.')
  assert.equal(r.ok, true)
})

test('Sacred VSO: Kafiran tal nokten.', () => {
  const r = assembleSentence({
    register: 'sacred',
    mode: 'action',
    slots: {
      subject: { form: 'tal', cls: 'sentient', gloss: 'he' },
      verb: { aspectForm: root('K-F-R').forms.imperfective, aspect: 'imperfective', gloss: 'carry', root: root('K-F-R') },
      object: { form: root('N-K-T').forms.noun, gloss: 'light' },
    },
  })
  assert.equal(r.sentence, 'Kafiran tal nokten.')
})

test('Optative: Naanakitan sarin. (star is SENTIENT in sacred register)', () => {
  const starClass = nounClassFor({ rootKey: 'S-R-N', register: 'sacred' })
  assert.equal(starClass, 'sentient') // the encoded single exception
  const r = assembleSentence({
    register: 'sacred',
    mode: 'action',
    slots: {
      mood: 'optative',
      subject: { form: 'sarin', cls: starClass, gloss: 'star' },
      verb: { aspectForm: root('N-K-T').forms.imperfective, aspect: 'imperfective', gloss: 'shine', root: root('N-K-T') },
    },
  })
  assert.equal(r.sentence, 'Naanakitan sarin.')
  // …and in the common register the same star is OBJECT class.
  assert.equal(nounClassFor({ rootKey: 'S-R-N', register: 'common' }), 'object')
})

test('Copula common: Toran sa valkian.', () => {
  const r = assembleSentence({
    register: 'common',
    mode: 'copula',
    slots: {
      subject: { form: 'toran', cls: 'sentient', gloss: 'warrior' },
      predicate: { form: root('V-L-K').forms.adjective.replace(/i$/, 'i'), gloss: 'strong', isAdjective: true },
    },
  })
  assert.equal(r.sentence, 'Toran sa valkian.')
})

test('Copula sacred (zero-copula): Toran valkian.', () => {
  const r = assembleSentence({
    register: 'sacred',
    mode: 'copula',
    slots: {
      subject: { form: 'toran', cls: 'sentient', gloss: 'warrior' },
      predicate: { form: root('V-L-K').forms.adjective, gloss: 'strong', isAdjective: true },
    },
  })
  assert.equal(r.sentence, 'Toran valkian.')
})

test('Negation scope: favol tarin (cannot fight) vs vol fatarin (can choose not to fight)', () => {
  const tarin = root('T-R-N').forms.imperfective
  assert.equal(buildVerbPhrase({ modal: 'vol', negate: 'modal', aspectForm: tarin }), 'favol tarin')
  assert.equal(buildVerbPhrase({ modal: 'vol', negate: 'verb', aspectForm: tarin }), 'vol fatarin')
})

test('Modal stacking: Dar naanakitan sarin. + "mortal speech" flag', () => {
  const r = assembleSentence({
    register: 'sacred',
    mode: 'action',
    slots: {
      modal: { form: 'dar', key: 'must', gloss: 'must' },
      mood: 'optative',
      subject: { form: 'sarin', cls: 'sentient', gloss: 'star' },
      verb: { aspectForm: root('N-K-T').forms.imperfective, aspect: 'imperfective', gloss: 'shine', root: root('N-K-T') },
    },
  })
  assert.equal(r.sentence, 'Dar naanakitan sarin.')
  assert.ok(r.warnings.some((w) => w.type === 'mortal-speech'), 'mortal-speech warning present')
})

console.log('\n# Register restrictions (block with explanation, never silent)')

test('vol blocked in sacred register with the divine-uncertainty warning', () => {
  const r = assembleSentence({
    register: 'sacred',
    mode: 'action',
    slots: {
      modal: { form: 'vol', key: 'can', gloss: 'can' },
      verb: { aspectForm: root('T-R-N').forms.imperfective, aspect: 'imperfective', gloss: 'fight', root: root('T-R-N') },
    },
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors[0].text.includes('divine registers admit no uncertainty'))
})

test('T-B-N (believing) blocked in proto-divine; suggests know (K-N-V)', () => {
  const r = assembleSentence({
    register: 'proto-divine',
    mode: 'action',
    slots: {
      verb: { aspectForm: root('T-B-N').forms.imperfective, aspect: 'imperfective', gloss: 'believe', root: root('T-B-N') },
    },
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors[0].suggestion.includes('K-N-V'))
})

console.log('\n# Morphology')

test('templates: applyTemplate reproduces stored forms (spot check across roots)', () => {
  for (const key of ['M-R-T', 'N-K-T', 'T-R-N', 'K-F-R']) {
    const r = root(key)
    assert.equal(applyTemplate(r.consonants, base.templates.agent.pattern), r.forms.agent, `${key} agent`)
    assert.equal(applyTemplate(r.consonants, base.templates.perfective.pattern), r.forms.perfective, `${key} perfective`)
  }
})

test('plural: stored wins; rule fallback mort→mirat, lavna→livana', () => {
  assert.equal(pluralize('mort', root('M-R-T')), 'mirat')
  assert.equal(pluralize('mort'), 'mirat') // rule fallback
  assert.equal(pluralize('lavna'), 'livana') // open ending keeps -a
})

test('comparison: valki→vilki→violki; no-A adjectives fall back to gir/gior', () => {
  assert.deepEqual(compareAdjective('valki', 'comparative'), { form: 'vilki', particle: null })
  assert.deepEqual(compareAdjective('valki', 'superlative'), { form: 'violki', particle: null })
  assert.equal(compareAdjective('wintri', 'comparative').particle, 'gir')
})

test('construct state: sakra→sakr (grief of the king), volt→vel (stored irregular)', () => {
  assert.equal(constructState('sakra'), 'sakr')
  assert.equal(constructState(root('V-L-T').forms.noun, root('V-L-T')), 'vel')
  assert.equal(constructState('nokt'), 'nokti') // consonant-final adds -i
})

console.log('\n# Merge layer (base update must never lose user additions)')

test('custom root appends; base stays intact', () => {
  const custom = [{ id: 'c1', entry_type: 'root', payload: { root: 'Z-Z-Z', consonants: ['z', 'z', 'z'], meaning: 'test', forms: { noun: 'zozz' }, translations: { testword: 'zozz' }, translations_de: { Testwort: 'zozz' } } }]
  const merged = mergeLexicon(base, custom)
  assert.equal(merged.roots.length, base.roots.length + 1)
  assert.ok(merged.rootsByKey.has('Z-Z-Z'))
  assert.ok(merged.rootsByKey.has('M-R-T'))
  assert.equal(searchLexicon(merged, 'testword', 'en')[0].matches[0].form, 'zozz')
})

test('override shadows the base root by key; others untouched', () => {
  const custom = [{ id: 'c2', entry_type: 'override', payload: { kind: 'root', root: 'M-R-T', consonants: ['m', 'r', 't'], meaning: 'CHANGED', forms: { noun: 'mort' }, translations: { evil: 'mort' } } }]
  const merged = mergeLexicon(base, custom)
  assert.equal(merged.roots.length, base.roots.length) // replaced, not appended
  assert.equal(merged.rootsByKey.get('M-R-T').meaning, 'CHANGED')
  assert.equal(merged.rootsByKey.get('N-K-T').meaning, base.roots.find((r) => r.root === 'N-K-T').meaning)
})

test('simulated base update (extra root) keeps custom entries intact', () => {
  const newBase = { ...base, roots: [...base.roots, { root: 'Q-Q-Q', consonants: ['q', 'q', 'q'], meaning: 'new base root', forms: {}, translations: {}, translations_de: {} }] }
  const custom = [{ id: 'c3', entry_type: 'root', payload: { root: 'Z-Z-Z', consonants: ['z', 'z', 'z'], meaning: 'mine', forms: { noun: 'zozz' }, translations: { mine: 'zozz' } } }]
  const merged = mergeLexicon(newBase, custom)
  assert.ok(merged.rootsByKey.has('Q-Q-Q'), 'new base root present')
  assert.ok(merged.rootsByKey.has('Z-Z-Z'), 'custom root survived the base update')
})

test('soft-deleted custom entries are excluded from the merge', () => {
  const custom = [{ id: 'c4', entry_type: 'root', deleted_at: '2026-01-01', payload: { root: 'Z-Z-Z', meaning: 'gone', forms: {}, translations: {} } }]
  assert.equal(mergeLexicon(base, custom).rootsByKey.has('Z-Z-Z'), false)
})

test('root collision detection (merged, incl. custom)', () => {
  assert.equal(findRootCollision(lex, ['m', 'r', 't']).root, 'M-R-T')
  assert.equal(findRootCollision(lex, ['z', 'z', 'z']), null)
  const withCustom = mergeLexicon(base, [{ id: 'c5', entry_type: 'root', payload: { root: 'Z-Z-Z', consonants: ['z', 'z', 'z'], meaning: 'x', forms: {}, translations: {} } }])
  assert.equal(findRootCollision(withCustom, ['z', 'z', 'z']).root, 'Z-Z-Z')
})

console.log('\n# Lookup')

test('EN, DE and Praemali lookups hit the same root', () => {
  assert.equal(searchLexicon(lex, 'light', 'en')[0].matches[0].form, 'nokt')
  assert.ok(searchLexicon(lex, 'Licht', 'de')[0].matches.some((m) => m.form === 'nokt'))
  assert.ok(searchLexicon(lex, 'nokt', 'pr')[0].matches.some((m) => m.root === 'N-K-T'))
})

test('fuzzy: "shadwo" still finds shadow (Levenshtein ≤ 2)', () => {
  assert.ok(levenshtein('shadwo', 'shadow') <= 2)
  const hits = searchLexicon(lex, 'shadwo', 'en')
  assert.ok(hits.some((h) => h.term === 'shadow'))
})

test('disambiguation: "know" and German "wissen" both surface all options', () => {
  assert.ok(disambiguationFor(lex, 'know').options.facts_learning.includes('kanil'))
  assert.equal(disambiguationFor(lex, 'wissen').term, 'know')
  assert.ok(disambiguationFor(lex, 'dark').options.preferred.includes('narti'))
})

console.log(`\n${failed === 0 ? 'PASS ✅' : 'FAIL ❌'} (${passed} passed, ${failed} failed)`)
process.exit(failed === 0 ? 0 : 1)
