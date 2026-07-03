// Test remote adapter — same contract as remoteSupabase, but backed by a tiny
// HTTP fake server (scratch tooling, run only during e2e) so that TWO isolated
// browser sessions can share one "server" for multi-device sync tests.
// Used only by the `localfirst-test` backend; never in production builds.
//
// Unlike the real server, the fake KEEPS each row's provided updated_at
// (no trigger re-stamp) so last-write-wins tests are deterministic by edit
// time. The engine's base logic works identically either way.
import { getDb } from './db.js'

const BASE_URL = import.meta.env.VITE_FAKE_REMOTE_URL || 'http://localhost:4399'

async function call(path, payload) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  if (!res.ok) throw new Error(`Fake-Remote ${path}: HTTP ${res.status}`)
  return res.json()
}

export function createFakeRemote() {
  const api = {
    fetchProjects: () => call('/fetchProjects', {}),
    fetchProject: (projectId) => call('/fetchProject', { projectId }),
    fetchChangesSince: (projectId, { cursors, tombstoneCursor } = {}) =>
      call('/fetchChangesSince', { projectId, cursors, tombstoneCursor }),

    async pushBatch(ops, { userId }) {
      // Gather each upsert's CURRENT local row (same behaviour as the real
      // adapter) and ship everything to the fake server in one request.
      const db = await getDb()
      const payload = []
      for (const o of ops) {
        if (o.op === 'delete') {
          payload.push({ key: o.key, table: o.table, id: o.id, op: 'delete', project_id: o.project_id })
        } else {
          const row = await db.get(o.table, o.id)
          if (!row) continue // gone locally → server treats as no-op; marked done below
          payload.push({ key: o.key, table: o.table, id: o.id, op: 'upsert', row: { ...row, user_id: userId ?? row.user_id } })
        }
      }
      const res = await call('/pushBatch', { ops: payload })
      // Rows that vanished locally count as done (nothing left to push).
      const done = new Set(res.done || [])
      for (const o of ops) if (!payload.some((p) => p.key === o.key)) done.add(o.key)
      return { done: [...done], failed: res.failed || [], stamps: res.stamps || {} }
    },
  }
  if (typeof window !== 'undefined') window.__fakeRemote = { url: BASE_URL }
  return api
}
