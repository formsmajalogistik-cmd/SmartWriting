// Pure terrain model — NO Three.js. Shared by the data layer (encode/decode for
// persistence) and the 3D builder (cell ops, height bands, coordinate maths).
// Keeping this dependency-free means the heavy react-three-fiber bundle stays
// behind the map view's lazy boundary, and this logic stays unit-testable.

// Heights are discrete steps 0..MAX_HEIGHT, one byte per cell (row-major).
export const MAX_HEIGHT = 24
export const ENCODING = 'b64-u8-v1'

// Size presets chosen at creation. Live-resizing is intentionally NOT supported
// (Stage A) — a project picks one of these once. `large` is heavier; flagged so
// the UI can warn on low-end devices.
export const SIZE_PRESETS = [
  { key: 'small', label: 'Klein', width: 48, height: 48 },
  { key: 'medium', label: 'Mittel', width: 96, height: 96 },
  { key: 'large', label: 'Groß', width: 128, height: 128, heavy: true },
]

// World-space rendering parameters (persisted in terrains.settings).
export const DEFAULT_SETTINGS = {
  maxHeight: MAX_HEIGHT,
  step: 0.5, // world units of elevation per height step
  cellSize: 1, // world units per cell edge
  encoding: ENCODING,
  // Per-project chosen North, in degrees clockwise from the base North (-Z).
  // 0 = North is the -Z edge (default). Only the cardinal assignment + default
  // camera rotate by this; the terrain itself never moves.
  north_offset: 0,
}

export const DEFAULT_SEA_LEVEL = 2

// ---- height-band colouring -------------------------------------------------
// Colour each cell by where its height sits relative to sea level, so a raised
// landmass reads as a world with zero manual painting. Bands, low → high:
//   deep water, shallow water, sand, grass, rock, snow.
export const BANDS = [
  { key: 'deep', label: 'Tiefes Wasser', color: '#1c3a5e' },
  { key: 'shallow', label: 'Flaches Wasser', color: '#2f6f9f' },
  { key: 'sand', label: 'Sand', color: '#d8c89a' },
  { key: 'grass', label: 'Wiese', color: '#5a8f4e' },
  { key: 'rock', label: 'Fels', color: '#7d756b' },
  { key: 'snow', label: 'Schnee', color: '#eef2f5' },
]
export const BAND_INDEX = Object.fromEntries(BANDS.map((b, i) => [b.key, i]))

// ---- manual terrain-type paints (override the height band) -----------------
// EVERY legend colour is paintable as a per-cell override, stored as a small int
// id in the terrain_types byte layer; 0 = none (the cell keeps its height-band
// auto-colour). Painting is colour-only — it never changes a cell's elevation.
//
// Feature paints (forest, structure) have no auto-colour equivalent and keep
// their original ids 1 & 2 so terrains painted before the full palette existed
// still render correctly. The six height bands are also paintable as overrides,
// reusing the band colours at ids 3..8.
export const TYPE_NONE = 0
const FEATURE_PAINTS = [
  { id: 1, key: 'forest', label: 'Wald', color: '#15401f' },
  { id: 2, key: 'structure', label: 'Struktur', color: '#8a8d94' },
]
// Palette order = legend order: the six natural bands, then the feature paints.
export const PAINT_TYPES = [
  ...BANDS.map((b, i) => ({ id: 3 + i, key: b.key, label: b.label, color: b.color })),
  ...FEATURE_PAINTS,
]
const TYPE_BY_ID = new Map(PAINT_TYPES.map((t) => [t.id, t]))
export const STRUCTURE_TYPE_ID = FEATURE_PAINTS.find((t) => t.key === 'structure').id

// Map a cell height + sea level to a band key. Above-water range is split into
// sand (just above shore), grass, rock, then snow near the top.
export function bandForHeight(height, seaLevel, maxHeight = MAX_HEIGHT) {
  if (height <= seaLevel - 2) return 'deep'
  if (height <= seaLevel) return 'shallow'
  const above = height - seaLevel // 1..(maxHeight - seaLevel)
  const span = Math.max(1, maxHeight - seaLevel)
  const frac = above / span
  if (above <= 1) return 'sand'
  if (frac < 0.55) return 'grass'
  if (frac < 0.85) return 'rock'
  return 'snow'
}

// Resolve a cell's colour. A manual terrain-type paint (typeId > 0) overrides
// the height band; cells with no paint (typeId 0) fall through to height-band
// auto-colouring. Structure/forest tones are independent of height, so a
// structure painted on a water cell still renders as structure (e.g. a bridge).
export function colorForCell(height, seaLevel, maxHeight, typeId = 0) {
  const t = typeId ? TYPE_BY_ID.get(typeId) : null
  if (t) return t.color
  return BANDS[BAND_INDEX[bandForHeight(height, seaLevel, maxHeight)]].color
}

export function isWater(height, seaLevel) {
  return height <= seaLevel
}

// ---- compact encode / decode (base64 of a Uint8Array) ----------------------
export function createHeights(width, height, fill = 0) {
  return new Uint8Array(width * height).fill(fill)
}

export function encodeHeights(u8) {
  // Chunked to avoid call-stack limits on String.fromCharCode for big grids.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function decodeHeights(b64, expectedLength) {
  if (!b64) return new Uint8Array(expectedLength || 0)
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  if (expectedLength && out.length !== expectedLength) {
    // Tolerate a length mismatch rather than crash the view: pad/trim.
    const fixed = new Uint8Array(expectedLength)
    fixed.set(out.subarray(0, expectedLength))
    return fixed
  }
  return out
}

// ---- orientation -----------------------------------------------------------
// BASE North = -Z (world). cellToWorld maps grid row y → world +Z, so the top
// edge of the grid (row y = 0) is the base-North edge. The author can CHOOSE a
// different North per project via `settings.north_offset` (degrees, rotating the
// cardinal assignment clockwise around +Y); the terrain never physically moves.
//   At offset 0:  North = -Z   East = +X   South = +Z   West = -X
// The cardinal markers, the compass and the default camera all derive from the
// chosen offset.
export const NORTH = Object.freeze({ x: 0, z: -1 })
export const CARDINALS = Object.freeze([
  { key: 'N', label: 'N', dir: [0, -1] },
  { key: 'E', label: 'E', dir: [1, 0] },
  { key: 'S', label: 'S', dir: [0, 1] },
  { key: 'W', label: 'W', dir: [-1, 0] },
])

// Quick presets: snap North to a grid edge. The offset that makes a base
// direction become North (so the N marker sits on that edge):
//   -Z → 0°   -X → 90°   +Z → 180°   +X → 270°
export const NORTH_PRESETS = Object.freeze([
  { key: '-Z', label: '−Z', deg: 0 },
  { key: '-X', label: '−X', deg: 90 },
  { key: '+Z', label: '+Z', deg: 180 },
  { key: '+X', label: '+X', deg: 270 },
])

// Normalise any degree value into [0, 360).
export function normalizeDeg(d) {
  return ((Number(d) || 0) % 360 + 360) % 360
}

// ---- coordinate maths (terrain centred on the origin) ----------------------
// Exposed so later stages can place markers exactly on a cell's surface.
export function idx(x, y, width) {
  return y * width + x
}
export function inBounds(x, y, width, height) {
  return x >= 0 && y >= 0 && x < width && y < height
}
export function cellToWorld(x, y, width, height, cellSize = 1) {
  return {
    x: (x - width / 2 + 0.5) * cellSize,
    z: (y - height / 2 + 0.5) * cellSize,
  }
}
export function worldToCell(wx, wz, width, height, cellSize = 1) {
  return {
    x: Math.floor(wx / cellSize + width / 2),
    y: Math.floor(wz / cellSize + height / 2),
  }
}

// ---- markers ---------------------------------------------------------------
// A place's position on the map is stored on the place row itself, in its
// existing `coords` jsonb column (no new column / migration needed). The value
// is snapped to the tile grid:
//   coords = { col, row }   // 0-based cell column/row. Height is NOT stored —
//                           // it is read live from the terrain at that cell, so
//                           // a marker always sits on the surface even after the
//                           // ground beneath it is resculpted.
// A place whose coords is null/missing simply isn't on the map yet.
export const MARKER_FLOAT = 1.4 // world units a marker floats above its cell top

// World position for a marker sitting on cell (col,row): centred on the cell and
// lifted to the cell's current top plus a constant float, so the pin clears the
// terrain (and the sea plane) and stays visible at any height. `heights` is the
// live Uint8Array; out-of-range cells fall back to height 0.
export function markerWorldPos(col, row, heights, width, height, settings, float = MARKER_FLOAT) {
  const { x, z } = cellToWorld(col, row, width, height, settings.cellSize)
  const h = inBounds(col, row, width, height) ? heights[idx(col, row, width)] : 0
  return { x, y: h * settings.step + float, z }
}

// ---- brush ----------------------------------------------------------------
// Indices of cells within a circular brush of the given radius (in cells).
// size 1 = a single cell; size 2 = a 3-wide diamond/disc, etc.
export function cellsInBrush(cx, cy, size, width, height) {
  const out = []
  const r = Math.max(0, size - 1)
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + r * 0.5) continue // round the disc
      const x = cx + dx
      const y = cy + dy
      if (inBounds(x, y, width, height)) out.push(idx(x, y, width))
    }
  }
  return out
}

export function clampHeight(h, maxHeight = MAX_HEIGHT) {
  return Math.max(0, Math.min(maxHeight, h))
}

// ---- mountain stamp --------------------------------------------------------
// Radial mountain profile: the extra height to ADD at cell-distance `d` (in
// cells) from a stamp centre, for a peak `peak` steps tall over a footprint of
// `radius` cells. Highest at the centre (d=0 → peak), tapering to 0 at the rim,
// with a slightly concave slope (broad base, pointier top) so a single stamp
// reads as a mountain rather than a cone or a flat plateau. Pure/deterministic;
// the caller adds the ground base height, clamps, and applies any look jitter.
export function mountainDelta(d, radius, peak) {
  const R = Math.max(1, radius)
  if (d >= R) return 0
  const t = 1 - d / R // 1 at the centre → 0 at the rim
  return peak * Math.pow(t, 1.3)
}

// ---- regions (per-cell assignment layer) -----------------------------------
// A separate Uint8 layer parallel to heights/terrain_types: each cell holds a
// "region slot" byte (0 = unassigned). The slot → region-id map lives in the
// terrain settings (region_slots), so ids never bloat the per-cell blob.
export const REGION_NONE = 0

// A default palette for new regions (cycled by creation order). Distinct from
// the terrain-band colours so a region tint never reads as terrain.
export const REGION_COLORS = [
  '#e0b341', '#d1495b', '#3b8ea5', '#8e6db8', '#5aa469',
  '#e07a5f', '#4062bb', '#c05299', '#6a994e', '#c98a3b',
]

// Flood the 4-connected run of cells sharing the START cell's byte value in a
// single-byte layer (used by the region bucket). Iterative; returns cell indices.
export function floodFillEqual(buf, width, height, sx, sy) {
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return []
  const n = width * height
  const start = sy * width + sx
  const target = buf[start]
  const seen = new Uint8Array(n)
  const out = []
  const stack = [start]
  seen[start] = 1
  while (stack.length) {
    const i = stack.pop()
    out.push(i)
    const x = i % width
    const y = (i / width) | 0
    if (x > 0 && !seen[i - 1] && buf[i - 1] === target) { seen[i - 1] = 1; stack.push(i - 1) }
    if (x < width - 1 && !seen[i + 1] && buf[i + 1] === target) { seen[i + 1] = 1; stack.push(i + 1) }
    if (y > 0 && !seen[i - width] && buf[i - width] === target) { seen[i - width] = 1; stack.push(i - width) }
    if (y < height - 1 && !seen[i + width] && buf[i + width] === target) { seen[i + width] = 1; stack.push(i + width) }
  }
  return out
}

// Centroid (cell col/row) + cell count for each region slot byte (> 0) present
// in the assignment layer — used to place a region's name label inside its area.
// Returns Map<slotByte, { col, row, count }>.
export function computeRegionCentroids(buf, width, height) {
  const acc = new Map()
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i]
    if (!s) continue
    const a = acc.get(s) || { sx: 0, sy: 0, count: 0 }
    a.sx += i % width
    a.sy += (i / width) | 0
    a.count++
    acc.set(s, a)
  }
  const out = new Map()
  for (const [s, a] of acc) {
    out.set(s, { col: Math.round(a.sx / a.count), row: Math.round(a.sy / a.count), count: a.count })
  }
  return out
}

// ---- flood fill (bucket) ---------------------------------------------------
// Indices of the cells 4-connected to (sx,sy) that share the START cell's
// "kind" — its painted terrain-type if painted (>0), else its height-band.
// Reads the original data only (no mutation); iterative stack so huge regions
// don't overflow. The caller sets every returned index to the chosen paint id.
export function floodFillRegion({ heights, types, width, height, seaLevel, maxHeight, sx, sy }) {
  const n = width * height
  const startIdx = sy * width + sx
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return []
  const kindOf = (i) => {
    const t = types ? types[i] : 0
    // Painted types and height-bands live in disjoint numeric ranges so a
    // painted cell never matches an unpainted cell that happens to share a band.
    return t > 0 ? 1000 + t : BAND_INDEX[bandForHeight(heights[i], seaLevel, maxHeight)]
  }
  const target = kindOf(startIdx)
  const seen = new Uint8Array(n)
  const out = []
  const stack = [startIdx]
  seen[startIdx] = 1
  while (stack.length) {
    const i = stack.pop()
    out.push(i)
    const x = i % width
    const y = (i / width) | 0
    if (x > 0 && !seen[i - 1] && kindOf(i - 1) === target) { seen[i - 1] = 1; stack.push(i - 1) }
    if (x < width - 1 && !seen[i + 1] && kindOf(i + 1) === target) { seen[i + 1] = 1; stack.push(i + 1) }
    if (y > 0 && !seen[i - width] && kindOf(i - width) === target) { seen[i - width] = 1; stack.push(i - width) }
    if (y < height - 1 && !seen[i + width] && kindOf(i + width) === target) { seen[i + width] = 1; stack.push(i + width) }
  }
  return out
}
