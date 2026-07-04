// Canonical (read-only) phrase library — extracted from the base lexicon's own
// example sentences, so the JSON stays the single source of truth. Each base
// example is a "PRAEMALI — TRANSLATION" string; we split and label them.
function parse(example, register, category) {
  if (!example) return null
  const [pr, en] = String(example).split('—').map((s) => s.trim())
  if (!pr) return null
  return { praemali: pr, translation: en || '', register, category, canon: true }
}

export function canonicalPhrases(base) {
  const out = []
  const push = (p) => p && out.push(p)

  // Copula statements + the question form (common register).
  const cop = base.copula || {}
  push(parse(cop.common?.examples?.statement, 'common', 'Copula'))
  push(parse(cop.common?.examples?.negative, 'common', 'Copula'))
  push(parse(cop.common?.examples?.question, 'common', 'Question'))
  push(parse(cop.sacred?.examples?.statement, 'sacred', 'Copula (zero)'))

  // Construct-state ritual phrases (incl. "Vel nokt taan" — Song of our light).
  const cs = base.grammar_rules?.construct_state?.examples || {}
  for (const [en, pr] of Object.entries(cs)) {
    out.push({ praemali: pr.charAt(0).toUpperCase() + pr.slice(1), translation: en, register: 'sacred', category: 'Construct', canon: true })
  }

  // Negation-scope pair (military speech: ability vs refusal).
  const neg = base.grammar_rules?.negation_scope?.examples || {}
  for (const [en, pr] of Object.entries(neg)) {
    out.push({ praemali: pr.split('(')[0].trim(), translation: en, register: 'common', category: 'Negation', canon: true })
  }

  // Star-singing invocations: the god form and the mortal (stacked) form.
  const stack = base.grammar_rules?.modal_optative_stacking || {}
  const god = parse(stack.example_god, 'sacred', 'Invocation')
  if (god) push({ ...god, translation: god.translation || 'May the star shine (divine form)' })
  const mortal = parse(stack.example_human_priest, 'sacred', 'Invocation (mortal)')
  if (mortal) push(mortal)

  return out.map((p, i) => ({ id: `canon-${i}`, gloss: '', ...p }))
}
