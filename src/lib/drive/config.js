// Google Drive backup config. The ONLY Google credential in client code is the
// public OAuth Client ID (no client secret, no service-role material). The
// scope is the least-privilege `drive.file` — the app may only see/manage the
// files IT creates, never the rest of the user's Drive.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const isDriveConfigured = Boolean(GOOGLE_CLIENT_ID)

export const BACKUP_ROOT_FOLDER = 'SmartWriting Backups'
