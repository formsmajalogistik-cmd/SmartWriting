// In-memory remote adapter for tests — same contract as remoteSupabase, but
// stores pushed rows in a plain object and records a push log. Exposed on
// `window.__fakeRemote` so e2e can assert what actually reached "the server".
// Used only by the `localfirst-test` backend; never in production.
import { getDb } from './db.js'

const CHILD_TABLES = [
  'chapters',
  'chapter_versions',
  'characters',
  'places',
  'character_locations',
  'events',
  'regions',
  'routes',
  'terrains',
]

export function createFakeRemote() {
  const tables = {} // table → Map(id → row)
  const pushLog = [] // { op, table, id }
  const tbl = (t) => tables[t] || (tables[t] = new Map())

  const api = {
    _tables: tables,
    _pushLog: pushLog,
    count(table) {
      return tables[table] ? tables[table].size : 0
    },

    async fetchProject(projectId) {
      const out = { projects: [] }
      if (tables.projects?.has(projectId)) out.projects = [tables.projects.get(projectId)]
      for (const t of CHILD_TABLES) {
        out[t] = tables[t] ? [...tables[t].values()].filter((r) => r.project_id === projectId) : []
      }
      return out
    },

    async pushBatch(ops, { userId }) {
      const db = await getDb()
      const done = []
      for (const o of ops) {
        if (o.op === 'delete') {
          tables[o.table]?.delete(o.id)
        } else {
          const row = await db.get(o.table, o.id)
          if (row) tbl(o.table).set(o.id, { ...row, user_id: userId ?? row.user_id })
        }
        pushLog.push({ op: o.op, table: o.table, id: o.id })
        done.push(o.key)
      }
      return { done, failed: [] }
    },
  }

  if (typeof window !== 'undefined') window.__fakeRemote = api
  return api
}
