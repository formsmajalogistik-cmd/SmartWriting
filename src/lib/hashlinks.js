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

// Build a resolver over the current characters + places (+ regions and geo
// features — both always name-final). Collision priority (later insertion
// wins): geo feature < region < place < character.
export function makeResolver(characters = [], places = [], regions = [], geoFeatures = []) {
  const byLowerName = new Map()
  for (const g of geoFeatures) {
    const key = (g.name || '').trim().toLowerCase()
    if (key) byLowerName.set(key, { id: g.id, name: g.name, name_final: true, _kind: 'geo', _card: g })
  }
  for (const r of regions) {
    const key = (r.name || '').trim().toLowerCase()
    if (key) byLowerName.set(key, { id: r.id, name: r.name, name_final: true, _kind: 'region', _card: r })
  }
  for (const p of places) {
    const key = (p.name || '').trim().toLowerCase()
    if (key) byLowerName.set(key, { id: p.id, name: p.name, name_final: p.name_final, _kind: 'place', _card: p })
  }
  for (const c of characters) {
    const key = (c.name || '').trim().toLowerCase()
    if (key) byLowerName.set(key, { id: c.id, name: c.name, name_final: c.name_final, _kind: 'character', _card: c })
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
  function lookup(name) {
    return byLowerName.get((name || '').trim().toLowerCase()) || null
  }
  return { matchName, lookup, byLowerName, names }
}

// Parse every "#Name" token out of a text. Returns
// [{ index, name, card|null, resolved, provisional }].
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
    const card = resolver.lookup(name)
    refs.push({
      index: i,
      name,
      card,
      resolved: !!card,
      provisional: card ? !card.name_final : false,
    })
    i += name.length // skip the matched name (loop's i++ also skips the '#')
  }
  return refs
}

// Render one "#Name" as an HTML span (used by the marked extension).
export function renderHashlink(resolver, name) {
  const card = resolver.lookup(name)
  const label = escapeHtml('#' + name)
  if (!card) {
    return `<span class="hashlink unresolved" data-name="${escapeHtml(name)}" title="Kein Eintrag — Tippfehler oder noch nicht angelegt">${label}</span>`
  }
  const prov = card.name_final ? '' : ' provisional'
  const tip = escapeHtml(card.name) + (card.name_final ? '' : ' (provisorisch)')
  return `<span class="hashlink resolved${prov}" data-kind="${card._kind}" data-id="${escapeHtml(card.id)}" title="${tip}">${label}</span>`
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
