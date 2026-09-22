// Namenspool logic: everything about the pool that is pure computation, so it
// can be unit-tested and reused by the UI without a browser.
//
// Two rules shape this module:
//   • "USED" is never stored. A pool name counts as used when a character card
//     in the project carries it as its name or as an alias — derived live, so
//     deleting the character returns the name to the pool.
//   • Collision warnings are computed live from the project's editable prefix
//     list, not from the `collision_warning` field of whatever was imported.
import { cardAliases } from './hashlinks.js'

export const norm = (s) => (s || '').trim().toLowerCase()

// --- used names -------------------------------------------------------------
// lower(name) → { character, alias } for every character name AND alias.
export function usedNameIndex(characters = []) {
  const map = new Map()
  for (const c of characters) {
    const main = norm(c.name)
    if (main && !map.has(main)) map.set(main, { character: c, alias: null })
    for (const a of cardAliases(c)) {
      const key = norm(a)
      if (key && !map.has(key)) map.set(key, { character: c, alias: a })
    }
  }
  return map
}

export function usageOf(entry, usedIndex) {
  return usedIndex.get(norm(entry?.name)) || null
}

// --- regions ----------------------------------------------------------------
// A pool row belongs to a region CARD (region_id) or, when the imported region
// has no card, to the free text it came with.
export function regionLabel(entry, regions = []) {
  if (entry?.region_id) {
    const r = regions.find((x) => x.id === entry.region_id)
    if (r) return r.name || ''
    // The region card was deleted meanwhile — fall back to the text.
  }
  return entry?.region_text || ''
}

// Stable filter key per region ("r:<id>" for a card, "t:<text>" for free text).
export function regionKey(entry, regions = []) {
  if (entry?.region_id && regions.some((r) => r.id === entry.region_id)) return `r:${entry.region_id}`
  const text = norm(regionLabel(entry, regions))
  return text ? `t:${text}` : ''
}

// Every region present in the pool, as filter options (sorted, German collation).
export function regionOptions(pool = [], regions = []) {
  const out = new Map()
  for (const e of pool) {
    const key = regionKey(e, regions)
    if (!key) continue
    if (!out.has(key)) out.set(key, { key, label: regionLabel(e, regions) })
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'))
}

// Match an imported region NAME to one of the project's region cards
// (case-insensitive, exact). "Porsiran (Hauptstadt)" has no card → free text.
export function matchRegion(regions = [], name) {
  const key = norm(name)
  if (!key) return null
  return regions.find((r) => norm(r.name) === key) || null
}

// --- collision warnings -----------------------------------------------------
// The protected prefixes are the main cast's name beginnings. A pool name that
// starts with one is FLAGGED, never blocked.
export function collisionPrefix(name, prefixes = []) {
  const lower = norm(name)
  if (!lower) return null
  for (const p of prefixes) {
    const pre = norm(p)
    if (pre && lower.startsWith(pre)) return String(p).trim()
  }
  return null
}

// --- seed / JSON import -----------------------------------------------------
// Accepts the registry shape { collision_prefixes: [], names: [{name, region,
// gender, category, tags, collision_warning}] }. A bare array of names works
// too. Returns { names, prefixes, error }.
export function parseNamePoolJson(data) {
  if (Array.isArray(data)) return { names: sanitizeSeedNames(data), prefixes: [], error: null }
  if (!data || typeof data !== 'object') {
    return { names: [], prefixes: [], error: 'Unbekanntes Format: erwartet ein Objekt mit „names“.' }
  }
  if (!Array.isArray(data.names)) {
    return { names: [], prefixes: [], error: 'Feld „names“ fehlt oder ist keine Liste.' }
  }
  const names = sanitizeSeedNames(data.names)
  if (!names.length) return { names: [], prefixes: [], error: 'Keine gültigen Namen in der Datei.' }
  return {
    names,
    prefixes: Array.isArray(data.collision_prefixes)
      ? data.collision_prefixes.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
      : [],
    error: null,
  }
}

function sanitizeSeedNames(list) {
  const out = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) continue
    out.push({
      name,
      region: typeof raw.region === 'string' ? raw.region.trim() : '',
      gender: typeof raw.gender === 'string' ? raw.gender.trim() : '',
      category: typeof raw.category === 'string' ? raw.category.trim() : '',
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string' && t.trim()) : [],
    })
  }
  return out
}

// Identity of a pool entry for de-duplication: its name plus the NAME of its
// region. Deliberately the label and not region_id/region_text, so a row
// imported as free text ("Adneroth") and the same name imported later, once an
// "Adneroth" region card exists, are recognised as the same entry.
export function poolKey(entry, regions = []) {
  return `${norm(entry?.name)}|${norm(regionLabel(entry, regions))}`
}

// What an import would do, WITHOUT writing anything: entries already in the pool
// for this project + region (case-insensitive) are skipped, so re-importing the
// same file never duplicates. Regions are matched to cards by name; unmatched
// ones keep their text.
export function planNamePoolImport(seedNames = [], { pool = [], regions = [] } = {}) {
  const seen = new Set(pool.map((e) => poolKey(e, regions)))
  const create = []
  let skipped = 0
  for (const s of seedNames) {
    const region = matchRegion(regions, s.region)
    const candidate = {
      name: s.name,
      region_id: region?.id || null,
      region_text: region ? '' : s.region,
      gender: s.gender,
      category: s.category,
      tags: s.tags,
    }
    const key = poolKey(candidate, regions)
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    create.push(candidate)
  }
  return { create, skipped, matchedRegions: countMatched(seedNames, regions) }
}

function countMatched(seedNames, regions) {
  const matched = new Set()
  const unmatched = new Set()
  for (const s of seedNames) {
    if (!s.region) continue
    if (matchRegion(regions, s.region)) matched.add(s.region)
    else unmatched.add(s.region)
  }
  return { matched: [...matched], unmatched: [...unmatched] }
}

// --- browsing ---------------------------------------------------------------
// Annotate + filter the pool. `used` and `warning` are derived here so the list
// and the random pick always agree.
export function decorate(pool = [], { characters = [], regions = [], prefixes = [] } = {}) {
  const usedIndex = usedNameIndex(characters)
  return pool.map((e) => ({
    entry: e,
    used: usageOf(e, usedIndex),
    warning: collisionPrefix(e.name, prefixes),
    region: regionLabel(e, regions),
    rkey: regionKey(e, regions),
  }))
}

export function filterPool(
  decorated = [],
  { query = '', region = '', gender = '', category = '', tag = '', showUsed = false, showHidden = false } = {},
) {
  const q = norm(query)
  return decorated.filter((d) => {
    const e = d.entry
    if (!showHidden && e.hidden) return false
    if (!showUsed && d.used) return false
    if (region && d.rkey !== region) return false
    if (gender && e.gender !== gender) return false
    if (category && e.category !== category) return false
    if (tag && !(e.tags || []).includes(tag)) return false
    if (q) {
      const hay = `${e.name} ${d.region} ${e.category} ${(e.tags || []).join(' ')} ${e.notes || ''}`
      if (!hay.toLowerCase().includes(q)) return false
    }
    return true
  })
}

// A random UNUSED, not-hidden entry from an already filtered list.
export function pickRandom(decorated = [], rnd = Math.random) {
  const pool = decorated.filter((d) => !d.used && !d.entry.hidden)
  if (!pool.length) return null
  return pool[Math.floor(rnd() * pool.length)]
}

// Every tag / category actually present, for the filter dropdowns.
export function tagOptions(pool = []) {
  const set = new Set()
  for (const e of pool) for (const t of e.tags || []) if (t) set.add(t)
  return [...set].sort((a, b) => a.localeCompare(b, 'de'))
}
export function categoryOptions(pool = []) {
  const set = new Set()
  for (const e of pool) if (e.category) set.add(e.category)
  return [...set].sort((a, b) => a.localeCompare(b, 'de'))
}
