// Praemali assembly engine — pure functions, derived from the machine-readable
// rules in praemali_lexicon_v2.json (word order, verb structure, copula,
// negation scope, register restrictions, comparison, plural, construct state).
// No Praemali word is hardcoded here except the grammatical markers the JSON
// itself defines (fa-, ka-, naa-, sa, case/class suffixes, gir/gior).
//
// This is a guided-construction engine, NOT a free-text parser: it assembles
// slot-based sentences for the supported structures only.

export const CLASS_SUFFIX = { sentient: 'an', animal: 'ur', object: 'al' }
export const CASE_SUFFIX = { nominative: '', accusative: 'en', locative: 'ul' }
export const MOOD_PREFIX = { imperative: 'ka', optative: 'naa' }
export const NEG_PREFIX = 'fa'
export const COPULA_COMMON = 'sa'
export const DIVINE_REGISTERS = new Set(['sacred', 'proto-divine'])

export const DIVINE_WARNING =
  'The divine registers admit no uncertainty — this concept does not exist there'

// Alternatives suggested when a common-only concept is blocked in a divine
// register (from the lexicon's rationale: believe/think → know).
export const DIVINE_SUGGESTIONS = {
  'T-B-N': 'believe → know: use K-N-V (kaniv — recognise/know)',
  'T-N-K': 'think → know: use K-N-V (kaniv) or state the fact directly',
  vol: 'can → must: divine speech knows necessity (dar), not possibility',
  lat: 'should → must: use dar — obligation as fate',
  sa: 'drop the copula: divine registers juxtapose subject and predicate',
}

// ---- morphology ---------------------------------------------------------------
// Apply a root template like "C1oC2C3", "taC1aC2aC3", "C1aC2C2aC3" to a
// consonant triple (digraphs like "sh" are single consonants).
export function applyTemplate(consonants, pattern) {
  return pattern.replace(/C([123])/g, (_, d) => consonants[Number(d) - 1] || '')
}

// Generate all template forms for a consonant triple (Add Word defaults).
export function generateForms(consonants, templates, selected = null) {
  const out = {}
  for (const [key, t] of Object.entries(templates)) {
    if (selected && !selected.includes(key)) continue
    out[key] = applyTemplate(consonants, t.pattern)
  }
  return out
}

// Plural: prefer the root's stored plural; otherwise the rule — internal
// vowels shift to i–a (mort → mirat); open-ending nouns keep the final -a
// (lavna → livana). Case suffixes attach AFTER pluralization.
export function pluralize(form, rootEntry = null) {
  if (rootEntry?.forms?.plural) return rootEntry.forms.plural
  const open = form.endsWith('a')
  let stem = open ? form.slice(0, -1) : form
  const first = [...stem].findIndex((c) => 'aeiou'.includes(c))
  if (first === -1) return form
  stem = stem.slice(0, first) + 'i' + stem.slice(first + 1) // first vowel → i
  const restIdx = [...stem.slice(first + 1)].findIndex((c) => 'aeiou'.includes(c))
  if (restIdx >= 0) {
    const j = first + 1 + restIdx
    stem = stem.slice(0, j) + 'a' + stem.slice(j + 1) // second vowel → a
  } else {
    stem = stem.slice(0, -1) + 'a' + stem.slice(-1) // mirt → mirat
  }
  return open ? stem + 'a' : stem
}

export function withCase(form, kase) {
  const suffix = CASE_SUFFIX[kase] || ''
  return suffix ? form + suffix : form
}

// Comparative: internal A → I (valki → vilki). Superlative: A → IO (violki).
// Adjectives with no shiftable A fall back to the particles gir / gior.
export function compareAdjective(adj, degree) {
  const i = adj.indexOf('a')
  if (i === -1) return { form: adj, particle: degree === 'superlative' ? 'gior' : 'gir' }
  const replacement = degree === 'superlative' ? 'io' : 'i'
  return { form: adj.slice(0, i) + replacement + adj.slice(i + 1), particle: null }
}

// Construct state (possession): possessed noun drops its final vowel; if it
// already ends in a consonant, add -i. Irregular constructs (volt → vel) are
// stored on the root and win.
export function constructState(form, rootEntry = null) {
  if (rootEntry?.forms?.construct) return rootEntry.forms.construct
  if ('aeiou'.includes(form.slice(-1))) return form.slice(0, -1)
  return form + 'i'
}

// Noun class. Encoded exception: stars (S-R-N) are OBJECT class in the common
// register but SENTIENT in sacred/proto-divine (they are souls). Agent forms
// are people → sentient. Otherwise: a stored user choice, or null = ask once.
export function nounClassFor({ rootKey, formType, form, register, overrides }) {
  if (rootKey === 'S-R-N') return DIVINE_REGISTERS.has(register) ? 'sentient' : 'object'
  if (overrides && form && overrides.has(form)) return overrides.get(form)
  if (formType === 'agent' || formType === 'pronoun_sentient') return 'sentient'
  return null
}

// ---- verb complex ---------------------------------------------------------------
// Order per grammar_rules.verb_structure:
//   mood prefix (ka-/naa-) · negation (fa-) if negating the verb ·
//   root-in-aspect-template · class suffix (imperatives take none).
// Negation scope is compositional: negating the MODAL yields fa+modal before
// an unnegated verb (favol tarin = cannot fight); negating the VERB yields
// modal + fa+verb (vol fatarin = can choose not to fight).
export function buildVerbComplex({ aspectForm, mood = null, negateVerb = false, subjectClass = null }) {
  const parts = []
  if (mood && MOOD_PREFIX[mood]) parts.push([MOOD_PREFIX[mood], mood === 'imperative' ? 'IMP' : 'OPT'])
  if (negateVerb) parts.push([NEG_PREFIX, 'NEG'])
  parts.push([aspectForm, null]) // gloss filled by caller
  if (subjectClass && mood !== 'imperative' && CLASS_SUFFIX[subjectClass]) {
    parts.push([CLASS_SUFFIX[subjectClass], subjectClass.slice(0, 3).toUpperCase()])
  }
  return { form: parts.map(([m]) => m).join(''), parts }
}

export function buildVerbPhrase({ modal = null, negate = null, aspectForm, mood = null, subjectClass = null }) {
  const words = []
  if (modal) words.push(negate === 'modal' ? NEG_PREFIX + modal : modal)
  const vc = buildVerbComplex({ aspectForm, mood, negateVerb: negate === 'verb', subjectClass })
  words.push(vc.form)
  return words.join(' ')
}

// ---- register validation ----------------------------------------------------------
export function checkRegister({ register, modalKeyOrForm = null, verbRoot = null }) {
  const errors = []
  if (!DIVINE_REGISTERS.has(register)) return errors
  if (modalKeyOrForm && ['vol', 'can', 'lat', 'should'].includes(modalKeyOrForm)) {
    const form = modalKeyOrForm === 'can' ? 'vol' : modalKeyOrForm === 'should' ? 'lat' : modalKeyOrForm
    errors.push({
      type: 'register',
      text: `„${form}" — ${DIVINE_WARNING}.`,
      suggestion: DIVINE_SUGGESTIONS[form],
    })
  }
  if (verbRoot && (verbRoot.register === 'common' || verbRoot.root === 'T-N-K' || verbRoot.root === 'T-B-N')) {
    errors.push({
      type: 'register',
      text: `${verbRoot.root} (${verbRoot.meaning || 'common-register concept'}) — ${DIVINE_WARNING}.`,
      suggestion: DIVINE_SUGGESTIONS[verbRoot.root] || 'use a certainty concept (know K-N-V, must dar) instead',
    })
  }
  return errors
}

// ---- sentence assembly -------------------------------------------------------------
// Slot shapes (every slot optional unless noted):
//   temporal  { form, gloss }
//   subject   { form, cls, gloss }             cls: sentient|animal|object|null
//   modal     { form, key, gloss, register }   e.g. { form:'vol', key:'can' }
//   mood      'imperative' | 'optative' | null
//   negate    'verb' | 'modal' | null
//   verb      { aspectForm, aspect, gloss, root }   root = merged root entry (required in action mode)
//   object    { form, gloss, plural? , rootEntry? }
//   locative  { prep: { form, case, gloss }, noun: { form, gloss } }
//   predicate { form, gloss, isAdjective }     (copula mode; agreement applied here)
export function assembleSentence({ register = 'common', mode = 'action', slots = {}, lexicon = null }) {
  const errors = []
  const warnings = []
  const tokens = [] // { pr, gloss } per output word

  const { temporal, subject, modal, mood, negate, verb, object, locative, predicate } = slots

  // Register restrictions (block, never silently drop).
  errors.push(
    ...checkRegister({
      register,
      modalKeyOrForm: modal?.form || modal?.key || null,
      verbRoot: verb?.root || null,
    }),
  )
  if (subject?.root && DIVINE_REGISTERS.has(register) && subject.root.register === 'common') {
    errors.push({
      type: 'register',
      text: `${subject.root.root} — ${DIVINE_WARNING}.`,
      suggestion: DIVINE_SUGGESTIONS[subject.root.root],
    })
  }
  if (errors.length) return { ok: false, sentence: '', tokens: [], warnings, errors }

  // Modal + optative stacking: legal, but mortal speech — gods never stack.
  if (modal && mood === 'optative') {
    warnings.push({
      type: 'mortal-speech',
      text: 'Modal + optative stacking is legal but marks the speaker as mortal — gods never stack.',
    })
  }

  const push = (pr, gloss) => {
    if (pr) tokens.push({ pr, gloss: gloss || '' })
  }

  if (mode === 'copula') {
    if (!subject?.form || !predicate?.form) {
      return { ok: false, sentence: '', tokens: [], warnings, errors: [{ type: 'incomplete', text: 'Copula sentences need a subject and a predicate.' }] }
    }
    // Predicate adjectives agree with the subject's noun class.
    const agr = predicate.isAdjective && subject.cls ? CLASS_SUFFIX[subject.cls] || '' : ''
    let predForm = predicate.form + agr
    if (negate === 'verb' || negate === 'predicate') predForm = NEG_PREFIX + predForm
    push(subject.form, subject.gloss || 'SUBJ')
    if (register === 'common') push(COPULA_COMMON, 'COP')
    push(predForm, (negate ? 'NEG+' : '') + (predicate.gloss || 'PRED') + (agr ? `-${agr.toUpperCase()}` : ''))
    return finish(tokens, warnings, errors)
  }

  // Action mode.
  if (!verb?.aspectForm) {
    return { ok: false, sentence: '', tokens: [], warnings, errors: [{ type: 'incomplete', text: 'Pick a verb first.' }] }
  }
  const vc = buildVerbComplex({
    aspectForm: verb.aspectForm,
    mood,
    negateVerb: negate === 'verb',
    subjectClass: subject?.cls || null,
  })
  const vcGloss = vc.parts
    .map(([m, g]) => (g ? `${m}(${g})` : `${m}(${verb.gloss || 'verb'}·${verb.aspect === 'perfective' ? 'PFV' : 'IMPF'})`))
    .join('+')
  const modalWord = modal ? (negate === 'modal' ? NEG_PREFIX + modal.form : modal.form) : null
  const modalGloss = modal ? `${negate === 'modal' ? 'NEG+' : ''}MOD(${modal.gloss || modal.key || modal.form})` : null

  // Object: plural first, then accusative case.
  let objectWord = null
  if (object?.form) {
    const base = object.plural ? pluralize(object.form, object.rootEntry) : object.form
    objectWord = withCase(base, 'accusative')
  }
  const locPrep = locative?.prep?.form || null
  const locNoun = locative?.noun?.form
    ? withCase(locative.noun.form, locative.prep?.case || 'locative')
    : null

  // Word order: common SVO; sacred/proto-divine VSO (modal stays immediately
  // before the verb complex in both — cf. "Dar naanakitan sarin").
  const vso = DIVINE_REGISTERS.has(register)
  if (temporal?.form) push(temporal.form, temporal.gloss || 'TEMP')
  if (!vso) {
    if (subject?.form) push(subject.form, subject.gloss || 'SUBJ')
    if (modalWord) push(modalWord, modalGloss)
    push(vc.form, vcGloss)
  } else {
    if (modalWord) push(modalWord, modalGloss)
    push(vc.form, vcGloss)
    if (subject?.form) push(subject.form, subject.gloss || 'SUBJ')
  }
  if (objectWord) push(objectWord, `${object.gloss || 'OBJ'}-ACC`)
  if (locPrep) push(locPrep, locative.prep.gloss || 'PREP')
  if (locNoun) push(locNoun, `${locative.noun.gloss || 'LOC'}-${(locative.prep?.case || 'locative').slice(0, 3).toUpperCase()}`)

  return finish(tokens, warnings, errors)
}

function finish(tokens, warnings, errors) {
  if (!tokens.length) return { ok: false, sentence: '', tokens, warnings, errors }
  const raw = tokens.map((t) => t.pr).join(' ')
  const sentence = raw.charAt(0).toUpperCase() + raw.slice(1) + '.'
  return { ok: true, sentence, tokens, warnings, errors }
}
