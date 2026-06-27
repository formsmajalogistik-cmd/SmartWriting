// Generates the PWA PNG icons with no external dependencies.
// Draws a solid indigo rounded background with a simple "L" glyph (Lumini) so
// the installed app has recognizable icons. Output: public/icons/*.png
// NOTE: placeholder mark — replace public/favicon.svg + this glyph (or drop real
// PNGs into public/icons/) to use custom artwork, then re-run this script.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/icons')
mkdirSync(OUT, { recursive: true })

const BG = [79, 70, 229] // #4f46e5
const FG = [255, 255, 255]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function pointInGlyph(x, y, size, maskable) {
  // Normalize to 0..1, draw a thick "L" within a centered safe area.
  const pad = maskable ? 0.28 : 0.2
  const nx = (x / size - pad) / (1 - 2 * pad)
  const ny = (y / size - pad) / (1 - 2 * pad)
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false
  // Two strokes of an "L" using distance-to-segment.
  const t = 0.15 // stroke half-thickness
  const pts = [
    [0.22, 0.0, 0.22, 1.0], // vertical stem
    [0.22, 1.0, 0.84, 1.0], // bottom foot
  ]
  for (const [ax, ay, bx, by] of pts) {
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let tt = ((nx - ax) * dx + (ny - ay) * dy) / len2
    tt = Math.max(0, Math.min(1, tt))
    const px = ax + tt * dx
    const py = ay + tt * dy
    const d = Math.hypot(nx - px, ny - py)
    if (d < t) return true
  }
  return false
}

function makePng(size, maskable) {
  const radius = maskable ? 0 : size * 0.19
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      // rounded corners (transparent outside radius) for non-maskable
      let inside = true
      if (!maskable && radius > 0) {
        const cx = Math.min(x, size - 1 - x)
        const cy = Math.min(y, size - 1 - y)
        if (cx < radius && cy < radius) {
          const d = Math.hypot(radius - cx, radius - cy)
          inside = d <= radius
        }
      }
      let r, g, b, a
      if (!inside) {
        r = g = b = a = 0
      } else if (pointInGlyph(x, y, size, maskable)) {
        ;[r, g, b] = FG
        a = 255
      } else {
        ;[r, g, b] = BG
        a = 255
      }
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync(resolve(OUT, 'icon-192.png'), makePng(192, false))
writeFileSync(resolve(OUT, 'icon-512.png'), makePng(512, false))
writeFileSync(resolve(OUT, 'icon-512-maskable.png'), makePng(512, true))
console.log('Generated PWA icons in', OUT)
