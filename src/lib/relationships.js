// Character relationships: the type registry, automatic inverses, derived
// family links, integrity checks and the two graph layouts. Pure computation —
// no React, no DOM — so it can be unit-tested and reused by both views.
//
// ONE ROW PER FACT. A relationship is stored once, from → to. For a SYMMETRIC
// type both sides read the same; for a DIRECTIONAL type the other side reads
// the inverse label (Elternteil ↔ Kind). Nothing is ever entered twice.

export const REL_TYPES = [
  // Family (these are the edges the "nur Familie" tree is built from).
  {
    key: 'elternteil',
    label: 'Elternteil',
    inverse: 'Kind',
    symmetric: false,
    family: true,
    hint: 'A ist Elternteil von B',
  },
  { key: 'geschwister', label: 'Geschwister', symmetric: true, family: true },
  { key: 'ehepartner', label: 'Ehepartner', symmetric: true, family: true },
  { key: 'partner', label: 'Partner', symmetric: true, family: true },
  // Directional, non-family.
  { key: 'mentor', label: 'Mentor', inverse: 'Schüler', symmetric: false, hint: 'A lehrt B' },
  { key: 'herr', label: 'Herr', inverse: 'Dienender', symmetric: false, hint: 'B dient A' },
  // Symmetric, non-family.
  { key: 'freund', label: 'Freund', symmetric: true },
  { key: 'rivale', label: 'Rivale', symmetric: true },
  { key: 'feind', label: 'Feind', symmetric: true },
  { key: 'verbuendeter', label: 'Verbündeter', symmetric: true },
]

export const REL_BY_KEY = new Map(REL_TYPES.map((t) => [t.key, t]))
export const FAMILY_TYPES = REL_TYPES.filter((t) => t.family).map((t) => t.key)

export function relType(key) {
  return REL_BY_KEY.get(key) || { key, label: key, symmetric: true }
}
export const isSymmetric = (key) => !!relType(key).symmetric
// The label as seen from `from` (forward) and from `to` (backward).
export const forwardLabel = (key) => relType(key).label
export const backwardLabel = (key) => (isSymmetric(key) ? relType(key).label : relType(key).inverse || relType(key).label)

// --- one character's explicit relationships ---------------------------------
// Every row touching `characterId`, as seen FROM that character:
// { rel, otherId, label, outgoing }. `label` is already the correct side.
export function relationsOf(characterId, relationships = []) {
  const out = []
  for (const rel of relationships) {
    if (rel.from_character_id === characterId) {
      out.push({ rel, otherId: rel.to_character_id, label: forwardLabel(rel.type), outgoing: true })
    } else if (rel.to_character_id === characterId) {
      out.push({ rel, otherId: rel.from_character_id, label: backwardLabel(rel.type), outgoing: false })
    }
  }
  return out
}

// --- the parent/child chain -------------------------------------------------
const parentsOf = (id, rels) =>
  rels.filter((r) => r.type === 'elternteil' && r.to_character_id === id).map((r) => r.from_character_id)
const childrenOf = (id, rels) =>
  rels.filter((r) => r.type === 'elternteil' && r.from_character_id === id).map((r) => r.to_character_id)
const symPartners = (id, rels, types) =>
  rels
    .filter((r) => types.includes(r.type) && (r.from_character_id === id || r.to_character_id === id))
    .map((r) => (r.from_character_id === id ? r.to_character_id : r.from_character_id))

export const parentIds = parentsOf
export const childIds = childrenOf
export const spouseIds = (id, rels) => uniq(symPartners(id, rels, ['ehepartner', 'partner']))
export const explicitSiblingIds = (id, rels) => uniq(symPartners(id, rels, ['geschwister']))

// Siblings = entered ones PLUS everyone sharing at least one parent.
export function siblingIds(id, rels) {
  const mine = new Set(parentsOf(id, rels))
  const shared = []
  if (mine.size) {
    for (const r of rels) {
      if (r.type !== 'elternteil') continue
      if (!mine.has(r.from_character_id)) continue
      if (r.to_character_id !== id) shared.push(r.to_character_id)
    }
  }
  return uniq([...explicitSiblingIds(id, rels), ...shared]).filter((x) => x !== id)
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))]
}

// --- derived relations ------------------------------------------------------
// Computed from the parent/child chain (plus spouses), so grandparents, cousins
// and in-laws need no manual entry. A pair that already carries an EXPLICIT
// family relationship is never also reported as derived, so nothing is stated
// twice or contradicted.
const DERIVED_LABELS = {
  grandparent: 'Großeltern',
  grandchild: 'Enkel',
  sibling: 'Geschwister',
  auntUncle: 'Tante/Onkel',
  nieceNephew: 'Nichte/Neffe',
  cousin: 'Cousine/Cousin',
  siblingInLaw: 'Schwager/Schwägerin',
  parentInLaw: 'Schwiegereltern',
  childInLaw: 'Schwiegerkind',
}

export function derivedFor(characterId, rels = []) {
  const explicitFamilyPairs = new Set()
  for (const r of rels) {
    if (!FAMILY_TYPES.includes(r.type)) continue
    explicitFamilyPairs.add(pairKey(r.from_character_id, r.to_character_id))
  }
  const out = []
  const seen = new Set()
  const add = (kind, otherId, via) => {
    if (!otherId || otherId === characterId) return
    if (explicitFamilyPairs.has(pairKey(characterId, otherId))) return
    const key = `${kind}:${otherId}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind, label: DERIVED_LABELS[kind], otherId, via, derived: true })
  }

  const parents = parentsOf(characterId, rels)
  const children = childrenOf(characterId, rels)
  const spouses = spouseIds(characterId, rels)
  const explicitSibs = new Set(explicitSiblingIds(characterId, rels))
  const sibs = siblingIds(characterId, rels)

  for (const p of parents) for (const gp of parentsOf(p, rels)) add('grandparent', gp, 'über Elternteil')
  for (const c of children) for (const gc of childrenOf(c, rels)) add('grandchild', gc, 'über Kind')
  // Siblings that were never entered but share a parent.
  for (const s of sibs) if (!explicitSibs.has(s)) add('sibling', s, 'gemeinsamer Elternteil')
  for (const p of parents) {
    for (const au of siblingIds(p, rels)) {
      if (parents.includes(au)) continue
      add('auntUncle', au, 'Geschwister eines Elternteils')
      for (const cousin of childrenOf(au, rels)) add('cousin', cousin, 'Kind von Tante/Onkel')
    }
  }
  for (const s of sibs) for (const nn of childrenOf(s, rels)) add('nieceNephew', nn, 'Kind eines Geschwisters')
  for (const sp of spouses) {
    for (const sil of siblingIds(sp, rels)) add('siblingInLaw', sil, 'Geschwister des Partners')
    for (const pil of parentsOf(sp, rels)) add('parentInLaw', pil, 'Elternteil des Partners')
  }
  for (const s of sibs) for (const sp of spouseIds(s, rels)) add('siblingInLaw', sp, 'Partner eines Geschwisters')
  for (const c of children) for (const sp of spouseIds(c, rels)) add('childInLaw', sp, 'Partner eines Kindes')
  return out
}

const pairKey = (a, b) => [a, b].sort().join('|')

// Same as derivedFor, but marks entries that only exist BECAUSE of an
// uncertain/secret relationship — so an unrevealed parentage doesn't quietly
// turn into an asserted "Schwiegereltern" somewhere else.
export function derivedForWithUncertainty(characterId, rels = []) {
  const all = derivedFor(characterId, rels)
  if (!rels.some((r) => r.uncertain)) return all
  const certain = new Set(
    derivedFor(
      characterId,
      rels.filter((r) => !r.uncertain),
    ).map((d) => `${d.kind}:${d.otherId}`),
  )
  return all.map((d) => (certain.has(`${d.kind}:${d.otherId}`) ? d : { ...d, uncertain: true }))
}

// --- integrity --------------------------------------------------------------
// A relationship identical to an existing one (same pair + type; for symmetric
// types in either direction). Returns the existing row or null.
export function findDuplicate(rels = [], { from_character_id, to_character_id, type }, ignoreId = null) {
  return (
    rels.find((r) => {
      if (r.id === ignoreId || r.type !== type) return false
      const same = r.from_character_id === from_character_id && r.to_character_id === to_character_id
      const swapped = r.from_character_id === to_character_id && r.to_character_id === from_character_id
      return same || (isSymmetric(type) && swapped)
    }) || null
  )
}

// The same directional fact entered the other way round (A Elternteil von B and
// B Elternteil von A) — surfaced separately, it is a contradiction, not a copy.
export function findReverseConflict(rels = [], { from_character_id, to_character_id, type }, ignoreId = null) {
  if (isSymmetric(type)) return null
  return (
    rels.find(
      (r) =>
        r.id !== ignoreId &&
        r.type === type &&
        r.from_character_id === to_character_id &&
        r.to_character_id === from_character_id,
    ) || null
  )
}

// Would "from is Elternteil of to" close a loop? True when `from` is already a
// descendant of `to` (or both are the same person).
export function wouldCycle(rels = [], fromId, toId) {
  if (!fromId || !toId) return false
  if (fromId === toId) return true
  const seen = new Set([toId])
  const stack = [toId]
  while (stack.length) {
    const cur = stack.pop()
    for (const kid of childrenOf(cur, rels)) {
      if (kid === fromId) return true
      if (!seen.has(kid)) {
        seen.add(kid)
        stack.push(kid)
      }
    }
  }
  return false
}

// Every parent/child cycle currently in the data (each as a list of ids).
export function findCycles(rels = []) {
  const cycles = []
  const colour = new Map() // id → 1 visiting, 2 done
  const path = []
  const visit = (id) => {
    if (colour.get(id) === 2) return
    if (colour.get(id) === 1) {
      const start = path.indexOf(id)
      if (start >= 0) cycles.push(path.slice(start))
      return
    }
    colour.set(id, 1)
    path.push(id)
    for (const kid of childrenOf(id, rels)) visit(kid)
    path.pop()
    colour.set(id, 2)
  }
  for (const r of rels) if (r.type === 'elternteil') visit(r.from_character_id)
  return cycles
}

// --- graph model ------------------------------------------------------------
// Turns characters + relationships into { nodes, edges } for the overview.
// Filters: types (keys), group (subtab match fn), book (id), uncertain,
// derived, focus (id + depth).
export function buildGraph({
  characters = [],
  relationships = [],
  types = null, // null = all
  groupMatch = null, // (character) => boolean
  bookId = null,
  showUncertain = true,
  showDerived = true,
  familyOnly = false,
  focusId = null,
  focusDepth = 1,
} = {}) {
  const allowedTypes = familyOnly
    ? new Set(FAMILY_TYPES.filter((t) => !types || types.includes(t)))
    : types
      ? new Set(types)
      : null

  const inGroup = (c) => {
    if (groupMatch && !groupMatch(c)) return false
    if (bookId) {
      const books = c.card?.books
      // Characters without appearance data are always shown (same rule as the
      // cards list), so filtering by book never hides unfilled cards.
      if (Array.isArray(books) && books.length && !books.includes(bookId)) return false
    }
    return true
  }
  const byId = new Map(characters.map((c) => [c.id, c]))
  const visible = new Set(characters.filter(inGroup).map((c) => c.id))

  const edges = []
  const push = (fromId, toId, label, extra) => {
    if (!visible.has(fromId) || !visible.has(toId)) return
    edges.push({ from: fromId, to: toId, label, ...extra })
  }
  for (const r of relationships) {
    if (allowedTypes && !allowedTypes.has(r.type)) continue
    if (r.uncertain && !showUncertain) continue
    push(r.from_character_id, r.to_character_id, forwardLabel(r.type), {
      id: r.id,
      type: r.type,
      derived: false,
      uncertain: !!r.uncertain,
      note: r.note || '',
      directional: !isSymmetric(r.type),
    })
  }
  // Derived family links (network mode only — in the family tree the layout
  // itself shows them).
  if (showDerived && !familyOnly) {
    const seen = new Set()
    // Hiding uncertain relationships also hides what follows from them.
    const base = showUncertain ? relationships : relationships.filter((r) => !r.uncertain)
    for (const c of characters) {
      if (!visible.has(c.id)) continue
      for (const d of derivedForWithUncertainty(c.id, base)) {
        const key = `${d.kind}:${pairKey(c.id, d.otherId)}`
        if (seen.has(key)) continue
        seen.add(key)
        push(c.id, d.otherId, d.label, {
          id: key,
          type: d.kind,
          derived: true,
          uncertain: !!d.uncertain,
          note: d.via,
          directional: d.kind !== 'sibling' && d.kind !== 'cousin' && d.kind !== 'siblingInLaw',
        })
      }
    }
  }

  let nodeIds = visible
  if (focusId && visible.has(focusId)) {
    // Isolate the neighbourhood: the node, everyone within `focusDepth` hops.
    const keep = new Set([focusId])
    let frontier = [focusId]
    for (let d = 0; d < Math.max(1, focusDepth); d++) {
      const next = []
      for (const e of edges) {
        if (frontier.includes(e.from) && !keep.has(e.to)) { keep.add(e.to); next.push(e.to) }
        if (frontier.includes(e.to) && !keep.has(e.from)) { keep.add(e.from); next.push(e.from) }
      }
      frontier = next
      if (!next.length) break
    }
    nodeIds = keep
  }

  const nodes = [...nodeIds].map((id) => byId.get(id)).filter(Boolean)
  const kept = new Set(nodes.map((n) => n.id))
  return { nodes, edges: edges.filter((e) => kept.has(e.from) && kept.has(e.to)) }
}

// --- layouts ----------------------------------------------------------------
// Deterministic force-directed layout (no dependency): springs along edges,
// repulsion between all nodes, a weak pull to the centre. Seeded on a circle by
// index, so the same data always lands in the same place.
export function forceLayout(nodes = [], edges = [], { width = 1200, height = 800, iterations = 320 } = {}) {
  const n = nodes.length
  const pos = new Map()
  const cx = width / 2
  const cy = height / 2
  if (!n) return pos
  const radius = Math.min(width, height) * 0.38
  nodes.forEach((node, i) => {
    const a = (i / n) * Math.PI * 2
    pos.set(node.id, { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, vx: 0, vy: 0 })
  })
  if (n === 1) return pos
  const ideal = Math.max(90, Math.min(240, Math.sqrt((width * height) / n) * 0.7))
  const repulse = ideal * ideal * 0.9
  for (let step = 0; step < iterations; step++) {
    const cool = 1 - step / iterations
    for (let i = 0; i < n; i++) {
      const a = pos.get(nodes[i].id)
      for (let j = i + 1; j < n; j++) {
        const b = pos.get(nodes[j].id)
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = (i - j) || 1; dy = 1; d2 = 2 }
        const f = repulse / d2
        const d = Math.sqrt(d2)
        a.vx += (dx / d) * f
        a.vy += (dy / d) * f
        b.vx -= (dx / d) * f
        b.vy -= (dy / d) * f
      }
    }
    for (const e of edges) {
      const a = pos.get(e.from)
      const b = pos.get(e.to)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const f = (d - ideal) * 0.06
      a.vx += (dx / d) * f
      a.vy += (dy / d) * f
      b.vx -= (dx / d) * f
      b.vy -= (dy / d) * f
    }
    for (const node of nodes) {
      const p = pos.get(node.id)
      p.vx += (cx - p.x) * 0.006
      p.vy += (cy - p.y) * 0.006
      const limit = 30 * cool + 2
      const v = Math.hypot(p.vx, p.vy)
      const scale = v > limit ? limit / v : 1
      p.x += p.vx * scale
      p.y += p.vy * scale
      p.vx *= 0.82
      p.vy *= 0.82
    }
  }
  for (const p of pos.values()) { delete p.vx; delete p.vy }
  return pos
}

// Generation of every node: 0 = no known parent inside the graph, otherwise
// 1 + the deepest parent. Cycles are broken (a node never deepens itself).
export function generations(nodes = [], relationships = []) {
  const ids = new Set(nodes.map((n) => n.id))
  const rels = relationships.filter(
    (r) => r.type === 'elternteil' && ids.has(r.from_character_id) && ids.has(r.to_character_id),
  )
  const gen = new Map([...ids].map((id) => [id, 0]))
  // Longest-path relaxation, bounded by the node count (so a cycle terminates).
  for (let pass = 0; pass < ids.size + 1; pass++) {
    let moved = false
    for (const r of rels) {
      const want = gen.get(r.from_character_id) + 1
      if (want > gen.get(r.to_character_id)) {
        gen.set(r.to_character_id, want)
        moved = true
      }
    }
    if (!moved) break
  }
  return gen
}

// Family tree: generations top-to-bottom, children under their parents,
// spouses side by side. Deterministic.
export function familyLayout(nodes = [], relationships = [], { colWidth = 190, rowHeight = 190 } = {}) {
  const pos = new Map()
  if (!nodes.length) return pos
  const gen = generations(nodes, relationships)
  const byGen = new Map()
  for (const node of nodes) {
    const g = gen.get(node.id) || 0
    if (!byGen.has(g)) byGen.set(g, [])
    byGen.get(g).push(node)
  }
  const levels = [...byGen.keys()].sort((a, b) => a - b)
  // Initial order: by name, so the result never depends on load order.
  for (const g of levels) byGen.get(g).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'))
  const x = new Map()
  for (const g of levels) byGen.get(g).forEach((node, i) => x.set(node.id, i * colWidth))

  const avg = (ids) => {
    const xs = ids.map((id) => x.get(id)).filter((v) => v != null)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  }
  // A few relaxation passes: pull children under their parents (and parents
  // over their children), keep spouses adjacent, then push overlaps apart.
  for (let pass = 0; pass < 6; pass++) {
    for (const g of levels) {
      for (const node of byGen.get(g)) {
        const parents = parentIds(node.id, relationships).filter((id) => x.has(id))
        const kids = childIds(node.id, relationships).filter((id) => x.has(id))
        const sp = spouseIds(node.id, relationships).filter((id) => x.has(id) && (gen.get(id) || 0) === g)
        const targets = []
        if (parents.length) targets.push(avg(parents))
        if (kids.length) targets.push(avg(kids))
        if (sp.length) targets.push(avg(sp) + colWidth * (x.get(node.id) < avg(sp) ? -1 : 1))
        const want = targets.filter((v) => v != null)
        if (want.length) x.set(node.id, (x.get(node.id) + want.reduce((a, b) => a + b, 0) / want.length) / 2)
      }
      // De-overlap within the generation, keeping the current order.
      const row = [...byGen.get(g)].sort((a, b) => x.get(a.id) - x.get(b.id))
      for (let i = 1; i < row.length; i++) {
        const prev = x.get(row[i - 1].id)
        if (x.get(row[i].id) - prev < colWidth) x.set(row[i].id, prev + colWidth)
      }
    }
  }
  // Centre every generation around 0, then shift everything positive.
  let min = Infinity
  for (const g of levels) {
    const row = byGen.get(g)
    const mid = (Math.min(...row.map((r) => x.get(r.id))) + Math.max(...row.map((r) => x.get(r.id)))) / 2
    for (const node of row) {
      const nx = x.get(node.id) - mid
      x.set(node.id, nx)
      if (nx < min) min = nx
    }
  }
  for (const node of nodes) {
    pos.set(node.id, {
      x: x.get(node.id) - min + colWidth / 2,
      y: (levels.indexOf(gen.get(node.id) || 0)) * rowHeight + rowHeight / 2,
      gen: gen.get(node.id) || 0,
    })
  }
  return pos
}
