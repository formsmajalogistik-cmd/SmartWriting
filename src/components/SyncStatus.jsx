import { useEffect, useRef, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, AlertTriangle, GitMerge, X } from 'lucide-react'
import { SYNC_ENABLED } from '../data/repository.js'
import { useSyncStatus, flush, dismissConflict, TABLE_LABELS } from '../data/syncEngine.js'
import { useStore } from '../state/store.jsx'

// Truthful local-first status — but QUIET.
//
// The engine's raw state changes with almost every keystroke (queued → pushing
// → clear). Reporting that live made the top bar twitch and, because the labels
// differ in length, shoved its neighbours around. So this shows the SETTLED
// state instead, and only when it is worth the author's attention:
//
//   errors · conflicts · offline · changes still pending after a few seconds
//
// Everything else — the normal save/sync cycle — is a single dim dot. Silence
// therefore still means "everything is safely stored": pending work is never
// hidden, only given a moment to finish before it is announced. The badge sits
// in a fixed-width slot (see .sync-wrap), so no state can shift the top bar.
const PENDING_GRACE_MS = 4000 // let the normal cycle finish before complaining
const OFFLINE_GRACE_MS = 600 // ride out a blink of connectivity loss

export default function SyncStatus() {
  const { online, pending, syncing, error, errors, conflicts } = useSyncStatus()
  const { openChapterAt } = useStore()
  const [open, setOpen] = useState(false)
  const popRef = useRef(null)

  // "Pending long enough to mention". The timer restarts only on the 0 → >0
  // edge, so a burst of typing (queue rises and clears repeatedly) never trips
  // it, while work that genuinely lingers always surfaces.
  const idle = pending === 0
  const [lingering, setLingering] = useState(false)
  useEffect(() => {
    if (idle) {
      setLingering(false)
      return
    }
    const id = setTimeout(() => setLingering(true), PENDING_GRACE_MS)
    return () => clearTimeout(id)
  }, [idle])

  // Offline is a real state, not churn — debounced only against flapping.
  const [offline, setOffline] = useState(!online)
  useEffect(() => {
    if (online) {
      setOffline(false)
      return
    }
    const id = setTimeout(() => setOffline(true), OFFLINE_GRACE_MS)
    return () => clearTimeout(id)
  }, [online])

  // Close the conflict list on outside click.
  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!SYNC_ENABLED) return null
  const hasConflicts = conflicts.length > 0
  const errorList = errors || []
  const hasErrors = !!error || errorList.length > 0

  // Priority (unchanged from before, minus the routine states): offline first
  // because it EXPLAINS why nothing is syncing, and its label carries the
  // pending count, so queued or failed work is still visible while offline.
  let cls, Icon, spin, text
  if (offline) {
    cls = 'offline'
    Icon = CloudOff
    text = pending > 0 ? `Offline · ${pending} ausstehend` : 'Offline'
  } else if (hasConflicts) {
    cls = 'conflict'
    Icon = GitMerge
    text = `Konflikte (${conflicts.length})`
  } else if (hasErrors) {
    cls = 'err'
    Icon = AlertTriangle
    text = pending > 0 ? `Fehler · ${pending} ausstehend` : 'Fehler'
  } else if (lingering) {
    cls = 'pending'
    Icon = syncing ? RefreshCw : Cloud
    spin = syncing
    text = `${pending} ausstehend`
  } else {
    // Settled, or mid-cycle: a dim dot, identical in every routine state.
    cls = 'idle'
    Icon = null
    text = ''
  }

  const title = offline
    ? 'Offline — Änderungen werden lokal gespeichert und später synchronisiert'
    : hasConflicts
      ? 'Konflikte ansehen'
      : hasErrors
        ? `Sync-Fehler ansehen${error ? `: ${error}` : ''}`
        : lingering
          ? `${pending} Änderung(en) noch nicht synchronisiert — klicken, um es erneut zu versuchen`
          : 'Alles gespeichert und synchronisiert'

  return (
    <span className="sync-wrap" ref={popRef}>
      <button
        type="button"
        className={`sync-status ${cls}`}
        title={title}
        onClick={() => {
          if (hasConflicts || hasErrors) setOpen((v) => !v)
          else if (online && !syncing) flush()
        }}
        aria-label={text || 'Alles gespeichert und synchronisiert'}
      >
        {Icon ? <Icon size={13} className={spin ? 'spin' : ''} /> : <span className="sync-dot" />}
        {text && <span className="sync-status-text">{text}</span>}
      </button>

      {open && hasErrors && (
        <div className="sync-pop" role="dialog" aria-label="Sync-Fehler">
          <div className="sync-pop-head">Sync-Fehler</div>
          <ul className="sync-pop-list">
            {errorList.length > 0 ? (
              errorList.map((e) => (
                <li key={e.key} className="sync-pop-item">
                  <div className="sync-pop-label">
                    {TABLE_LABELS[e.table] || e.table}
                    {e.label ? `: „${e.label}“` : ''}
                    <span className="sync-pop-version">
                      {e.op === 'delete' ? 'Löschen fehlgeschlagen' : 'Speichern fehlgeschlagen'}
                    </span>
                  </div>
                  <div className="sync-pop-msg sync-err-msg">{e.message}</div>
                </li>
              ))
            ) : (
              <li className="sync-pop-item">
                <div className="sync-pop-msg sync-err-msg">{error}</div>
              </li>
            )}
          </ul>
          <div className="sync-pop-actions sync-pop-retry">
            <button
              type="button"
              className="toggle primary"
              disabled={!online || syncing}
              onClick={() => flush()}
            >
              <RefreshCw size={13} className={syncing ? 'spin' : ''} /> Erneut versuchen
            </button>
          </div>
        </div>
      )}

      {open && !hasErrors && hasConflicts && (
        <div className="sync-pop" role="dialog" aria-label="Sync-Konflikte">
          <div className="sync-pop-head">Konflikte</div>
          <ul className="sync-pop-list">
            {conflicts.map((c) => (
              <li key={c.id} className="sync-pop-item">
                <div className="sync-pop-label">
                  {c.label}
                  {c.versionLabel && <span className="sync-pop-version">→ „{c.versionLabel}“</span>}
                </div>
                <div className="sync-pop-msg">{c.message}</div>
                <div className="sync-pop-actions">
                  {c.chapterId && (
                    <button
                      type="button"
                      className="toggle"
                      onClick={() => {
                        openChapterAt(c.chapterId)
                        setOpen(false)
                      }}
                    >
                      Kapitel öffnen
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn sm"
                    title="Als erledigt markieren"
                    aria-label="Konflikt als erledigt markieren"
                    onClick={() => dismissConflict(c.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}
