// Regenerate the favicon + PWA icons from the brand source `public/NewFavIcon.png`
// (a large square PNG). Downscales with high-quality canvas resampling via a
// headless Chromium, so the committed icons always derive from the real art.
//
// Requires Playwright + a Chromium build. Run:
//   npm i -D playwright && npx playwright install chromium
//   node scripts/gen-icons.mjs
// (Or set PLAYWRIGHT_CHROMIUM to a chromium executable path.)
//
// Outputs:
//   public/icons/icon-192.png, icon-512.png, icon-512-maskable.png
//   public/favicon-32.png, public/apple-touch-icon.png
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(__dirname, '../public')
const SOURCE = resolve(PUBLIC, 'NewFavIcon.png')
const MASKABLE_BG = '#4f46e5' // theme color, only used if the source isn't full-bleed

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch {
    console.error(
      'Playwright is required to regenerate icons.\n' +
        '  npm i -D playwright && npx playwright install chromium\n' +
        'then re-run: node scripts/gen-icons.mjs',
    )
    process.exit(1)
  }
}

const b64 = readFileSync(SOURCE).toString('base64')
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const out = await page.evaluate(
  async ({ dataUrl, bg }) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = dataUrl
    })
    const c = document.getElementById('c')
    const ctx = c.getContext('2d')
    // Detect a full-bleed (opaque-corner) source — then maskable can use it as-is.
    c.width = img.width
    c.height = img.height
    ctx.drawImage(img, 0, 0)
    const corners = [
      [0, 0],
      [img.width - 1, 0],
      [0, img.height - 1],
      [img.width - 1, img.height - 1],
    ]
    const fullBleed = corners.every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] > 250)

    function render(size, maskable) {
      c.width = size
      c.height = size
      ctx.clearRect(0, 0, size, size)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      if (maskable && !fullBleed) {
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, size, size)
        const s = Math.round(size * 0.8)
        const off = Math.round((size - s) / 2)
        ctx.drawImage(img, off, off, s, s)
      } else {
        ctx.drawImage(img, 0, 0, size, size)
      }
      return c.toDataURL('image/png')
    }

    return {
      fullBleed,
      files: {
        'icons/icon-192.png': render(192, false),
        'icons/icon-512.png': render(512, false),
        'icons/icon-512-maskable.png': render(512, true),
        'favicon-32.png': render(32, false),
        'apple-touch-icon.png': render(180, false),
      },
    }
  },
  { dataUrl: 'data:image/png;base64,' + b64, bg: MASKABLE_BG },
)

for (const [rel, dataUrl] of Object.entries(out.files)) {
  writeFileSync(resolve(PUBLIC, rel), Buffer.from(dataUrl.split(',')[1], 'base64'))
}
await browser.close()
console.log(`Icons regenerated from ${SOURCE} (fullBleed=${out.fullBleed}).`)
