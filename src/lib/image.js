// Downscale + compress an image File in the browser before upload, to keep
// storage small and loading fast. Longest side is capped at `maxSize` px.
// Accepts jpg/png/webp (anything createImageBitmap can decode). Outputs WebP
// when the browser supports encoding it, falling back to JPEG.
export async function downscaleImage(file, maxSize = 800, quality = 0.82) {
  if (!file.type?.startsWith('image/')) {
    throw new Error('Keine gültige Bilddatei.')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, maxSize / longest)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)

    let blob = await toBlob(canvas, 'image/webp', quality)
    let ext = 'webp'
    if (!blob || blob.type !== 'image/webp') {
      blob = await toBlob(canvas, 'image/jpeg', quality)
      ext = 'jpg'
    }
    if (!blob) throw new Error('Bild konnte nicht verarbeitet werden.')
    return { blob, ext, contentType: blob.type, width: w, height: h }
  } finally {
    bitmap.close?.()
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}
