// ONE answer to "which images does this character have?".
//
// The card jsonb grew from a single `portrait_path` into a gallery:
//   card.gallery       — every image path, in the author's order
//   card.portrait_path — the PRIMARY image (header, previews, autocomplete,
//                        timeline tokens, PDF cards)
// Old cards carry only `portrait_path`; cards edited since carry both; and a
// card can carry a gallery whose primary was never set (or points at a deleted
// image). Every consumer — the card editor, previews, PDF export and the
// backup bundle — resolves through here, so none of them can disagree about
// what a character actually has (the backup used to read `portrait_path`
// alone and silently skipped everything else).
import { slugify, extFromPath } from './export/util.js'

// All image paths for a character, primary first, de-duplicated.
export function characterImagePaths(character) {
  const card = character?.card || {}
  const primaryPath = card.portrait_path || ''
  const list = Array.isArray(card.gallery) ? card.gallery.filter(Boolean) : []
  const paths = list.length ? [...list] : primaryPath ? [primaryPath] : []
  if (primaryPath && !paths.includes(primaryPath)) paths.unshift(primaryPath)
  return [...new Set(paths)]
}

// The image to show wherever ONE image represents the character. Falls back to
// the first gallery entry when `portrait_path` is unset or stale, which is what
// the card editor has always displayed.
export function primaryImagePath(character) {
  const paths = characterImagePaths(character)
  const declared = character?.card?.portrait_path || ''
  return declared && paths.includes(declared) ? declared : paths[0] || ''
}

// Bundle-relative file name for one of a character's images. The primary keeps
// the historical `portraits/<name>-<id>.<ext>` name so existing backups keep
// matching; further images get -2, -3 … in gallery order, and world-data.json
// maps every storage path to its file (see buildWorldJson).
export function portraitBundleName(character, path, index = 0) {
  if (!path) return null
  const ext = extFromPath(path, 'img')
  const base = `${slugify(character?.name, 'figur')}-${character?.id}`
  return `portraits/${base}${index > 0 ? `-${index + 1}` : ''}.${ext}`
}

// Images written before uploads went to Storage live ONLY in the IndexedDB of
// the browser that created them ("local/<characterId>/<uuid>.<ext>"). They
// cannot be fetched from another device — which is exactly why they went
// missing from backups.
export function isLocalOnlyPath(path) {
  return typeof path === 'string' && path.startsWith('local/')
}
