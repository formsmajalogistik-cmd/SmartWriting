// Praemali lexicon MERGE layer — pure, no React, no JSON import (the base
// lexicon is passed in, so node tests can feed it from disk and the app from
// the bundled asset).
//
// The base lexicon (praemali_lexicon_v2.json) is the single source of truth
// and ships with the app. User additions live in custom_lexicon_entries rows
// and are merged here at runtime:
//   entry_type 'override'      — payload.kind 'root': replaces the base root
//                                with the same payload.root key.
//                                payload.kind 'noun_class': remembers the
//                                noun-class choice for one word form.
//   entry_type 'root'          — appended as a new root (collision checking
//                                happens at creation time, loudly).
//   entry_type 'function_word' — appended ({ group, key, form, de? }).
//   entry_type 'named_entity'  — appended ({ name, meaning, type }).
// A base lexicon update therefore can never overwrite or lose user additions —
// they're a separate layer re-merged on every load.

// ---- merge ------------------------------------------------------------------
export function mergeLexicon(base, customEntries = []) {
  const overridesByRoot = new Map()
  const nounClassOverrides = new Map()
  const customRoots = []
  const customFunctionWords = []
  const customNamedEntities = []

  for (const e of customEntries) {
    if (!e || e.deleted_at) continue
    const p = e.payload || {}
    if (e.entry_type === 'override') {
      if (p.kind === 'noun_class' && p.form) nounClassOverrides.set(p.form, p.noun_class)
      else if (p.root) overridesByRoot.set(p.root, { ...p, custom: true, customId: e.id })
    } else if (e.entry_type === 'root' && p.root) {
      customRoots.push({ ...p, custom: true, customId: e.id })
    } else if (e.entry_type === 'function_word' && p.form) {
      customFunctionWords.push({ ...p, customId: e.id })
    } else if (e.entry_type === 'named_entity' && p.name) {
      customNamedEntities.push({ ...p, customId: e.id })
    }
  }

  const roots = [
    ...(base.roots || []).map((r) => overridesByRoot.get(r.root) || r),
    ...customRoots,
  ]
  const rootsByKey = new Map(roots.map((r) => [r.root, r]))

  const lexicon = {
    meta: base.meta,
    templates: base.templates || {},
    copula: base.copula,
    roots,
    rootsByKey,
    functionWords: base.function_words || {},
    customFunctionWords,
    namedEntities: base.named_entities || {},
    customNamedEntities,
    kinship: base.kinship || {},
    comparison: base.comparison || {},
    grammarRules: base.grammar_rules || {},
    nounClassOverrides,
    customCount: customEntries.filter((e) => !e.deleted_at).length,
  }
  lexicon.indexes = buildIndexes(lexicon)
  return lexicon
}

// ---- search indexes ----------------------------------------------------------
// en / de: meaning → matches[]   ·   pr: praemali form → matches[]
// A match: { kind, form, root?, formType?, meaning, de?, register, note?, group? }
function pushIndex(map, key, match) {
  if (!key) return
  const k = String(key).toLowerCase().trim()
  if (!k) return
  const list = map.get(k) || []
  // De-dup identical (form, root) pairs coming from repeated glosses.
  if (!list.some((m) => m.form === match.form && m.root === match.root && m.formType === match.formType)) {
    list.push(match)
  }
  map.set(k, list)
}

function formTypeOf(root, form) {
  for (const [k, v] of Object.entries(root.forms || {})) if (v === form) return k
  return 'derived'
}

function buildIndexes(lex) {
  const en = new Map()
  const de = new Map()
  const pr = new Map()

  for (const root of lex.roots) {
    const registers = root.register || 'all'
    for (const [meaning, form] of Object.entries(root.translations || {})) {
      const match = { kind: 'root', root: root.root, form, formType: formTypeOf(root, form), meaning, register: registers, note: root.note }
      pushIndex(en, meaning, match)
      pushIndex(pr, form, { ...match })
    }
    for (const [meaningDe, form] of Object.entries(root.translations_de || {})) {
      const match = { kind: 'root', root: root.root, form, formType: formTypeOf(root, form), meaning: meaningDe, register: registers, note: root.note }
      pushIndex(de, meaningDe, match)
      pushIndex(pr, form, { ...match })
    }
    // Every derivation form is findable in the Praemali direction.
    for (const [ft, form] of Object.entries(root.forms || {})) {
      pushIndex(pr, form, { kind: 'root', root: root.root, form, formType: ft, meaning: root.meaning, register: registers })
    }
  }

  // Function words: EN keys are the group keys/meanings; DE via german_glosses.
  const fw = lex.functionWords
  const deGloss = fw.german_glosses || {}
  const addFn = (group, key, form, extra = {}) => {
    const match = { kind: 'function', group, form, meaning: key, register: extra.register || 'all', note: extra.note }
    pushIndex(en, key, match)
    pushIndex(pr, form, match)
    const deWord = extra.de || deGloss[group]?.[form]
    if (deWord) pushIndex(de, deWord, { ...match, meaning: deWord })
  }
  for (const [k, v] of Object.entries(fw.pronouns || {})) addFn('pronouns', v.meaning, v.form, { note: k })
  for (const [k, v] of Object.entries(fw.conjunctions || {})) addFn('conjunctions', k, v)
  for (const [k, v] of Object.entries(fw.prepositions || {})) addFn('prepositions', k, v.form, { note: `governs ${v.case}` })
  for (const [k, v] of Object.entries(fw.temporal || {})) addFn('temporal', k, v)
  for (const [k, v] of Object.entries(fw.particles || {})) addFn('particles', k, v)
  for (const [k, v] of Object.entries(fw.interrogatives || {})) addFn('interrogatives', k, v)
  for (const [k, v] of Object.entries(fw.demonstratives || {})) addFn('demonstratives', k, v)
  for (const [k, v] of Object.entries(fw.numbers || {})) addFn('numbers', k, v)
  for (const [k, v] of Object.entries(fw.modals || {})) {
    addFn('modals', k, v.form, { de: v.de, register: v.register, note: v.note })
  }
  for (const w of lex.customFunctionWords) {
    addFn(w.group || 'custom', w.key || w.meaning, w.form, { de: w.de, note: 'custom' })
  }

  // Kinship + named entities (names searchable both ways).
  for (const [k, v] of Object.entries(lex.kinship.terms || {})) {
    const match = { kind: 'kinship', form: v.praemali, meaning: k, register: 'all', note: v.origin }
    pushIndex(en, k, match)
    pushIndex(de, v.de, { ...match, meaning: v.de })
    pushIndex(pr, v.praemali, match)
  }
  const addEntity = (name, meaning, type) => {
    const match = { kind: 'named_entity', form: name, meaning, register: 'all', note: type }
    pushIndex(pr, name, match)
    pushIndex(en, meaning, match)
  }
  const gods = lex.namedEntities.gods || {}
  for (const g of gods.primordials || []) addEntity(g.name, `${g.domain} (god)`, `root ${g.root}`)
  for (const pair of gods.creator_pairs || []) {
    for (const side of ['male', 'female']) {
      const g = pair[side]
      if (g) addEntity(g.name, `${g.domain} (god)`, `root ${g.root}`)
    }
  }
  for (const g of gods.santulan || []) addEntity(g.name, `${g.domain} (god)`, `root ${g.root}`)
  const places = lex.namedEntities.places || {}
  if (places.capital) addEntity(places.capital.full, places.capital.meaning, 'capital')
  for (const [region, p] of Object.entries(places.regional_capitals || {})) addEntity(p.name, `${p.meaning} (${region})`, 'city')
  for (const p of Object.values(places.landmarks || {})) addEntity(p.name, p.meaning, 'landmark')
  for (const [name, c] of Object.entries(lex.namedEntities.cultural_terms || {})) addEntity(name, c.meaning, c.type)
  for (const e of lex.customNamedEntities) addEntity(e.name, e.meaning, e.type || 'custom')

  return { en, de, pr }
}

// ---- fuzzy search -------------------------------------------------------------
// Exact hit, then prefix matches, then Levenshtein ≤ 2 — so "shadwo" still
// finds shadow/Schatten.
export function levenshtein(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    let rowMin = prev[0]
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
      if (prev[j] < rowMin) rowMin = prev[j]
    }
    if (rowMin > max) return max + 1
  }
  return prev[b.length]
}

export function searchLexicon(lexicon, query, lang = 'en') {
  const q = (query || '').toLowerCase().trim()
  if (!q) return []
  const index = lexicon.indexes[lang] || lexicon.indexes.en
  const results = []
  const seen = new Set()
  const push = (term, matches, rank) => {
    if (seen.has(term)) return
    seen.add(term)
    results.push({ term, matches, rank })
  }
  if (index.has(q)) push(q, index.get(q), 0)
  for (const [term, matches] of index) {
    if (term !== q && term.startsWith(q)) push(term, matches, 1)
  }
  if (results.length < 12 && q.length >= 3) {
    for (const [term, matches] of index) {
      if (!seen.has(term) && levenshtein(q, term) <= 2) push(term, matches, 2)
    }
  }
  results.sort((a, b) => a.rank - b.rank || a.term.localeCompare(b.term))
  return results.slice(0, 30)
}

// Disambiguation: one input word → several roots with distinct senses. The
// grammar_rules.disambiguation table is EN-keyed; map the German equivalents
// onto the same entries so DE lookups disambiguate too.
const DE_DISAMBIG = {
  dunkel: 'dark',
  stille: 'silence',
  sehen: 'see',
  tod: 'death',
  wissen: 'know',
  kennen: 'know',
  gehen: 'go',
}
export function disambiguationFor(lexicon, query) {
  const q = (query || '').toLowerCase().trim()
  const table = lexicon.grammarRules.disambiguation || {}
  const key = table[q] ? q : DE_DISAMBIG[q]
  return key && table[key] ? { term: key, options: table[key] } : null
}

// ---- root collision check (Add Word) -----------------------------------------
// The author avoids double meanings: warn loudly when a consonant triple is
// already taken anywhere in the MERGED lexicon.
export function findRootCollision(lexicon, consonants) {
  const norm = consonants.map((c) => String(c || '').toLowerCase().trim())
  if (norm.some((c) => !c)) return null
  const key = norm.join('-').toUpperCase()
  if (lexicon.rootsByKey.has(key)) return lexicon.rootsByKey.get(key)
  for (const r of lexicon.roots) {
    const cs = (r.consonants || []).map((c) => String(c).toLowerCase())
    if (cs.length === 3 && cs.every((c, i) => c === norm[i])) return r
  }
  return null
}
