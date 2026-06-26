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
async function getTokenClient() {
  await loadGis()
  if (!_tokenClient) {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {}, // replaced per request
    })
  }
  return _tokenClient
}

// Request an access token. `prompt`:
//   'consent'  → force the account-chooser/consent screen (used on connect, so
//                the user explicitly picks WHICH Google account/Drive to use)
//   'none'     → silent; rejects if interaction would be required (token expiry)
//   ''         → default (may show minimal UI if needed)
// Resolves { access_token, expires_at, scope }.
export function requestToken(prompt = '') {
  return new Promise((resolve, reject) => {
    getTokenClient()
      .then((client) => {
        client.callback = (resp) => {
          if (resp?.error) return reject(new Error(resp.error_description || resp.error))
          if (!resp?.access_token) return reject(new Error('Kein Zugriffstoken erhalten.'))
          resolve({
            access_token: resp.access_token,
            scope: resp.scope || DRIVE_SCOPE,
            expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
          })
        }
        try {
          client.requestAccessToken({ prompt })
        } catch (e) {
          reject(e)
        }
      })
      .catch(reject)
  })
}

export function revokeToken(accessToken) {
  try {
    window.google?.accounts?.oauth2?.revoke?.(accessToken, () => {})
  } catch {
    /* best-effort */
  }
}
