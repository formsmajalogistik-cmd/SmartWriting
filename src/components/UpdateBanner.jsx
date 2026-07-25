import { useEffect, useState } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { subscribeUpdates, applyUpdate } from '../pwa/updates.js'

// "Neue Version verfügbar" — shown when a deploy has landed.
//
// Two flavours, same fix (reload onto the new version):
//   • update available — a quiet banner; the author decides when to reload, so
//     a reload never interrupts a sentence.
//   • chunk load failed — this tab is running against a deploy whose files are
//     gone, so parts of the app WILL fail. Blocking dialog with the same
//     button, in plain German instead of a raw import error.
export default function UpdateBanner() {
  const [{ updateReady, chunkFailed }, setState] = useState({ updateReady: false, chunkFailed: false })
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => subscribeUpdates(setState), [])

  async function reload() {
    setBusy(true)
    await applyUpdate()
  }

  if (chunkFailed) {
    return (
      <div className="update-blocker" role="alertdialog" aria-label="Neue Version verfügbar">
        <div className="update-dialog">
          <div className="update-dialog-head">
            <AlertTriangle size={18} />
            <h2>Neue Version verfügbar</h2>
          </div>
          <p>
            Diese Seite läuft noch mit einer älteren Version der App, deren Dateien nicht mehr
            verfügbar sind. Lade neu, um weiterzuarbeiten — deine Texte sind lokal gespeichert und
            gehen dabei nicht verloren.
          </p>
          <button type="button" className="toggle primary" onClick={reload} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'spin' : ''} />
            {busy ? 'Wird neu geladen …' : 'Jetzt neu laden'}
          </button>
        </div>
      </div>
    )
  }

  if (!updateReady || dismissed) return null
  return (
    <div className="update-banner" role="status">
      <RefreshCw size={15} />
      <span>Neue Version verfügbar.</span>
      <button type="button" className="toggle primary sm" onClick={reload} disabled={busy}>
        {busy ? 'Lädt neu …' : 'Neu laden'}
      </button>
      <button
        type="button"
        className="update-later"
        onClick={() => setDismissed(true)}
        title="Später neu laden"
      >
        Später
      </button>
    </div>
  )
}
