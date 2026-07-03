import { useEffect, useRef, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, Check, AlertTriangle, GitMerge, X } from 'lucide-react'
import { SYNC_ENABLED } from '../data/repository.js'
import { useSyncStatus, flush, dismissConflict } from '../data/syncEngine.js'
import { useStore } from '../state/store.jsx'

// Truthful local-first status: online/offline, unsynced count, syncing, errors
// AND unresolved conflicts. It never says "synchronisiert" while changes are
// queued or conflicts await review. Chapter conflicts link straight to the
// chapter (whose conflict version sits in the version bar for comparing).
export default function SyncStatus() {
  const { online, pending, syncing, error, conflicts } = useSyncStatus()
  const { openChapterAt } = useStore()
  const [open, setOpen] = useState(false)
  const popRef = useRef(null)

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

  let cls, Icon, spin, text
  if (!online) {
    cls = 'offline'
    Icon = CloudOff
    text = pending > 0 ? `Offline · ${pending} ausstehend` : 'Offline'
  } else if (hasConflicts) {
    cls = 'conflict'
    Icon = GitMerge
    text = `Konflikte (${conflicts.length})`
  } else if (error && pending > 0) {
    cls = 'err'
    Icon = AlertTriangle
    text = `Fehler · ${pending} ausstehend`
  } else if (syncing) {
    cls = 'syncing'
    Icon = RefreshCw
    spin = true
    text = pending > 0 ? `Synchronisiert … (${pending})` : 'Synchronisiert …'
  } else if (pending > 0) {
    cls = 'pending'
    Icon = Cloud
    text = `${pending} ausstehend`
  } else {
    cls = 'ok'
    Icon = Check
    text = 'Synchronisiert'
  }

  const title = hasConflicts
    ? 'Konflikte ansehen'
    : error
      ? `Letzter Sync-Fehler: ${error}`
      : online
        ? 'Online — lokale Änderungen werden zu Supabase gesichert'
        : 'Offline — Änderungen werden lokal gespeichert und später synchronisiert'

  return (
    <span className="sync-wrap" ref={popRef}>
      <button
        type="button"
        className={`sync-status ${cls}`}
        title={title}
        onClick={() => {
          if (hasConflicts) setOpen((v) => !v)
          else if (online && !syncing) flush()
        }}
        aria-label={text}
      >
        <Icon size={13} className={spin ? 'spin' : ''} />
        <span className="sync-status-text">{text}</span>
      </button>

      {open && hasConflicts && (
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
