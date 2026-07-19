// In-text "#Name" linking: parsing, resolution, and rename helpers.
//
// A link token is "#" immediately followed by a name (no space). This is
// deliberately distinct from a Markdown heading ("# " — hash + space at the
// start of a line), so heading rendering is never affected.
//
// Resolution is case-insensitive against the project's CHARACTER and PLACE
// cards. Multi-word names (e.g. "Santal Porsiran") resolve via longest-match
// against the known card names; an unknown "#word" is captured as unresolved.
//
// The literal "#Name" always stays in the Markdown — no ids are stored in prose.

const NAME_CHAR = /[\p{L}\p{N}]/u
// Fallback token: a single run of name characters (no spaces) after '#'.
const WORD_TOKEN = /^[\p{L}\p{N}][\p{L}\p{N}_'’\-]*/u

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}

// Card aliases ("weitere Namen") live in the card jsonb; a card is findable
// under its main name AND every alias.
export function cardAliases(row) {
  return Array.isArray(row?.card?.aliases) ? row.card.aliases.filter(Boolean) : []
}

// German kind labels (ambiguity tooltips, Open-Names listing).
export const KIND_LABELS_DE = { character: 'Figur', place: 'Ort', region: 'Region', geo: 'Geografie' }

// Build a resolver over the current characters + places (+ regions and geo
// features — both always name-final). Every name (main or alias) maps to ALL
// entities carrying it; more than one match is AMBIGUOUS and is surfaced,
// never silently guessed. Entries always carry the card's MAIN name (and the
// matched alias as `_alias`), so styling/labels follow the card.
export function makeResolver(characters = [], places = [], regions = [], geoFeatures = []) {
  const byLowerName = new Map() // lower name → [entry, …]
  const add = (name, entry) => {
    const key = (name || '').trim().toLowerCase()
    if (!key) return
    const list = byLowerName.get(key) || []
    // The same card under the same name twice (alias === main name) is one entry.
    if (list.some((e) => e._kind === entry._kind && e.id === entry.id)) return
    list.push(entry)
    byLowerName.set(key, list)
  }
  for (const g of geoFeatures) add(g.name, { id: g.id, name: g.name, name_final: true, _kind: 'geo', _card: g })
  for (const r of regions) add(r.name, { id: r.id, name: r.name, name_final: true, _kind: 'region', _card: r })
  for (const p of places) {
    const entry = { id: p.id, name: p.name, name_final: p.name_final, _kind: 'place', _card: p }
    add(p.name, entry)
    for (const a of cardAliases(p)) add(a, { ...entry, _alias: a })
  }
  for (const c of characters) {
    const entry = { id: c.id, name: c.name, name_final: c.name_final, _kind: 'character', _card: c }
    add(c.name, entry)
    for (const a of cardAliases(c)) add(a, { ...entry, _alias: a })
  }
  // Longest names first so "#Santal Porsiran" beats a hypothetical "#Santal".
  const names = [...byLowerName.keys()].sort((a, b) => b.length - a.length)

  function matchName(afterHash) {
    const lower = afterHash.toLowerCase()
    for (const nm of names) {
      if (lower.startsWith(nm)) {
        const endChar = afterHash[nm.length]
        if (!endChar || !NAME_CHAR.test(endChar)) return afterHash.slice(0, nm.length)
      }
    }
    return null
  }
  // All entities a typed name matches (empty = unresolved, 2+ = ambiguous).
  function lookupAll(name) {
    return byLowerName.get((name || '').trim().toLowerCase()) || []
  }
  // The unique match, or null when unresolved OR ambiguous.
  function lookup(name) {
    const list = lookupAll(name)
    return list.length === 1 ? list[0] : null
  }
  return { matchName, lookup, lookupAll, byLowerName, names }
}

// Parse every "#Name" token out of a text. Returns
// [{ index, name, card|null, matches, resolved, ambiguous, provisional }].
// resolved = exactly one match; ambiguous = several (surfaced, not guessed);
// provisional follows the CARD's name_final, whichever name was typed.
export function extractHashRefs(text, resolver) {
  const refs = []
  if (!text) return refs
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '#') continue
    const after = text.slice(i + 1)
    const ch = after[0]
    if (!ch || /\s/.test(ch) || ch === '#') continue // heading "# " or "##" — not a token
    let name = resolver.matchName(after)
    if (!name) {
      const m = after.match(WORD_TOKEN)
      if (!m) continue
      name = m[0]
    }
    const matches = resolver.lookupAll(name)
    const card = matches.length === 1 ? matches[0] : null
    refs.push({
      index: i,
      name,
      card,
      matches,
      resolved: !!card,
      ambiguous: matches.length > 1,
      provisional: card ? !card.name_final : false,
    })
    i += name.length // skip the matched name (loop's i++ also skips the '#')
  }
  return refs
}

// Render one "#Name" as an HTML span (used by the marked extension).
export function renderHashlink(resolver, name) {
  const matches = resolver.lookupAll(name)
  const label = escapeHtml('#' + name)
  if (!matches.length) {
    return `<span class="hashlink unresolved" data-name="${escapeHtml(name)}" title="Kein Eintrag — Tippfehler oder noch nicht angelegt">${label}</span>`
  }
  if (matches.length > 1) {
    // Several cards carry this name → do NOT guess. Distinct style, listed in
    // the Open-Names view; the tooltip names every candidate.
    const who = matches.map((m) => `${m.name} (${KIND_LABELS_DE[m._kind] || m._kind})`).join(' · ')
    return `<span class="hashlink ambiguous" data-name="${escapeHtml(name)}" title="Mehrdeutig — passt auf: ${escapeHtml(who)}">${label}</span>`
  }
  const card = matches[0]
  const prov = card.name_final ? '' : ' provisional'
  // Alias matches tip with the card's MAIN name so it's clear what resolves.
  const tip = (card._alias ? `${card.name} (Alias)` : card.name) + (card.name_final ? '' : ' (provisorisch)')
  return `<span class="hashlink resolved${prov}" data-kind="${card._kind}" data-id="${escapeHtml(card.id)}" title="${escapeHtml(tip)}">${label}</span>`
}

// A marked extension object that renders inline "#Name" tokens.
export function hashlinkExtension(resolver) {
  return {
    extensions: [
      {
        name: 'hashlink',
        level: 'inline',
        start(src) {
          const i = src.indexOf('#')
          return i < 0 ? undefined : i
        },
        tokenizer(src) {
          if (src[0] !== '#') return
          const after = src.slice(1)
          const ch = after[0]
          if (!ch || /\s/.test(ch) || ch === '#') return
          let name = resolver.matchName(after)
          if (!name) {
            const m = after.match(WORD_TOKEN)
            if (!m) return
            name = m[0]
          }
          return { type: 'hashlink', raw: '#' + name, name }
        },
        renderer(token) {
          return renderHashlink(resolver, token.name)
        },
      },
    ],
  }
}

// Find indices of "#name" occurrences (case-insensitive, with a trailing
// word boundary) — used for rename detection.
export function findNameOccurrences(text, name) {
  const out = []
  const target = (name || '').trim().toLowerCase()
  if (!text || !target) return out
  const lower = text.toLowerCase()
  const needle = '#' + target
  let from = 0
  while (true) {
    const i = lower.indexOf(needle, from)
    if (i < 0) break
    const endChar = text[i + needle.length]
    if (!endChar || !NAME_CHAR.test(endChar)) out.push(i)
    from = i + 1
  }
  return out
}

// Replace "#oldName" references with "#newName" (boundary-aware, case-insensitive
// on the old token). Returns { text, count }.
export function replaceNameReferences(text, oldName, newName) {
  const occ = findNameOccurrences(text, oldName)
  if (!occ.length) return { text, count: 0 }
  const tokenLen = 1 + (oldName || '').trim().length
  let result = ''
  let last = 0
  for (const i of occ) {
    result += text.slice(last, i) + '#' + newName
    last = i + tokenLen
  }
  result += text.slice(last)
  return { text: result, count: occ.length }
}
