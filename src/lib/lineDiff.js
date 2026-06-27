// Line-level side-by-side diff (LCS) for the version Compare view.
// Returns rows: { left, right, type } where type is
//   'equal'   — unchanged line on both sides
//   'replace' — changed line (left = old, right = new)
//   'del'     — line only on the left (removed)
//   'add'     — line only on the right (added)
// Line-level (not intra-line) keeps it readable and fast for chapter-length text.

const MAX_LINES = 3000 // guard the O(n*m) table for very large chapters

export function diffLines(aText, bText) {
  const a = String(aText ?? '').split('\n')
  const b = String(bText ?? '').split('\n')

  // Fallback for unusually large inputs: align by index, mark mismatches.
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    const rows = []
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      const left = i < a.length ? a[i] : null
      const right = i < b.length ? b[i] : null
      rows.push({ left, right, type: left === right ? 'equal' : 'replace' })
    }
    return { rows, truncated: true }
  }

  const n = a.length
  const m = b.length
  // LCS length table.
  const dp = new Int32Array((n + 1) * (m + 1))
  const w = m + 1
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)])
    }
  }

  // Backtrack into ops.
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: 'eq', a: a[i], b: b[j] })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      ops.push({ t: 'del', a: a[i] })
      i++
    } else {
      ops.push({ t: 'ins', b: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ t: 'del', a: a[i++] })
  while (j < m) ops.push({ t: 'ins', b: b[j++] })

  // Build side-by-side rows, pairing runs of del+ins as 'replace'.
  const rows = []
  let dels = []
  let ins = []
  const flush = () => {
    const k = Math.min(dels.length, ins.length)
    for (let x = 0; x < k; x++) rows.push({ left: dels[x], right: ins[x], type: 'replace' })
    for (let x = k; x < dels.length; x++) rows.push({ left: dels[x], right: null, type: 'del' })
    for (let x = k; x < ins.length; x++) rows.push({ left: null, right: ins[x], type: 'add' })
    dels = []
    ins = []
  }
  for (const op of ops) {
    if (op.t === 'del') dels.push(op.a)
    else if (op.t === 'ins') ins.push(op.b)
    else {
      flush()
      rows.push({ left: op.a, right: op.b, type: 'equal' })
    }
  }
  flush()

  const changed = rows.some((r) => r.type !== 'equal')
  return { rows, truncated: false, changed }
}
