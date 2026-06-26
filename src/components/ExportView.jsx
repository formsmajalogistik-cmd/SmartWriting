import { useState } from 'react'
import { FileArchive, FileText, IdCard, Loader2, AlertTriangle, Check, Info } from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { slugify } from '../lib/export/util.js'

// Export hub: recoverable ZIP (Markdown + JSON) and readable PDFs.
export default function ExportView() {
  const { activeProject, chapters, characters, places, exportSnapshot, getPortraitUrl } = useStore()

  // Per-action status: { busy, msg, type } keyed by action id.
  const [status, setStatus] = useState({})
  const setS = (key, s) => setStatus((p) => ({ ...p, [key]: s }))
  const [warnings, setWarnings] = useState([])
  const [chapterId, setChapterId] = useState('')
  const [cardRef, setCardRef] = useState('') // "character:<id>" | "place:<id>"

  const projectSlug = slugify(activeProject?.name, 'projekt')

  async function run(key, label, fn) {
    setS(key, { busy: true, msg: label, type: 'info' })
    try {
      await fn()
      setS(key, { busy: false, msg: 'Fertig.', type: 'ok' })
    } catch (e) {
      setS(key, { busy: false, msg: e?.message || 'Fehlgeschlagen.', type: 'err' })
    }
  }

  // --- Recoverable ZIP -------------------------------------------------
  async function exportZip() {
    setWarnings([])
    await run('zip', 'Sammle Projektdaten …', async () => {
      const snapshot = await exportSnapshot()
      const { buildRecoverableBundle, bundleToZip } = await import('../lib/export/bundle.js')
      setS('zip', { busy: true, msg: 'Erzeuge Backup …', type: 'info' })
      const bundle = await buildRecoverableBundle(snapshot, {
        getPortraitUrl,
        onProgress: (m) => setS('zip', { busy: true, msg: m, type: 'info' }),
      })
      setS('zip', { busy: true, msg: 'Komprimiere ZIP …', type: 'info' })
      const blob = await bundleToZip(bundle)
      const { triggerDownload } = await import('../lib/export/util.js')
      triggerDownload(blob, `${projectSlug}_backup.zip`)
      if (bundle.warnings.length) setWarnings(bundle.warnings)
    })
  }

  // --- PDFs ------------------------------------------------------------
  async function exportManuscriptPdf() {
    await run('manuscript', 'Erzeuge Manuskript-PDF …', async () => {
      const snapshot = await exportSnapshot()
      const { exportManuscriptPdf } = await import('../lib/export/pdf.js')
      await exportManuscriptPdf(snapshot, `${projectSlug}_manuskript.pdf`)
    })
  }
  async function exportChapterPdf() {
    if (!chapterId) return
    await run('chapter', 'Erzeuge Kapitel-PDF …', async () => {
      const snapshot = await exportSnapshot()
      const ch = snapshot.chapters.find((c) => c.id === chapterId)
      if (!ch) throw new Error('Kapitel nicht gefunden.')
      const { exportChapterPdf } = await import('../lib/export/pdf.js')
      await exportChapterPdf(ch, snapshot, `${projectSlug}_${slugify(ch.title, 'kapitel')}.pdf`)
    })
  }
  async function exportCardPdf() {
    if (!cardRef) return
    await run('card', 'Erzeuge Karten-PDF …', async () => {
      const [kind, id] = cardRef.split(':')
      const snapshot = await exportSnapshot()
      const list = kind === 'character' ? snapshot.characters : snapshot.places
      const card = list.find((c) => c.id === id)
      if (!card) throw new Error('Karte nicht gefunden.')
      const { exportCardPdf } = await import('../lib/export/pdf.js')
      await exportCardPdf(kind, card, snapshot, { getPortraitUrl }, `${slugify(card.name, 'karte')}.pdf`)
    })
  }

  const chaptersSorted = [...chapters].sort((a, b) => (a.number || 0) - (b.number || 0))

  return (
    <div className="export-view">
      <div className="export-inner">
        <h2>Export</h2>
        <div className="export-note">
          <Info size={16} />
          <span>
            <strong>Markdown + JSON (ZIP)</strong> ist dein wiederherstellbares Backup. <strong>PDF</strong>{' '}
            ist nur zum Lesen.
          </span>
        </div>

        {/* Recoverable backup */}
        <section className="export-section">
          <h3>
            <FileArchive size={18} /> Wiederherstellbares Backup (ZIP)
          </h3>
          <p className="hint">
            Ein Markdown pro Kapitel (mit Frontmatter), eine vollständige <code>world-data.json</code>{' '}
            und die Figuren-Porträts — offen, lesbar, app-unabhängig.
          </p>
          <button className="toggle primary with-label" onClick={exportZip} disabled={status.zip?.busy}>
            {status.zip?.busy ? <Loader2 size={15} className="spin" /> : <FileArchive size={15} />}
            ZIP exportieren
          </button>
          <StatusLine s={status.zip} />
          {warnings.length > 0 && (
            <ul className="export-warnings">
              {warnings.map((w, i) => (
                <li key={i}>
                  <AlertTriangle size={13} /> {w}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* PDF — readability */}
        <section className="export-section">
          <h3>
            <FileText size={18} /> PDF (zum Lesen)
          </h3>

          <div className="export-row">
            <button
              className="toggle with-label"
              onClick={exportManuscriptPdf}
              disabled={status.manuscript?.busy || chapters.length === 0}
            >
              {status.manuscript?.busy ? <Loader2 size={15} className="spin" /> : <FileText size={15} />}
              Ganzes Manuskript
            </button>
            <StatusLine s={status.manuscript} inline />
          </div>

          <div className="export-row">
            <select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
              <option value="">— Kapitel wählen —</option>
              {chaptersSorted.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number}. {c.title}
                </option>
              ))}
            </select>
            <button className="toggle with-label" onClick={exportChapterPdf} disabled={!chapterId || status.chapter?.busy}>
              {status.chapter?.busy ? <Loader2 size={15} className="spin" /> : <FileText size={15} />}
              Kapitel-PDF
            </button>
            <StatusLine s={status.chapter} inline />
          </div>

          <div className="export-row">
            <select value={cardRef} onChange={(e) => setCardRef(e.target.value)}>
              <option value="">— Figur oder Ort wählen —</option>
              {characters.length > 0 && (
                <optgroup label="Figuren">
                  {characters.map((c) => (
                    <option key={c.id} value={`character:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {places.length > 0 && (
                <optgroup label="Orte">
                  {places.map((p) => (
                    <option key={p.id} value={`place:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button className="toggle with-label" onClick={exportCardPdf} disabled={!cardRef || status.card?.busy}>
              {status.card?.busy ? <Loader2 size={15} className="spin" /> : <IdCard size={15} />}
              Karten-PDF
            </button>
            <StatusLine s={status.card} inline />
          </div>
        </section>
      </div>
    </div>
  )
}

function StatusLine({ s, inline }) {
  if (!s) return inline ? null : <div className="export-status placeholder" />
  const Icon = s.type === 'ok' ? Check : s.type === 'err' ? AlertTriangle : Loader2
  return (
    <div className={`export-status ${s.type} ${inline ? 'inline' : ''}`}>
      <Icon size={14} className={s.busy ? 'spin' : ''} /> {s.msg}
    </div>
  )
}
