// Shared helpers for the export engine: filename slugs, frontmatter, download.

const UMLAUT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }

// Readable, filesystem-safe slug. Transliterates German umlauts and strips
// accents / illegal characters so files open everywhere.
export function slugify(s, fallback = 'untitled') {
  const t = (s || '').trim()
  if (!t) return fallback
  let out = t.replace(/[äöüÄÖÜß]/g, (c) => UMLAUT[c])
  out = out.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  out = out
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  return out || fallback
}

export function pad(n, width = 2) {
  return String(n ?? 0).padStart(width, '0')
}

export function extFromPath(path, fallback = 'img') {
  const ext = (path || '').split('.').pop()
  if (!ext || ext === path) return fallback
  return ext.replace(/[^a-z0-9]/gi, '').slice(0, 5) || fallback
}

function yamlValue(v) {
  if (v == null) return '""'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = String(v)
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

// Minimal, readable YAML frontmatter (strings quoted; arrays as block lists).
export function toFrontmatter(obj) {
  const lines = ['---']
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${k}: []`)
      else {
        lines.push(`${k}:`)
        for (const item of v) lines.push(`  - ${yamlValue(item)}`)
      }
    } else {
      lines.push(`${k}: ${yamlValue(v)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
