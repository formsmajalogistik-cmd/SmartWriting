// Google Identity Services (GIS) token flow — browser-only, no backend.
//
// We use the GIS OAuth2 *token* client to obtain short-lived access tokens for
// the least-privilege `drive.file` scope. Tokens are returned to the caller and
// kept only in memory (never persisted). On expiry the caller must request a
// new token (silently if the grant is still valid, otherwise via reconnect).
import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from './config.js'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
let _gisPromise = null

// Load the GIS script once. If a mock (window.google.accounts.oauth2) is already
// present — e.g. in tests — use it without any network call.
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (!_gisPromise) {
    _gisPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
      if (existing) {
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error('GIS konnte nicht geladen werden.')))
        if (window.google?.accounts?.oauth2) resolve()
        return
      }
      const s = document.createElement('script')
      s.src = GIS_SRC
      s.async = true
      s.defer = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Google-Anmeldedienst konnte nicht geladen werden.'))
      document.head.appendChild(s)
    })
  }
  return _gisPromise
}

let _tokenClient = null
// Per-request error handler — GIS's `error_callback` (popup blocked/closed/
// failed) is read off the client; we route it to the in-flight request so the
// token Promise can never hang waiting for a callback that never comes.
let _onError = null
async function getTokenClient() {
  await loadGis()
  if (!_tokenClient) {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {}, // replaced per request
      error_callback: (err) => _onError && _onError(err),
    })
  }
  return _tokenClient
}

const TOKEN_TIMEOUT_MS = 60000

// Request an access token. This MAY open a popup, so it must only be called
// from a user gesture (connect / reconnect / "back up now" button). `prompt`:
//   'consent'  → force the account-chooser/consent screen (used on connect, so
//                the user explicitly picks WHICH Google account/Drive to use)
//   ''         → default (may show minimal UI if needed)
// The returned Promise ALWAYS settles: success/error via GIS callback, popup
// failure via error_callback, and a hard timeout as a final backstop — so a
// blocked or dismissed popup can never leave the caller stuck "loading".
// Resolves { access_token, expires_at, scope }.
export function requestToken(prompt = '') {
  return new Promise((resolve, reject) => {
    getTokenClient()
      .then((client) => {
        let settled = false
        const finish = (fn, arg) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          _onError = null
          fn(arg)
        }
        const timer = setTimeout(
          () => finish(reject, authError('Zeitüberschreitung bei der Google-Anmeldung.')),
          TOKEN_TIMEOUT_MS,
        )
        client.callback = (resp) => {
          if (resp?.error) return finish(reject, authError(resp.error_description || resp.error))
          if (!resp?.access_token) return finish(reject, authError('Kein Zugriffstoken erhalten.'))
          finish(resolve, {
            access_token: resp.access_token,
            scope: resp.scope || DRIVE_SCOPE,
            expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
          })
        }
        _onError = (err) =>
          finish(reject, authError(err?.type || err?.message || 'Google-Anmeldung fehlgeschlagen.'))
        try {
          client.requestAccessToken({ prompt })
        } catch (e) {
          finish(reject, e)
        }
      })
      .catch(reject)
  })
}

// Tag auth failures so callers can show a "reconnect" state instead of a generic
// error, and so the backup never reports a false success.
function authError(message) {
  const e = new Error(message || 'Google-Anmeldung fehlgeschlagen.')
  e.isAuth = true
  return e
}

export function revokeToken(accessToken) {
  try {
    window.google?.accounts?.oauth2?.revoke?.(accessToken, () => {})
  } catch {
    /* best-effort */
  }
}
