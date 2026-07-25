// Service-worker registration + "a new version is live" detection.
//
// WHY THIS EXISTS: every deploy renames the hashed asset files. A tab that is
// still running the previous deploy asks for chunk names that no longer exist,
// and the first lazy import (map, PDF export, …) fails with "Failed to fetch
// dynamically imported module". That is not a bug the author can act on — so
// the app watches for it and offers a reload instead:
//
//   • the worker reports an update  → friendly prompt ("neue Version verfügbar")
//   • a chunk/import request fails  → the SAME prompt, marked urgent, because a
//     failed chunk means this tab is running against a deploy that is gone.
//
// `applyUpdate()` performs the recovery: activate the waiting worker, drop the
// caches this app owns, then reload — so the reload cannot land on the old
// shell again.
const SW_URL = '/sw.js'

let state = { updateReady: false, chunkFailed: false }
const listeners = new Set()
let registration = null

function setState(patch) {
  const next = { ...state, ...patch }
  if (next.updateReady === state.updateReady && next.chunkFailed === state.chunkFailed) return
  state = next
  for (const l of listeners) {
    try {
      l(state)
    } catch {
      /* a listener must never break the recovery path */
    }
  }
}

export function getUpdateState() {
  return state
}
export function subscribeUpdates(cb) {
  listeners.add(cb)
  cb(state)
  return () => listeners.delete(cb)
}

// Chunk-load failures surface in three different shapes depending on browser
// and whether the import was preloaded — match the message, not the shape.
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|dynamically imported module|Loading chunk \d+ failed/i

function looksLikeChunkFailure(value) {
  if (!value) return false
  const msg = typeof value === 'string' ? value : value.message || String(value)
  return CHUNK_ERROR_RE.test(msg)
}

// Public so the lazy-import call sites (and tests) can report a failure they
// already caught themselves.
export function reportChunkFailure(err) {
  if (!looksLikeChunkFailure(err)) return false
  setState({ chunkFailed: true })
  // A stale tab often has a newer worker waiting; nudge it so the reload lands
  // on the new deploy.
  registration?.update?.().catch(() => {})
  return true
}

// Activate the newest worker, clear this app's caches, reload.
export async function applyUpdate() {
  try {
    const reg = registration || (await navigator.serviceWorker?.getRegistration?.())
    // The generated worker calls skipWaiting() itself, but an explicitly
    // waiting one (older build, or update just installed) needs the nudge.
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
    await reg?.update?.().catch(() => {})
  } catch {
    /* recovery must proceed even without a usable registration */
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      // Precache + our own runtime caches; leave anything else alone.
      await Promise.all(
        keys
          .filter((k) => /workbox|precache|app-shell|pdf-lib|map-3d/i.test(k))
          .map((k) => caches.delete(k)),
      )
    }
  } catch {
    /* a cache we cannot clear must not block the reload */
  }
  window.location.reload()
}

// Wire everything up. Safe to call once at start-up; no-ops without SW support.
export function initPwaUpdates() {
  if (typeof window === 'undefined') return

  // 1) Failed lazy imports — Vite's own signal plus the generic error paths.
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault?.() // we handle it: show the prompt, not a console crash
    setState({ chunkFailed: true })
    registration?.update?.().catch(() => {})
  })
  window.addEventListener('error', (e) => {
    if (looksLikeChunkFailure(e?.message) || looksLikeChunkFailure(e?.error)) {
      reportChunkFailure(e.error || e.message)
    }
  })
  window.addEventListener('unhandledrejection', (e) => {
    if (looksLikeChunkFailure(e?.reason)) reportChunkFailure(e.reason)
  })

  if (!('serviceWorker' in navigator)) return

  // 2) The worker itself. Registered after load so it never competes with the
  //    first paint, then polled lightly so a long-lived tab notices a deploy.
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' })
      registration = reg
      // An update that finished installing while another tab was in control.
      if (reg.waiting && navigator.serviceWorker.controller) setState({ updateReady: true })
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing
        if (!sw) return
        sw.addEventListener('statechange', () => {
          // "installed" WITH a controller = an update of an existing install
          // (a first install has no controller and needs no prompt).
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            setState({ updateReady: true })
          }
        })
      })
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
    } catch {
      /* no worker → the app still runs, just without offline support */
    }
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register)

  // 3) A new worker took control of this tab: its deploy is now the live one.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    setState({ updateReady: true })
  })
}
