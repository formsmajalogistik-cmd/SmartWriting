// Outgoing-sync engine for the local-first backend.
//
// The UI always reads/writes the LOCAL IndexedDB store (via the unchanged
// repository interface). Every local mutation to a synced store is recorded by
// db.js into a coalescing QUEUE here; this engine pushes queued rows to the
// remote (Supabase) when online, last-write-wins by pushing the row's latest
// local state. It also hydrates the local cache from the remote when a project
// is first opened online. It does NOT pull/merge ongoing remote changes — this
// device is assumed to be the only writer for now (conflict handling is next).
import { useEffect, useState } from 'react'
import { getDb, STORES, SYNCED_STORES, setSyncSink, suspendSync } from './db.js'

const RETRY_MS = 6000
const FLUSH_DEBOUNCE_MS = 250

let remote = null
let getUserId = null
let initialized = false
let flushTimer = null
let retryTimer = null

let state = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0, // queued, not-yet-pushed changes
  syncing: false, // a push is in flight
  hydrating: false,
  error: null, // last sync error message (cleared on success)
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

// React hook for the status indicator.
export function useSyncStatus() {
  const [s, setS] = useState(getSyncState())
  useEffect(() => subscribeSync(setS), [])
  return s
}

async function countPending() {
  const db = await getDb()
  return db.count(STORES.sync_queue)
}

// db.js sink: called after each committed local mutation to a synced store.
async function enqueue(rec) {
  try {
    const db = await getDb()
    const key = `${rec.table}:${rec.id}`
    // Coalesce: one entry per row, holding the LATEST intent. We push the row's
    // current local state at flush time, so repeated edits collapse to one push.
    await db.put(STORES.sync_queue, {
      key,
      table: rec.table,
      id: rec.id,
      op: rec.op,
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
    flush()
  }, FLUSH_DEBOUNCE_MS)
}
function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    flush()
  }, RETRY_MS)
}

// Push all queued changes. Safe to call anytime; it no-ops when offline, busy,
// or empty, and keeps the queue intact on failure so nothing is ever lost.
export async function flush() {
  if (!remote || state.syncing) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  const db = await getDb()
  const ops = await db.getAll(STORES.sync_queue)
  if (!ops.length) {
    if (state.pending !== 0) setState({ pending: 0 })
    return
  }
  setState({ syncing: true, error: null })
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
    setState({ syncing: false, error: e?.message || 'Synchronisierung fehlgeschlagen.', pending: ops.length })
    scheduleRetry()
    return
  }
  const done = new Set(result?.done || [])
  const failed = result?.failed || []
  const tx = db.transaction(STORES.sync_queue, 'readwrite')
  for (const key of done) tx.store.delete(key)
  for (const f of failed) {
    const row = ops.find((o) => o.key === f.key)
    if (row) tx.store.put({ ...row, attempts: (row.attempts || 0) + 1, error: f.error || 'Fehler' })
  }
  await tx.done
  const pending = await countPending()
  setState({
    syncing: false,
    pending,
    error: failed.length ? failed[0].error || 'Synchronisierung fehlgeschlagen.' : null,
    lastSyncedAt: pending === 0 ? new Date().toISOString() : state.lastSyncedAt,
  })
  if (pending > 0) scheduleRetry()
}

// Seed the local cache from the remote when opening a project online. Skipped
// offline, and skipped when local changes are still queued (local is ahead —
// re-hydrating would clobber unpushed work). Recording is suspended so writing
// server rows into the cache doesn't re-queue them.
export async function hydrateProject(projectId) {
  if (!remote || !projectId) return { skipped: 'no-remote' }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { skipped: 'offline' }
  const db = await getDb()
  if ((await countPending()) > 0) return { skipped: 'pending' }
  setState({ hydrating: true })
  try {
    const data = await remote.fetchProject(projectId)
    suspendSync(true)
    // ADDITIVE hydrate: upsert every remote row into the local cache, but NEVER
    // delete a local row that's missing remotely. Deleting-absent would be
    // "pulling remote deletes", which this session must not do — and it would
    // risk wiping local work if a fetch came back empty. On a fresh device the
    // cache is empty so this simply seeds it; on reopen it refreshes in place.
    for (const [table, rows] of Object.entries(data || {})) {
      if (!SYNCED_STORES.has(table) || !rows?.length) continue
      const tx = db.transaction(table, 'readwrite')
      for (const r of rows) tx.store.put(r)
      await tx.done
    }
    setState({ hydrating: false, error: null })
    return { ok: true }
  } catch (e) {
    // Hydrate is best-effort: on failure we keep whatever is cached locally.
    setState({ hydrating: false })
    return { error: e?.message || 'Laden fehlgeschlagen.' }
  } finally {
    suspendSync(false)
  }
}

function onOnline() {
  setState({ online: true })
  flush()
}
function onOffline() {
  setState({ online: false })
}

// Wire the engine to a remote adapter + a user-id provider. Idempotent.
export function initSync({ remote: r, getUserId: g }) {
  remote = r
  getUserId = g
  if (initialized) return
  initialized = true
  setSyncSink(enqueue)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    // Expose a tiny control surface for debugging / e2e.
    window.__sync = { state: () => state, flush, pending: countPending }
  }
  // Recover queued work from a previous session and try to drain it.
  countPending()
    .then((pending) => {
      setState({ pending, online: typeof navigator === 'undefined' ? true : navigator.onLine })
      if (typeof navigator === 'undefined' || navigator.onLine) scheduleFlush()
    })
    .catch(() => {})
}
