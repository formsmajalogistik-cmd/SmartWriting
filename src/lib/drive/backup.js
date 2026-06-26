// Push a recoverable export bundle to the user's Google Drive.
//
// Reuses the export engine's file list (`bundle.files = [{ path, bytes, mime }]`)
// — the SAME bytes that the ZIP download produces (per-chapter Markdown +
// world-data.json + portraits). Mirrors the bundle's folder structure under
// "SmartWriting Backups/<project>/" and records every folder/file ID so repeat
// backups UPDATE the same files instead of creating duplicates.
import { ensureFolder, uploadOrUpdate } from './driveApi.js'
import { BACKUP_ROOT_FOLDER } from './config.js'

// A Drive file name can't contain '/', so map a bundle path to a flat-safe leaf
// name (the folder hierarchy carries the structure).
function leafName(path) {
  return path.split('/').pop()
}
function dirOf(path) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

// Ensure every folder along `dir` (relative to the project folder) exists,
// caching ids by dir-path in `folders`. Returns the leaf folder id.
async function ensureDirPath(token, projectFolderId, dir, folders) {
  if (!dir) return projectFolderId
  const segments = dir.split('/')
  let parentId = projectFolderId
  let acc = ''
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg
    const id = await ensureFolder(token, seg, parentId, folders[acc])
    folders[acc] = id
    parentId = id
  }
  return parentId
}

// opts: { token, projectId, bundle, link, onProgress }
// Returns the updated link object (NOT yet persisted) with refreshed ids.
export async function backupProjectToDrive({ token, projectId, bundle, link, onProgress }) {
  const next = link ? { ...link } : {}
  next.links = { ...(next.links || {}) }

  onProgress?.('Drive-Ordner werden vorbereitet …')
  // Root "SmartWriting Backups" folder (reuse known id if still valid).
  const rootId = await ensureFolder(token, BACKUP_ROOT_FOLDER, null, next.root_folder_id)
  next.root_folder_id = rootId

  // Per-project subfolder (named after the bundle root = project slug).
  const entry = { ...(next.links[projectId] || {}) }
  entry.folders = { ...(entry.folders || {}) }
  entry.files = { ...(entry.files || {}) }
  entry.folder_id = await ensureFolder(token, bundle.root, rootId, entry.folder_id)

  // Upload / update each file, preserving structure and ids.
  let i = 0
  for (const f of bundle.files) {
    i += 1
    onProgress?.(`Sicherung läuft (${i}/${bundle.files.length}) …`)
    const parentId = await ensureDirPath(token, entry.folder_id, dirOf(f.path), entry.folders)
    entry.files[f.path] = await uploadOrUpdate(token, {
      name: leafName(f.path),
      parentId,
      bytes: f.bytes,
      mime: f.mime || 'application/octet-stream',
      fileId: entry.files[f.path],
    })
  }

  next.links[projectId] = entry
  return next
}
