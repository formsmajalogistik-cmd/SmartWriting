// Minimal Google Drive v3 REST client using fetch + a bearer access token.
// Only operates on files the app created (drive.file scope). Never touches the
// rest of the user's Drive.
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Signals an expired/invalid token so the UI can prompt a reconnect.
export class DriveAuthError extends Error {
  constructor(message = 'Drive-Sitzung abgelaufen.') {
    super(message)
    this.name = 'DriveAuthError'
    this.isAuth = true
  }
}

async function api(token, url, opts = {}) {
  const resp = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  })
  if (resp.status === 401 || resp.status === 403) throw new DriveAuthError()
  return resp
}

async function jsonOrThrow(resp, what) {
  if (!resp.ok) {
    let detail = ''
    try {
      detail = (await resp.json())?.error?.message || ''
    } catch {
      /* ignore */
    }
    throw new Error(`${what} fehlgeschlagen (HTTP ${resp.status}${detail ? ': ' + detail : ''}).`)
  }
  return resp.json()
}

function escapeQ(s) {
  return String(s).replace(/'/g, "\\'")
}

// Find an app-created folder by exact name under a parent (or root).
export async function findFolder(token, name, parentId) {
  const q = [
    `name='${escapeQ(name)}'`,
    `mimeType='${FOLDER_MIME}'`,
    'trashed=false',
    parentId ? `'${escapeQ(parentId)}' in parents` : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const url = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=1`
  const data = await jsonOrThrow(await api(token, url), 'Ordnersuche')
  return data.files?.[0]?.id || null
}

export async function createFolder(token, name, parentId) {
  const body = { name, mimeType: FOLDER_MIME }
  if (parentId) body.parents = [parentId]
  const data = await jsonOrThrow(
    await api(token, `${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'Ordner anlegen',
  )
  return data.id
}

// Returns true if the file/folder id still exists and isn't trashed.
async function existsAndLive(token, id) {
  if (!id) return false
  const resp = await api(token, `${API}/files/${id}?fields=id,trashed`)
  if (resp.status === 404) return false
  if (!resp.ok) return false
  const data = await resp.json()
  return !data.trashed
}

// Ensure a folder exists, reusing a known id when still valid (avoids
// duplicates), else finding by name, else creating.
export async function ensureFolder(token, name, parentId, knownId) {
  if (knownId && (await existsAndLive(token, knownId))) return knownId
  const found = await findFolder(token, name, parentId)
  if (found) return found
  return createFolder(token, name, parentId)
}

function multipartRelated(metadata, mime, bytes) {
  const boundary = 'smartwriting-' + Math.random().toString(36).slice(2)
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  const blob = new Blob([head, bytes, tail])
  return { blob, contentType: `multipart/related; boundary=${boundary}` }
}

export async function createFile(token, { name, parentId, bytes, mime }) {
  const { blob, contentType } = multipartRelated(
    { name, parents: parentId ? [parentId] : undefined, mimeType: mime },
    mime,
    bytes,
  )
  const data = await jsonOrThrow(
    await api(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: blob,
    }),
    'Upload',
  )
  return data.id
}

// Update an existing file's content (keeps the same id). Returns null on 404 so
// the caller can recreate (e.g. the file was removed, or the user switched Drives).
export async function updateFile(token, fileId, { bytes, mime }) {
  const resp = await api(token, `${UPLOAD}/files/${fileId}?uploadType=media&fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': mime },
    body: new Blob([bytes], { type: mime }),
  })
  if (resp.status === 404) return null
  const data = await jsonOrThrow(resp, 'Aktualisierung')
  return data.id
}

// Update if we have a (still valid) id, else create. Returns the file id.
export async function uploadOrUpdate(token, { name, parentId, bytes, mime, fileId }) {
  if (fileId) {
    const updated = await updateFile(token, fileId, { bytes, mime })
    if (updated) return updated
  }
  return createFile(token, { name, parentId, bytes, mime })
}
