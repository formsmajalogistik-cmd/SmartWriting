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
// Stored per cell as a small int id in the terrain_types byte layer; 0 = none
// (cell keeps its height-band auto-colour). These are deliberately distinct
// tones so painted features read against any natural band:
//   Forest    — dark green, clearly darker than the grass band.
//   Structure — a cool constructed grey for bridges / walls / buildings;
//               paintable on ANY cell (incl. water) so a bridge reads across it.
export const TYPE_NONE = 0
export const TERRAIN_TYPES = [
  { id: 1, key: 'forest', label: 'Wald', color: '#15401f' },
  { id: 2, key: 'structure', label: 'Struktur', color: '#8a8d94' },
]
const TYPE_BY_ID = new Map(TERRAIN_TYPES.map((t) => [t.id, t]))
export const STRUCTURE_TYPE_ID = TERRAIN_TYPES.find((t) => t.key === 'structure').id

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
