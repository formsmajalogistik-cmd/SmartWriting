import { Cloud, CloudOff, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import { SYNC_ENABLED } from '../data/repository.js'
import { useSyncStatus, flush } from '../data/syncEngine.js'

// Truthful local-first status: online/offline, unsynced count, syncing, errors.
// It NEVER says "synced" while changes are still queued. Only shown for the
// local-first backends.
export default function SyncStatus() {
  const { online, pending, syncing, error } = useSyncStatus()
  if (!SYNC_ENABLED) return null

  let cls, Icon, spin, text
  if (!online) {
    cls = 'offline'
    Icon = CloudOff
    text = pending > 0 ? `Offline · ${pending} ausstehend` : 'Offline'
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

  const title = error
    ? `Letzter Sync-Fehler: ${error}`
    : online
      ? 'Online — lokale Änderungen werden zu Supabase gesichert'
      : 'Offline — Änderungen werden lokal gespeichert und später synchronisiert'

  return (
    <button
      type="button"
      className={`sync-status ${cls}`}
      title={title}
      onClick={() => online && !syncing && flush()}
      aria-label={text}
    >
      <Icon size={13} className={spin ? 'spin' : ''} />
      <span className="sync-status-text">{text}</span>
    </button>
  )
}
