// Praemali phrase validation — pure, offline (works entirely on the merged
// lexicon; no network). Used by the phrase library's manual entry and
// paste-import: every token of a Praemali text is checked against the merged
// lexicon with prefix/suffix awareness. Unknown tokens are FLAGGED, never
// blocked — proper names and not-yet-added words are legitimate; the flags
// persist with the phrase until re-validation clears them.

// Punctuation stripped before tokenizing (spec set + common unicode variants).
const PUNCT_RE = /[.,!?—:;"'„“”‚’…()«»]/g

// Tokenize: strip punctuation, split on whitespace AND hyphens.
export function tokenizePraemali(text) {
  return String(text || '')
    .replace(PUNCT_RE, ' ')
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

// ---- known-forms set -----------------------------------------------------------
// Every surface form the lexicon knows, lowercased:
//   • all values of each root's `forms` and `translations`/`translations_de`
//     maps (translation values ARE Praemali forms)
//   • all function words (pronouns, conjunctions, prepositions, temporal,
//     particles, interrogatives, demonstratives, numbers, modals, copula,
//     negation words, kinship)
//   • named entities (gods, places incl. each word of multi-word names,
//     cultural terms)
//   • the user's custom entries (roots, function words, named entities) — they
//     are part of the merged lexicon passed in.
export function buildKnownForms(lexicon) {
  const known = new Set()
  const add = (v) => {
    const s = String(v || '').toLowerCase().trim()
    if (s) known.add(s)
  }
  const addWords = (v) => {
    add(v)
    for (const w of String(v || '').split(/\s+/)) add(w)
  }

  for (const root of lexicon.roots) {
    for (const f of Object.values(root.forms || {})) add(f)
    for (const f of Object.values(root.translations || {})) add(f)
    for (const f of Object.values(root.translations_de || {})) add(f)
  }

  const fw = lexicon.functionWords || {}
  for (const v of Object.values(fw.pronouns || {})) add(v.form)
  for (const v of Object.values(fw.conjunctions || {})) add(v)
  for (const v of Object.values(fw.prepositions || {})) add(v.form)
  for (const v of Object.values(fw.temporal || {})) add(v)
  for (const v of Object.values(fw.particles || {})) add(v)
  for (const v of Object.values(fw.interrogatives || {})) add(v)
  for (const v of Object.values(fw.demonstratives || {})) add(v)
  for (const v of Object.values(fw.numbers || {})) add(v)
  for (const v of Object.values(fw.modals || {})) add(v.form)
  if (fw.copula?.is?.form) add(fw.copula.is.form)
  for (const v of Object.values(fw.negation || {})) add(String(v).replace(/-$/, ''))
  for (const w of lexicon.customFunctionWords || []) add(w.form)

  for (const v of Object.values(lexicon.kinship?.terms || {})) add(v.praemali)

  const gods = lexicon.namedEntities?.gods || {}
  for (const g of gods.primordials || []) addWords(g.name)
  for (const pair of gods.creator_pairs || []) {
    if (pair.male) addWords(pair.male.name)
    if (pair.female) addWords(pair.female.name)
  }
  for (const g of gods.santulan || []) addWords(g.name)
  const places = lexicon.namedEntities?.places || {}
  if (places.capital) addWords(places.capital.full)
  for (const p of Object.values(places.regional_capitals || {})) addWords(p.name)
  for (const p of Object.values(places.landmarks || {})) addWords(p.name)
  for (const name of Object.keys(lexicon.namedEntities?.cultural_terms || {})) addWords(name)
  for (const e of lexicon.customNamedEntities || []) addWords(e.name)

  return known
}

// ---- prefix / suffix aware token check -------------------------------------------
// Prefixes: fa- (negation), faa- (sacred negation), ka- (imperative),
// naa- (optative), stacked naa-fa-. Suffixes that may follow a known form:
// class agreement (-an/-ur/-al — cf. nakitan = nakit + -an), case (-en/-ul)
// and possessives (-ta/-va/-la/-ru/-li/-taan/-vaan/-lan); case attaches after
// a possessive (noktaanen). Consonant elision at the suffix boundary is
// tolerated (nokt + -taan → noktaan), by re-adding the suffix's first letter.
const PREFIX_COMBOS = [['naa', 'fa'], ['naa'], ['faa'], ['ka'], ['fa']]
const SUFFIXES = ['taan', 'vaan', 'lan', 'ta', 'va', 'la', 'ru', 'li', 'en', 'ul', 'an', 'ur', 'al']
const MAX_SUFFIX_DEPTH = 2 // possessive + case is the deepest legal stack

function stripSuffixCandidates(word) {
  const out = new Set()
  for (const suf of SUFFIXES) {
    if (word.length > suf.length + 1 && word.endsWith(suf)) {
      const stem = word.slice(0, -suf.length)
      out.add(stem)
      out.add(stem + suf[0]) // elided doubled consonant: noktaan → nokt(t)aan
    }
  }
  return out
}

function knownWithSuffixes(word, known) {
  let frontier = new Set([word])
  for (let depth = 0; depth <= MAX_SUFFIX_DEPTH; depth++) {
    for (const w of frontier) if (known.has(w)) return true
    if (depth === MAX_SUFFIX_DEPTH) break
    const next = new Set()
    for (const w of frontier) for (const s of stripSuffixCandidates(w)) next.add(s)
    if (!next.size) break
    frontier = next
  }
  return false
}

export function isKnownToken(token, known) {
  const t = token.toLowerCase()
  if (knownWithSuffixes(t, known)) return true
  for (const combo of PREFIX_COMBOS) {
    let rest = t
    let ok = true
    for (const p of combo) {
      if (rest.startsWith(p) && rest.length > p.length + 1) rest = rest.slice(p.length)
      else {
        ok = false
        break
      }
    }
    if (ok && knownWithSuffixes(rest, known)) return true
  }
  return false
}

// Validate a Praemali text against the merged lexicon.
// Returns { tokens: [{ token, ok }], unresolved: [original-case tokens] }.
export function validatePhrase(lexicon, text, knownSet = null) {
  const known = knownSet || buildKnownForms(lexicon)
  const tokens = tokenizePraemali(text).map((token) => ({
    token,
    ok: isKnownToken(token, known),
  }))
  const unresolved = [...new Set(tokens.filter((t) => !t.ok).map((t) => t.token))]
  return { tokens, unresolved }
}

// ---- paste-import parsing -----------------------------------------------------------
const REGISTERS = new Set(['common', 'sacred', 'proto-divine'])

// Parse an import snippet: a single phrase object or an array of them.
// Returns { error } on malformed JSON, else { items: [{ ...phrase, valid,
// problems[] }] } — items missing required fields are marked invalid (shown in
// the preview, excluded from save); unknown-token validation NEVER invalidates.
export function parseImportSnippet(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}` }
  }
  const arr = Array.isArray(data) ? data : [data]
  if (!arr.length) return { error: 'Empty input — nothing to import.' }
  const items = arr.map((raw, i) => {
    const problems = []
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { index: i, valid: false, problems: ['Not an object.'] }
    }
    const praemali = typeof raw.praemali === 'string' ? raw.praemali.trim() : ''
    const register = typeof raw.register === 'string' ? raw.register.trim() : ''
    if (!praemali) problems.push('Missing required field "praemali".')
    if (!register) problems.push('Missing required field "register".')
    else if (!REGISTERS.has(register)) problems.push(`Unknown register "${register}" (common | sacred | proto-divine).`)
    return {
      index: i,
      praemali,
      register,
      translation: typeof raw.en === 'string' ? raw.en.trim() : '',
      translation_de: typeof raw.de === 'string' ? raw.de.trim() : '',
      gloss: typeof raw.gloss === 'string' ? raw.gloss.trim() : '',
      tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      valid: problems.length === 0,
      problems,
    }
  })
  return { items }
}
