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

// German possessive / inflected endings. "#Zalvias Bogen" must reach the card
// "Zalvia" without anybody registering "Zalvias" as an alias. Longest endings
// first so "Amrexes" is tried as "Amrex" before "Amrexe".
// The bare apostrophe covers names that already end in s/ß/x/z ("#Mortius'").
const GENITIVE_SUFFIXES = ["'s", '’s', 'es', 's', "'", '’']

// Candidate base forms of a typed token: the token minus one genitive ending.
// Never used to CHANGE the prose — only to find the card behind the form.
export function genitiveStems(name) {
  const token = (name || '').trim()
  const out = []
  for (const suffix of GENITIVE_SUFFIXES) {
    if (token.length <= suffix.length) continue
    if (!token.toLowerCase().endsWith(suffix)) continue
    const stem = token.slice(0, token.length - suffix.length)
    // A leftover apostrophe means an ending was only half stripped ("Zalvia'"
    // out of "Zalvia's") — the full strip is already in the list.
    if (stem.endsWith("'") || stem.endsWith('’')) continue
    if (stem && !out.includes(stem)) out.push(stem)
  }
  return out
}

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
      if (!lower.startsWith(nm)) continue
      // A known name followed by a genitive ending: take the LONGER token so
      // the whole written form ("Zalvias", "Mortius'") becomes the link — the
      // text itself is untouched, only what the link spans grows.
      for (const suffix of GENITIVE_SUFFIXES) {
        const end = nm.length + suffix.length
        if (lower.slice(nm.length, end) !== suffix) continue
        const next = afterHash[end]
        if (!next || !NAME_CHAR.test(next)) return afterHash.slice(0, end)
      }
      const endChar = afterHash[nm.length]
      if (!endChar || !NAME_CHAR.test(endChar)) return afterHash.slice(0, nm.length)
    }
    return null
  }
  // All entities a typed name matches (empty = unresolved, 2+ = ambiguous).
  // An EXACT name/alias always wins; only when nothing matches exactly do we
  // retry the genitive base forms. If several cards become reachable that way
  // the reference stays AMBIGUOUS — the resolver never guesses one of them.
  function lookupAll(name) {
    const exact = byLowerName.get((name || '').trim().toLowerCase())
    if (exact && exact.length) return exact
    const out = []
    const seen = new Set()
    for (const stem of genitiveStems(name)) {
      for (const entry of byLowerName.get(stem.toLowerCase()) || []) {
        const key = `${entry._kind}:${entry.id}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(entry)
      }
    }
    return out
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
    return `<span class="hashlink unresolved" data-name="${escapeHtml(name)}" title="Kein Eintrag — klicken, um eine Karte anzulegen">${label}</span>`
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

// Find "#name" occurrences (case-insensitive, with a trailing word boundary)
// — used for rename detection. A genitive form ("#Zalvias", "#Mortius'") counts
// as an occurrence too, so a rename doesn't leave those forms behind; the
// ending is reported in `suffix` so it can be carried over.
// Returns [{ index, length, suffix }].
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
    const after = i + needle.length
    let hit = null
    for (const suffix of GENITIVE_SUFFIXES) {
      const end = after + suffix.length
      if (lower.slice(after, end) !== suffix) continue
      const next = text[end]
      if (!next || !NAME_CHAR.test(next)) {
        hit = { index: i, length: end - i, suffix: text.slice(after, end) }
        break
      }
    }
    if (!hit) {
      const endChar = text[after]
      if (!endChar || !NAME_CHAR.test(endChar)) hit = { index: i, length: needle.length, suffix: '' }
    }
    if (hit) out.push(hit)
    from = i + 1
  }
  return out
}

// Attach a genitive ending to a NEW name. Names already ending in a sibilant
// take the bare apostrophe in German ("Mortius'", not "Mortiuss").
function genitiveJoin(newName, suffix) {
  if (!suffix) return newName
  const last = newName.slice(-1).toLowerCase()
  const sibilant = last === 's' || last === 'ß' || last === 'x' || last === 'z'
  if (sibilant && (suffix === 's' || suffix === "'s" || suffix === '’s')) return newName + "'"
  return newName + suffix
}

// Replace "#oldName" references with "#newName" (boundary-aware, case-insensitive
// on the old token; genitive endings are preserved). Returns { text, count }.
export function replaceNameReferences(text, oldName, newName) {
  const occ = findNameOccurrences(text, oldName)
  if (!occ.length) return { text, count: 0 }
  let result = ''
  let last = 0
  for (const o of occ) {
    result += text.slice(last, o.index) + '#' + genitiveJoin(newName, o.suffix)
    last = o.index + o.length
  }
  result += text.slice(last)
  return { text: result, count: occ.length }
}
