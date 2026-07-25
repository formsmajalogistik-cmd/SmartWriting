// Per-user Google Drive backup orchestrator (opt-in, OFF by default).
//
// Holds the connection state + status, manages short-lived access tokens in
// memory (never persisted), debounces auto-backup after changes while connected
// and the token is valid, and exposes a manual "Back up now". If a user never
// connects, none of this runs and Supabase stays the sole source of truth.
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store.jsx'
import { isDriveConfigured } from '../lib/drive/config.js'
import { requestToken, revokeToken } from '../lib/drive/gis.js'

const DriveContext = createContext(null)

// Debounce for auto-backup after a change. Overridable in tests.
const AUTO_DEBOUNCE_MS =
  (typeof window !== 'undefined' && Number(window.__DRIVE_AUTO_MS__)) || 30000
const TOKEN_SKEW_MS = 60000 // refresh if within 1 min of expiry

export function DriveProvider({ children }) {
  const {
    activeProject,
    activeProjectId,
    exportSnapshot,
    getPortraitUrl,
    healLocalPortraits,
    getDriveLink,
    saveDriveLink,
    chapters,
    characters,
    places,
    events,
    locations,
  } = useStore()

  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState({ state: 'idle', msg: '' })
  const [lastBackupAt, setLastBackupAt] = useState(null)

  const tokenRef = useRef(null) // { access_token, expires_at } — memory only
  const linkRef = useRef(null) // cached drive_backup row
  const baselineRef = useRef(null) // { projectId, sig } for change detection
  const inFlightRef = useRef(false)

  // Load the user's linkage on mount and whenever the active project changes.
  useEffect(() => {
    if (!isDriveConfigured) return
    let cancelled = false
    ;(async () => {
      try {
        const link = await getDriveLink()
        if (cancelled) return
        linkRef.current = link
        setConnected(!!link?.connected)
        setLastBackupAt(link?.links?.[activeProjectId]?.last_backup_at || null)
      } catch {
        if (!cancelled) {
          setConnected(false)
          setLastBackupAt(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [getDriveLink, activeProjectId])

  // A lightweight signature of the active project's data — changes only when
  // content actually changes, so we don't back up on every render.
  const dataSig = useMemo(
    () =>
      JSON.stringify({
        c: chapters.map((x) => [x.id, x.updated_at]),
        ch: characters.map((x) => [x.id, x.updated_at]),
        p: places.map((x) => [x.id, x.updated_at]),
        e: events.map((x) => [x.id, x.updated_at]),
        l: locations.map((x) => [x.id, x.character_id, x.place_id]),
      }),
    [chapters, characters, places, events, locations],
  )

  // Resolve an access token.
  //   interactive (user gesture) → may open the GIS popup to (re)authorise.
  //   non-interactive (auto-backup) → NEVER opens a popup; only a token already
  //     held in memory is used. If none/expired, we throw a needs-reconnect
  //     signal so auto-backup stops cleanly instead of flashing a blocked popup.
  async function ensureToken(interactive) {
    const t = tokenRef.current
    if (t && Date.now() < t.expires_at - TOKEN_SKEW_MS) return t
    if (!interactive) {
      const e = new Error('reconnect-required')
      e.needsReconnect = true
      throw e
    }
    const fresh = await requestToken('') // gesture → popup allowed
    tokenRef.current = fresh
    return fresh
  }

  const runBackup = useCallback(
    async ({ interactive }) => {
      if (!isDriveConfigured || !connected || !activeProjectId) return
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        // Acquire the token FIRST (auto-path never pops up). Only show "saving"
        // once we actually have a token and are about to upload — so the
        // indicator is never "saving" when nothing can be uploaded.
        let token
        try {
          token = await ensureToken(interactive)
        } catch (e) {
          if (e?.needsReconnect || e?.isAuth) {
            setStatus({
              state: 'needs-reconnect',
              msg: 'Google Drive neu verbinden, um zu sichern.',
            })
          } else {
            setStatus({ state: 'error', msg: e?.message || 'Sicherung fehlgeschlagen.' })
          }
          return
        }
        setStatus({ state: 'backing-up', msg: 'Sicherung wird vorbereitet …' })
        // Images that only ever existed in this browser's blob store can't be
        // fetched by the bundle (or by any other device). Lift them into
        // Storage first, so the backup contains them instead of warning.
        await healLocalPortraits?.().catch(() => {})
        const snapshot = await exportSnapshot()
        const { buildRecoverableBundle } = await import('../lib/export/bundle.js')
        const bundle = await buildRecoverableBundle(snapshot, {
          getPortraitUrl,
          onProgress: (m) => setStatus({ state: 'backing-up', msg: m }),
        })
        const { backupProjectToDrive } = await import('../lib/drive/backup.js')
        const updated = await backupProjectToDrive({
          token: token.access_token,
          projectId: activeProjectId,
          bundle,
          link: linkRef.current,
          onProgress: (m) => setStatus({ state: 'backing-up', msg: m }),
        })
        const at = new Date().toISOString()
        updated.links[activeProjectId].last_backup_at = at
        const saved = await saveDriveLink({
          root_folder_id: updated.root_folder_id,
          links: updated.links,
        })
        linkRef.current = saved
        baselineRef.current = { projectId: activeProjectId, sig: dataSig }
        setLastBackupAt(at)
        setStatus({
          state: 'success',
          msg: bundle.warnings.length
            ? `In Google Drive gesichert (mit ${bundle.warnings.length} Warnung(en)).`
            : 'In Google Drive gesichert.',
          warnings: bundle.warnings,
        })
      } catch (e) {
        // A failed token/upload must NEVER read as success. Auth failures →
        // needs-reconnect (user fixes with a click); everything else → error.
        if (e?.isAuth || e?.needsReconnect) {
          setStatus({
            state: 'needs-reconnect',
            msg: 'Google Drive neu verbinden, um zu sichern.',
          })
        } else {
          setStatus({ state: 'error', msg: e?.message || 'Sicherung fehlgeschlagen.' })
        }
      } finally {
        inFlightRef.current = false
      }
    },
    [connected, activeProjectId, exportSnapshot, getPortraitUrl, healLocalPortraits, saveDriveLink, dataSig],
  )

  // Auto-backup: debounce after a real change, while connected. The first
  // signature per project is treated as the baseline (no backup on open/switch).
  useEffect(() => {
    if (!isDriveConfigured || !connected || !activeProjectId) return
    if (baselineRef.current?.projectId !== activeProjectId) {
      baselineRef.current = { projectId: activeProjectId, sig: dataSig }
      return
    }
    if (dataSig === baselineRef.current.sig) return
    const id = setTimeout(() => runBackup({ interactive: false }), AUTO_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [dataSig, connected, activeProjectId, runBackup])

  const connect = useCallback(async () => {
    if (!isDriveConfigured) return
    setStatus({ state: 'connecting', msg: 'Verbinde mit Google Drive …' })
    try {
      tokenRef.current = await requestToken('consent') // user picks the account/Drive
      const saved = await saveDriveLink({ connected: true })
      linkRef.current = saved
      setConnected(true)
      setLastBackupAt(saved?.links?.[activeProjectId]?.last_backup_at || null)
      setStatus({ state: 'idle', msg: 'Mit Google Drive verbunden.' })
    } catch (e) {
      setStatus({ state: 'error', msg: e?.message || 'Verbindung fehlgeschlagen.' })
    }
  }, [saveDriveLink, activeProjectId])

  // User-initiated (button click) → popup is allowed. Re-runs the token flow and,
  // on success, immediately backs up so the click has a visible result.
  const reconnect = useCallback(async () => {
    setStatus({ state: 'connecting', msg: 'Erneut verbinden …' })
    try {
      tokenRef.current = await requestToken('')
      setStatus({ state: 'idle', msg: 'Wieder verbunden.' })
      runBackup({ interactive: true })
    } catch (e) {
      setStatus({ state: 'error', msg: e?.message || 'Verbindung fehlgeschlagen.' })
    }
  }, [runBackup])

  const disconnect = useCallback(async () => {
    if (tokenRef.current) revokeToken(tokenRef.current.access_token)
    tokenRef.current = null
    try {
      const saved = await saveDriveLink({ connected: false })
      linkRef.current = saved
    } catch {
      /* still reflect disconnected locally */
    }
    setConnected(false)
    setStatus({ state: 'idle', msg: 'Google Drive getrennt.' })
  }, [saveDriveLink])

  const value = useMemo(
    () => ({
      configured: isDriveConfigured,
      connected,
      status,
      lastBackupAt,
      projectName: activeProject?.name || null,
      hasProject: !!activeProjectId,
      connect,
      reconnect,
      disconnect,
      backupNow: () => runBackup({ interactive: true }),
    }),
    [connected, status, lastBackupAt, activeProject, activeProjectId, connect, reconnect, disconnect, runBackup],
  )

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

export function useDrive() {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDrive must be used within DriveProvider')
  return ctx
}
