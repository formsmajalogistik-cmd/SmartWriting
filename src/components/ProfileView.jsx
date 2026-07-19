import { useState } from 'react'
import {
  ArrowLeft,
  KeyRound,
  BookOpen,
  Check,
  AlertTriangle,
  List,
  Cloud,
  CloudOff,
  UploadCloud,
  Loader2,
  Link2,
} from 'lucide-react'
import { useStore } from '../state/store.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useDrive } from '../drive/DriveProvider.jsx'

// Profile: change password (Supabase auth), Google Drive backup (opt-in), and a
// "Controls & syntax" reference for how the editor works.
export default function ProfileView() {
  const { setView } = useStore()
  const { user, isSupabaseConfigured } = useAuth()

  return (
    <div className="profile-view">
      <div className="profile-inner">
        <div className="profile-head">
          <button className="icon-btn with-label" onClick={() => setView('write')}>
            <ArrowLeft size={16} /> Zurück
          </button>
          <h2>Profil</h2>
          {user?.email && <span className="profile-email">{user.email}</span>}
        </div>

        <PasswordSection enabled={isSupabaseConfigured} />
        <DriveSection />
        <SyntaxGuide />
      </div>
    </div>
  )
}

function fmtTime(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function DriveSection() {
  const { configured, connected, status, lastBackupAt, hasProject, projectName, connect, reconnect, disconnect, backupNow } =
    useDrive()
  const busy = status.state === 'connecting' || status.state === 'backing-up'

  return (
    <section className="profile-section">
      <h3>
        <Cloud size={17} /> Google Drive Backup
      </h3>
      <p className="hint">
        Optional und pro Konto. Sichert das aktive Projekt (Markdown + JSON inkl. Porträts) in deine
        eigene Google-Drive. Es wird ausschließlich der eng begrenzte Scope <code>drive.file</code>{' '}
        angefragt — die App sieht nur ihre eigenen Dateien. Tokens sind kurzlebig; bei Ablauf bitte
        neu verbinden.
      </p>

      {!configured ? (
        <p className="hint">
          Nicht konfiguriert: setze <code>VITE_GOOGLE_CLIENT_ID</code> und starte neu.
        </p>
      ) : !connected ? (
        <>
          <button className="toggle primary with-label" onClick={connect} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />}
            Mit Google Drive verbinden
          </button>
          <DriveStatus status={status} />
        </>
      ) : (
        <>
          <div className="drive-connected">
            <span className="drive-badge">
              <Cloud size={14} /> Verbunden
            </span>
            {lastBackupAt && (
              <span className="drive-last">Letzte Sicherung: {fmtTime(lastBackupAt)}</span>
            )}
          </div>
          <div className="export-row">
            <button
              className="toggle primary with-label"
              onClick={backupNow}
              disabled={busy || !hasProject}
              title={hasProject ? `„${projectName}" jetzt sichern` : 'Kein aktives Projekt'}
            >
              {status.state === 'backing-up' ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <UploadCloud size={15} />
              )}
              Jetzt sichern
            </button>
            {status.state === 'needs-reconnect' && (
              <button className="toggle primary with-label" onClick={reconnect} disabled={busy}>
                <Link2 size={15} /> Google Drive neu verbinden
              </button>
            )}
            <button className="toggle with-label danger-text" onClick={disconnect} disabled={busy}>
              <CloudOff size={15} /> Trennen
            </button>
          </div>
          <DriveStatus status={status} />
        </>
      )}
    </section>
  )
}

function DriveStatus({ status }) {
  if (!status?.msg) return null
  const { state, msg, warnings } = status
  const Icon =
    state === 'success'
      ? Check
      : state === 'error' || state === 'needs-reconnect'
        ? AlertTriangle
        : state === 'connecting' || state === 'backing-up'
          ? Loader2
          : Check
  const cls =
    state === 'success'
      ? 'ok'
      : state === 'error'
        ? 'err'
        : state === 'needs-reconnect'
          ? 'warn'
          : 'info'
  return (
    <>
      <div className={`profile-msg drive-status ${cls}`}>
        <Icon size={15} className={state === 'connecting' || state === 'backing-up' ? 'spin' : ''} />{' '}
        {msg}
      </div>
      {warnings?.length > 0 && (
        <ul className="export-warnings">
          {warnings.map((w, i) => (
            <li key={i}>
              <AlertTriangle size={13} /> {w}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function PasswordSection({ enabled }) {
  const { changePassword } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }

  async function onSubmit(e) {
    e.preventDefault()
    setMsg(null)
    if (pw.length < 6) return setMsg({ type: 'err', text: 'Passwort muss mindestens 6 Zeichen haben.' })
    if (pw !== pw2) return setMsg({ type: 'err', text: 'Passwörter stimmen nicht überein.' })
    setBusy(true)
    const res = await changePassword(pw)
    setBusy(false)
    if (res.ok) {
      setMsg({ type: 'ok', text: 'Passwort aktualisiert.' })
      setPw('')
      setPw2('')
    } else {
      setMsg({ type: 'err', text: res.error || 'Aktualisierung fehlgeschlagen.' })
    }
  }

  return (
    <section className="profile-section">
      <h3>
        <KeyRound size={17} /> Passwort ändern
      </h3>
      {!enabled && (
        <p className="hint">Im lokalen Modus nicht verfügbar (kein Supabase-Backend).</p>
      )}
      <form className="profile-form" onSubmit={onSubmit}>
        <label className="field">
          <span>Neues Passwort</span>
          <input
            type="password"
            autoComplete="new-password"
            value={pw}
            disabled={!enabled || busy}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Neues Passwort bestätigen</span>
          <input
            type="password"
            autoComplete="new-password"
            value={pw2}
            disabled={!enabled || busy}
            onChange={(e) => setPw2(e.target.value)}
          />
        </label>
        {msg && (
          <div className={`profile-msg ${msg.type}`}>
            {msg.type === 'ok' ? <Check size={15} /> : <AlertTriangle size={15} />} {msg.text}
          </div>
        )}
        <button type="submit" className="toggle primary" disabled={!enabled || busy}>
          {busy ? 'Speichert …' : 'Passwort aktualisieren'}
        </button>
      </form>
    </section>
  )
}

// Sample uses the same .hashlink classes as the editor preview.
const SYNTAX = [
  {
    code: '# Überschrift',
    title: 'Überschrift',
    desc: 'Raute + Leerzeichen am Zeilenanfang. „## “ und „### “ für kleinere Ebenen.',
    sample: <span className="syntax-h">Überschrift</span>,
  },
  {
    code: '**fett**',
    title: 'Fett',
    desc: 'Auch mit Strg/Cmd+B auf die Auswahl.',
    sample: <strong>fett</strong>,
  },
  {
    code: '*kursiv*  ·  _kursiv_',
    title: 'Kursiv',
    desc: 'Auch mit Strg/Cmd+I auf die Auswahl.',
    sample: <em>kursiv</em>,
  },
  {
    code: '>Hallo<',
    title: 'Anführungszeichen',
    desc: 'Beim Tippen wird „>“ sofort zu » und „<“ zu « (deutsche Guillemets). Kein Blockzitat mehr.',
    sample: <span>»Hallo«</span>,
  },
  {
    code: '- Punkt',
    title: 'Liste',
    desc: '„- “ (oder „1. “ für nummeriert) am Zeilenanfang.',
    sample: (
      <span className="chip-label">
        <List size={14} /> Punkt
      </span>
    ),
  },
  {
    code: '[Text](https://…)',
    title: 'Link',
    desc: 'Markdown-Link.',
    sample: <span className="syntax-link">Text</span>,
  },
  {
    code: '`Code`',
    title: 'Code',
    desc: 'Inline-Code in Backticks.',
    sample: <code>Code</code>,
  },
]

function SyntaxGuide() {
  const { editorGuillemets, setEditorGuillemets } = useStore()
  return (
    <section className="profile-section">
      <h3>
        <BookOpen size={17} /> Steuerung &amp; Syntax
      </h3>
      <p className="hint">So funktioniert der Editor. Die Vorschau zeigt das Ergebnis.</p>

      <label className="checkbox syntax-toggle">
        <input
          type="checkbox"
          checked={editorGuillemets}
          onChange={(e) => setEditorGuillemets(e.target.checked)}
        />
        <span>
          »«-Ersetzung beim Tippen („&gt;“ → » und „&lt;“ → «). Ausschalten, falls du wörtliche
          spitze Klammern brauchst.
        </span>
      </label>

      <div className="syntax-table">
        {SYNTAX.map((s) => (
          <div className="syntax-row" key={s.title}>
            <code className="syntax-code">{s.code}</code>
            <div className="syntax-meaning">
              <span className="syntax-title">{s.title}</span>
              <span className="syntax-desc">{s.desc}</span>
            </div>
            <div className="syntax-sample">{s.sample}</div>
          </div>
        ))}
      </div>

      <h4 className="syntax-subhead">Karten-Verlinkung</h4>
      <div className="syntax-table">
        <div className="syntax-row">
          <code className="syntax-code">#Name</code>
          <div className="syntax-meaning">
            <span className="syntax-title">Karten-Link</span>
            <span className="syntax-desc">
              Verlinkt eine Figur oder einen Ort. Tippe „#“, um Karten vorzuschlagen. Auch Aliase
              („weitere Namen“ auf der Karte, z. B. #Bambam für Valkorin) lösen auf. In der Vorschau
              zeigt ein Klick/Hover eine Vorschau der Karte.
            </span>
          </div>
          <div className="syntax-sample">
            <span className="hashlink resolved static">#Amrex</span>
          </div>
        </div>
        <div className="syntax-row">
          <code className="syntax-code">#Name</code>
          <div className="syntax-meaning">
            <span className="syntax-title">Provisorisch</span>
            <span className="syntax-desc">Der Name der verlinkten Karte ist noch nicht final.</span>
          </div>
          <div className="syntax-sample">
            <span className="hashlink resolved provisional static">#Amrex</span>
          </div>
        </div>
        <div className="syntax-row">
          <code className="syntax-code">#Name</code>
          <div className="syntax-meaning">
            <span className="syntax-title">Unaufgelöst</span>
            <span className="syntax-desc">
              Keine passende Karte (Tippfehler oder noch nicht angelegt).
            </span>
          </div>
          <div className="syntax-sample">
            <span className="hashlink unresolved static">#Bambom</span>
          </div>
        </div>
        <div className="syntax-row">
          <code className="syntax-code">#Name</code>
          <div className="syntax-meaning">
            <span className="syntax-title">Mehrdeutig</span>
            <span className="syntax-desc">
              Mehrere Karten tragen diesen Namen (doppelter Alias oder Namenskollision) — unter
              „Namen“ auflösen.
            </span>
          </div>
          <div className="syntax-sample">
            <span className="hashlink ambiguous static">#Santal</span>
          </div>
        </div>
      </div>
    </section>
  )
}
