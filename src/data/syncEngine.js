// Local-first sync engine — Part 1 (outgoing queue) + Part 2 (incoming pull,
// multi-device conflict handling).
//
// The UI always reads/writes the LOCAL IndexedDB store via the unchanged
// repository interface. This engine runs behind it:
//
//   OUTGOING  db.js records every local mutation into a coalescing queue;
//             sync() pushes each row's latest local state to the remote.
//   INCOMING  sync() first PULLS rows newer than a per-table cursor (plus
//             deletion tombstones) and merges them into the local cache.
//   CONFLICTS detected via per-record BASE tracking (see below), resolved by:
//               • chapter prose  → BOTH drafts survive: the server side is
//                 saved as a new, clearly labelled chapter version and the
//                 local side stays active. Surfaced as a notice.
//               • everything else → last-write-wins by updated_at, quietly.
//               • remote delete vs local unsynced edit → the local record is
//                 KEPT (the pending push resurrects it) and a notice is raised;
//                 data is never silently destroyed.
//
// BASE TRACKING — the heart of real conflict detection. For every record this
// device knows, sync_meta holds `base:<table>:<id>` = the SERVER updated_at
// that the local copy was last based on (recorded when a hydrate/pull applies
// a server row, and from the server's returned stamp after a successful push).
// When a pulled server row meets a pending local change:
//   server.updated_at === base → the server hasn't moved since we based our
//                                edit on it → NO conflict, local pushes.
//   server.updated_at !== base → it changed elsewhere too → CONFLICT.
// Pull always runs BEFORE push, so pending changes are conflict-checked
// against fresh server state before they overwrite anything.
import { useEffect, useState } from 'react'
import { getDb, STORES, SYNCED_STORES, setSyncSink, suspendSync } from './db.js'
import { makeChapterVersion } from './types.js'

const RETRY_MS = 6000
const FLUSH_DEBOUNCE_MS = 250
const PULL_INTERVAL_MS = 12000
const EPOCH = '1970-01-01T00:00:00.000Z'

// Pull/push order: parents before children (matches the remote's FK order).
const PULL_TABLES = [
  'projects',
  'characters',
  'places',
  'events',
  'regions',
  'routes',
  'ideas',
  'terrains',
  'custom_lexicon_entries',
  'saved_phrases',
  'chapters',
  'chapter_versions',
  'character_locations',
]

let remote = null
let getUserId = null
let initialized = false
let flushTimer = null
let retryTimer = null
let pullTimer = null
let busy = false // one sync() at a time (pull + push are a unit)
let activeProjectId = null

let state = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0, // queued, not-yet-pushed changes
  syncing: false, // a pull/push cycle is in flight
  hydrating: false,
  error: null, // last sync error message (cleared on success)
  conflicts: [], // unresolved conflict notices (persisted in sync_meta)
  lastSyncedAt: null,
}
const listeners = new Set()
function setState(patch) {
  state = { ...state, ...patch }
  for (const l of listeners) l(state)
}
export function subscribeSync(cb) {
  listeners.add(cb)
  cb(state)
  return () => listeners.delete(cb)
}
export function getSyncState() {
  return state
}
export function useSyncStatus() {
  const [s, setS] = useState(getSyncState())
  useEffect(() => subscribeSync(setS), [])
  return s
}

// Store subscription: which tables a pull changed, so the UI can refresh.
const pullListeners = new Set()
export function onPullApplied(cb) {
  pullListeners.add(cb)
  return () => pullListeners.delete(cb)
}
function notifyPullApplied(tables) {
  if (!tables.size) return
  for (const l of pullListeners) {
    try {
      l([...tables])
    } catch {
      /* listener errors must not break sync */
    }
  }
}

// ---- sync_meta helpers (bases, cursors, persisted conflict notices) --------
const baseKey = (table, id) => `base:${table}:${id}`
async function getBase(db, table, id) {
  return (await db.get(STORES.sync_meta, baseKey(table, id)))?.value ?? null
}
async function setBase(db, table, id, value) {
  await db.put(STORES.sync_meta, { key: baseKey(table, id), value })
}
async function clearBase(db, table, id) {
  await db.delete(STORES.sync_meta, baseKey(table, id))
}
const cursorKey = (pid, table) => `cursor:${pid}:${table}`
async function getCursor(db, pid, table) {
  return (await db.get(STORES.sync_meta, cursorKey(pid, table)))?.value ?? EPOCH
}
async function setCursor(db, pid, table, value) {
  await db.put(STORES.sync_meta, { key: cursorKey(pid, table), value })
}

async function loadConflicts(db) {
  return (await db.get(STORES.sync_meta, 'conflicts'))?.value ?? []
}
async function saveConflicts(db, conflicts) {
  await db.put(STORES.sync_meta, { key: 'conflicts', value: conflicts })
}
async function addConflict(db, notice) {
  const conflicts = await loadConflicts(db)
  // One live notice per record; a repeat replaces the older one.
  const next = conflicts.filter((c) => !(c.table === notice.table && c.recordId === notice.recordId))
  next.push({ id: crypto.randomUUID(), at: new Date().toISOString(), ...notice })
  await saveConflicts(db, next)
  setState({ conflicts: next })
}
export async function dismissConflict(id) {
  const db = await getDb()
  const next = (await loadConflicts(db)).filter((c) => c.id !== id)
  await saveConflicts(db, next)
  setState({ conflicts: next })
}

async function countPending() {
  const db = await getDb()
  return db.count(STORES.sync_queue)
}

// ---- outgoing queue (db.js sink) -------------------------------------------
async function enqueue(rec) {
  try {
    const db = await getDb()
    const key = `${rec.table}:${rec.id}`
    // Coalesce: one entry per row holding the LATEST intent; the row's current
    // local state is read at push time, so repeated edits collapse to one push.
    await db.put(STORES.sync_queue, {
      key,
      table: rec.table,
      id: rec.id,
      op: rec.op,
      project_id: rec.project_id ?? null,
      updated_at: rec.updated_at || null,
      attempts: 0,
      error: null,
    })
    setState({ pending: await countPending() })
    scheduleFlush()
  } catch {
    /* a queue write must never break the local write it followed */
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    sync()
  }, FLUSH_DEBOUNCE_MS)
}
function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    sync()
  }, RETRY_MS)
}

// ---- incoming pull + conflict logic -----------------------------------------
// Cascade a pulled remote delete the same way the local repository would, so
// child rows don't linger locally (the server cascades via ON DELETE CASCADE).
async function applyRemoteDelete(db, table, id) {
  const byIndex = async (store, index, value) =>
    db.getAllFromIndex(store, index, value).catch(() => [])
  const del = async (store, rows) => {
    if (!rows.length) return
    const tx = db.transaction(store, 'readwrite')
    for (const r of rows) tx.store.delete(r.id)
    await tx.done
  }
  if (table === 'chapters') {
    await del(STORES.chapter_versions, await byIndex(STORES.chapter_versions, 'chapter_id', id))
    await del(STORES.character_locations, await byIndex(STORES.character_locations, 'chapter_id', id))
  } else if (table === 'characters') {
    const locs = (await db.getAll(STORES.character_locations)).filter((l) => l.character_id === id)
    await del(STORES.character_locations, locs)
  } else if (table === 'places') {
    const locs = (await db.getAll(STORES.character_locations)).filter((l) => l.place_id === id)
    const tx = db.transaction(STORES.character_locations, 'readwrite')
    for (const l of locs) {
      if (l.character_id) tx.store.put({ ...l, place_id: null })
      else tx.store.delete(l.id)
    }
    await tx.done
  } else if (table === 'projects') {
    for (const store of [
      STORES.chapters, STORES.chapter_versions, STORES.terrains, STORES.characters,
      STORES.places, STORES.character_locations, STORES.events, STORES.regions, STORES.routes,
      STORES.ideas,
    ]) {
      await del(store, await byIndex(store, 'project_id', id))
    }
  }
  await db.delete(table, id)
  await clearBase(db, table, id)
}

// Create the "both drafts survive" chapter version from the server's body.
// Runs UNSUSPENDED so the new version is queued and propagates to the server
// (and from there to every other device).
async function createConflictVersion(db, chapter, serverBody) {
  const existing = await db.getAllFromIndex(STORES.chapter_versions, 'chapter_id', chapter.id)
  const nextNumber = existing.length
    ? Math.max(...existing.map((v) => v.version_number || 0)) + 1
    : 1
  const stamp = new Date().toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const version = makeChapterVersion({
    project_id: chapter.project_id,
    chapter_id: chapter.id,
    version_number: nextNumber,
    label: `Konflikt (anderes Gerät) ${stamp}`,
    body: serverBody ?? '',
  })
  await db.put(STORES.chapter_versions, version) // recorded → pushed
  return version
}

// Pull remote changes for the active project and merge them into the local
// store. Never clobbers a locally-pending edit: those route through the
// conflict rules above. Returns the set of locally-changed tables.
async function pullChanges() {
  const changed = new Set()
  if (!remote?.fetchChangesSince || !activeProjectId) return changed
  if (typeof navigator !== 'undefined' && !navigator.onLine) return changed
  const db = await getDb()
  const pid = activeProjectId

  const cursors = {}
  for (const t of PULL_TABLES) cursors[t] = await getCursor(db, pid, t)
  const tombstoneCursor = await getCursor(db, pid, 'tombstones')

  const { tables = {}, tombstones = [] } = await remote.fetchChangesSince(pid, {
    cursors,
    tombstoneCursor,
  })

  const pendingKeys = new Set((await db.getAll(STORES.sync_queue)).map((o) => o.key))
  // chapterId → { serverBody, title } for prose conflicts found this cycle.
  const chapterConflicts = new Map()
  const droppedPending = []
  // Every record the server SENT this cycle still exists remotely — any
  // tombstone for it is stale (deleted, then re-created/edited elsewhere).
  const liveOnServer = new Set()

  suspendSync(true)
  try {
    for (const table of PULL_TABLES) {
      const rows = tables[table] || []
      let cursor = cursors[table]
      for (const row of rows) {
        if (row.updated_at && row.updated_at > cursor) cursor = row.updated_at
        const key = `${table}:${row.id}`
        liveOnServer.add(key)
        const base = await getBase(db, table, row.id)
        if (row.updated_at && base === row.updated_at) continue // already seen this server state

        if (pendingKeys.has(key)) {
          // A locally-unsynced change meets a server change → the server moved
          // since our base (checked above) → conflict rules.
          const local = await db.get(table, row.id)
          if (!local) {
            // Local pending DELETE vs remote edit: cancel the delete, restore
            // the server row — never destroy the other device's edit silently.
            await db.put(table, row)
            await db.delete(STORES.sync_queue, key)
            droppedPending.push(key)
            await setBase(db, table, row.id, row.updated_at)
            changed.add(table)
            await addConflict(db, {
              type: 'delete-cancelled',
              table,
              recordId: row.id,
              label: row.name || row.title || row.label || 'Eintrag',
              message: 'Lokal gelöscht, aber auf einem anderen Gerät geändert — die Änderung wurde wiederhergestellt.',
            })
            continue
          }
          const isChapterProse =
            (table === 'chapters' || table === 'chapter_versions') &&
            row.body != null && local.body != null && row.body !== local.body
          if (isChapterProse) {
            const chapterId = table === 'chapters' ? row.id : row.chapter_id
            if (!chapterConflicts.has(chapterId)) {
              chapterConflicts.set(chapterId, {
                serverBody: row.body,
                // Prefer the chapters row's body (mirror of the server's active
                // version) when both arrive in the same pull.
                fromMirror: table === 'chapters',
              })
            } else if (table === 'chapters' && !chapterConflicts.get(chapterId).fromMirror) {
              chapterConflicts.set(chapterId, { serverBody: row.body, fromMirror: true })
            }
            // Local stays active + pending (it will push); server body is
            // preserved as a version below. Base advances: we've SEEN and
            // handled this server state.
            await setBase(db, table, row.id, row.updated_at)
            continue
          }
          // Everything else (cards, events, metadata, terrain, …): last-write-
          // wins by updated_at — quiet but accurate.
          if ((row.updated_at || '') > (local.updated_at || '')) {
            await db.put(table, row)
            await db.delete(STORES.sync_queue, key)
            droppedPending.push(key)
            changed.add(table)
          }
          await setBase(db, table, row.id, row.updated_at)
          continue
        }

        // No pending local change → a normal pull: apply the server version.
        await db.put(table, row)
        await setBase(db, table, row.id, row.updated_at)
        changed.add(table)
        // Make the merge visible on the OTHER device too: pulling a conflict
        // version someone else created points the author at it here as well.
        if (table === 'chapter_versions' && /^Konflikt/.test(row.label || '')) {
          const ch = await db.get(STORES.chapters, row.chapter_id)
          await addConflict(db, {
            type: 'chapter',
            table: 'chapters',
            recordId: row.chapter_id,
            chapterId: row.chapter_id,
            label: ch?.title || 'Kapitel',
            versionLabel: row.label,
            message: 'Dieses Kapitel wurde auf zwei Geräten bearbeitet — beide Fassungen sind als Versionen erhalten.',
          })
        }
      }
      if (cursor !== cursors[table]) await setCursor(db, pid, table, cursor)
    }

    // Tombstones: remote deletions. Skip when the local row is NEWER than the
    // delete (it was re-created/edited afterwards), and NEVER apply over a
    // locally-pending edit — keep the work and tell the author.
    let tCursor = tombstoneCursor
    for (const t of tombstones) {
      if (t.deleted_at && t.deleted_at > tCursor) tCursor = t.deleted_at
      const table = t.table_name
      if (!SYNCED_STORES.has(table)) continue
      const key = `${table}:${t.record_id}`
      if (liveOnServer.has(key)) continue // server still has the row → stale tombstone
      const local = await db.get(table, t.record_id).catch(() => null)
      if (!local) continue // already gone (or never had it)
      if ((local.updated_at || '') > t.deleted_at) continue // re-created/edited after the delete
      if (pendingKeys.has(key)) {
        await addConflict(db, {
          type: 'delete-kept',
          table,
          recordId: t.record_id,
          chapterId: table === 'chapters' ? t.record_id : undefined,
          label: local.name || local.title || local.label || 'Eintrag',
          message:
            'Auf einem anderen Gerät gelöscht, hier aber ungesichert bearbeitet — die lokale Fassung bleibt erhalten und wird wieder hochgeladen. Lösche sie erneut, falls das Löschen gewollt war.',
        })
        continue // keep local; the pending upsert resurrects the record
      }
      await applyRemoteDelete(db, table, t.record_id)
      changed.add(table)
    }
    if (tCursor !== tombstoneCursor) await setCursor(db, pid, 'tombstones', tCursor)
  } finally {
    suspendSync(false)
  }

  // Chapter prose conflicts: preserve the SERVER side as a new labelled
  // version (unsuspended → it queues and pushes). The local side stays active.
  for (const [chapterId, info] of chapterConflicts) {
    const chapter = await db.get(STORES.chapters, chapterId)
    if (!chapter || info.serverBody == null || info.serverBody === chapter.body) continue
    const version = await createConflictVersion(db, chapter, info.serverBody)
    changed.add(STORES.chapter_versions)
    await addConflict(db, {
      type: 'chapter',
      table: 'chapters',
      recordId: chapterId,
      chapterId,
      label: chapter.title || 'Kapitel',
      versionLabel: version.label,
      message:
        'Dieses Kapitel wurde auf zwei Geräten bearbeitet. Deine Fassung ist aktiv; die andere ist als Version gesichert — vergleiche und führe sie bei Bedarf zusammen.',
    })
  }

  if (droppedPending.length) setState({ pending: await countPending() })
  notifyPullApplied(changed)
  return changed
}

// ---- push (outgoing queue → remote) -----------------------------------------
async function pushQueued() {
  const db = await getDb()
  const ops = await db.getAll(STORES.sync_queue)
  if (!ops.length) {
    if (state.pending !== 0) setState({ pending: 0 })
    return true
  }
  let userId = null
  try {
    userId = getUserId ? await getUserId() : null
  } catch {
    userId = null // expired/absent token — attempt anyway; failure just retries
  }
  let result
  try {
    result = await remote.pushBatch(ops, { userId })
  } catch (e) {
    setState({ error: e?.message || 'Synchronisierung fehlgeschlagen.', pending: ops.length })
    return false
  }
  const done = new Set(result?.done || [])
  const failed = result?.failed || []
  const stamps = result?.stamps || {}
  const tx = db.transaction(STORES.sync_queue, 'readwrite')
  for (const key of done) tx.store.delete(key)
  for (const f of failed) {
    const row = ops.find((o) => o.key === f.key)
    if (row) tx.store.put({ ...row, attempts: (row.attempts || 0) + 1, error: f.error || 'Fehler' })
  }
  await tx.done
  // Record the server's resulting updated_at as the new BASE for every pushed
  // row (the server may re-stamp on update); deletes drop their base.
  for (const o of ops) {
    if (!done.has(o.key)) continue
    if (o.op === 'delete') await clearBase(db, o.table, o.id)
    else if (stamps[o.key]) await setBase(db, o.table, o.id, stamps[o.key])
  }
  const pending = await countPending()
  setState({
    pending,
    error: failed.length ? failed[0].error || 'Synchronisierung fehlgeschlagen.' : null,
    lastSyncedAt: pending === 0 ? new Date().toISOString() : state.lastSyncedAt,
  })
  return failed.length === 0
}

// One sync cycle: PULL (conflict-check against fresh server state), then PUSH.
// Safe to call anytime — it no-ops offline/busy and never drops queued work.
export async function sync() {
  if (!remote || busy) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  busy = true
  setState({ syncing: true })
  try {
    try {
      await pullChanges()
    } catch (e) {
      // A failed pull must not block pushing (and vice versa); surface it.
      setState({ error: e?.message || 'Abgleich fehlgeschlagen.' })
    }
    const ok = await pushQueued()
    if (!ok) scheduleRetry()
  } finally {
    busy = false
    setState({ syncing: false })
  }
}
// Part 1 name, kept for callers (status pill, tests).
export const flush = sync

// Fetch the user's project LIST into the local cache (a fresh device knows
// nothing until this runs). Additive; recording suspended.
export async function bootstrapProjects() {
  if (!remote?.fetchProjects) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  const db = await getDb()
  const rows = await remote.fetchProjects()
  suspendSync(true)
  try {
    for (const r of rows || []) {
      await db.put(STORES.projects, r)
      await setBase(db, STORES.projects, r.id, r.updated_at)
    }
  } finally {
    suspendSync(false)
  }
}

// Tell the engine which project to pull for; kicks a first cycle.
export function setSyncProject(projectId) {
  activeProjectId = projectId || null
  if (activeProjectId) scheduleFlush()
}

// Seed the local cache from the remote when opening a project online. ADDITIVE
// (never deletes local rows) and skipped while local changes are queued —
// pull/conflict logic covers that case instead. Also records bases + cursors.
export async function hydrateProject(projectId) {
  if (!remote || !projectId) return { skipped: 'no-remote' }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { skipped: 'offline' }
  const db = await getDb()
  if ((await countPending()) > 0) return { skipped: 'pending' }
  setState({ hydrating: true })
  try {
    const data = await remote.fetchProject(projectId)
    suspendSync(true)
    for (const [table, rows] of Object.entries(data || {})) {
      if (!SYNCED_STORES.has(table) || !rows?.length) continue
      let cursor = await getCursor(db, projectId, table)
      const tx = db.transaction(table, 'readwrite')
      for (const r of rows) tx.store.put(r)
      await tx.done
      for (const r of rows) {
        await setBase(db, table, r.id, r.updated_at)
        if (r.updated_at && r.updated_at > cursor) cursor = r.updated_at
      }
      await setCursor(db, projectId, table, cursor)
    }
    setState({ hydrating: false, error: null })
    return { ok: true }
  } catch (e) {
    setState({ hydrating: false })
    return { error: e?.message || 'Laden fehlgeschlagen.' }
  } finally {
    suspendSync(false)
  }
}

function onOnline() {
  setState({ online: true })
  sync()
}
function onOffline() {
  setState({ online: false })
}

// Wire the engine to a remote adapter + user-id provider. Idempotent.
export function initSync({ remote: r, getUserId: g }) {
  remote = r
  getUserId = g
  if (initialized) return
  initialized = true
  setSyncSink(enqueue)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    // Debug / e2e control surface.
    window.__sync = { state: () => state, flush: sync, pull: pullChanges, pending: countPending, dismissConflict }
    pullTimer = setInterval(() => {
      if (navigator.onLine && activeProjectId && !busy) sync()
    }, PULL_INTERVAL_MS)
    void pullTimer
  }
  // Recover queued work + unresolved conflict notices from a previous session.
  getDb()
    .then(async (db) => {
      const [pending, conflicts] = await Promise.all([countPending(), loadConflicts(db)])
      setState({
        pending,
        conflicts,
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
      })
      if (typeof navigator === 'undefined' || navigator.onLine) scheduleFlush()
    })
    .catch(() => {})
}
