/*
 * Budget tree model. Pure functions over the JSON document stored in a budget
 * note's own content: { rows: [ { id, title, amount, notes, children: [...] } ] }
 */

function newId() {
    return Math.random().toString(36).slice(2, 10)
}

function newRow(overrides = {}) {
    return { id: newId(), title: "", amount: 0, notes: "", children: [], ...overrides }
}

/*
 * A budget note is a render note, so its content is never touched by the text
 * editor and holds the document as raw JSON. A brand-new note is empty and any
 * unparseable content becomes an empty budget rather than throwing in the
 * widget's render path.
 */
function parseBudget(content) {
    let parsed = null
    try {
        parsed = content ? JSON.parse(String(content).trim()) : null
    } catch {
        parsed = null
    }
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : []
    return { rows: rows.map(normalizeRow) }
}

function normalizeRow(row) {
    const amount = Number(row?.amount)
    return {
        id: typeof row?.id === "string" && row.id ? row.id : newId(),
        title: typeof row?.title === "string" ? row.title : "",
        amount: Number.isFinite(amount) ? amount : 0,
        notes: typeof row?.notes === "string" ? row.notes : "",
        children: Array.isArray(row?.children) ? row.children.map(normalizeRow) : []
    }
}

function serializeBudget(budget) {
    return JSON.stringify({ rows: budget.rows }, null, 4)
}

/*
 * Resolves each row's effective total according to the configured rollup mode,
 * returning a parallel map of { id -> { total, childrenTotal, isLeaf, over } }.
 * Kept separate from the rows themselves so the stored document always holds
 * only what the user actually typed.
 */
function computeTotals(rows, mode) {
    const totals = {}

    function walk(row) {
        const isLeaf = row.children.length === 0
        const childrenTotal = row.children.reduce((sum, child) => sum + walk(child), 0)

        let total
        if (isLeaf) {
            total = row.amount
        } else if (mode === "additive") {
            total = row.amount + childrenTotal
        } else if (mode === "cap") {
            total = row.amount
        } else {
            total = childrenTotal
        }

        totals[row.id] = {
            total,
            childrenTotal,
            isLeaf,
            // Only meaningful in cap mode: children spending past the allocation.
            over: mode === "cap" && !isLeaf && childrenTotal > row.amount
        }
        return total
    }

    rows.forEach(walk)
    return totals
}

function grandTotal(rows, totals) {
    return rows.reduce((sum, row) => sum + (totals[row.id]?.total ?? 0), 0)
}

// Structural edits. Each returns a new rows array; the caller persists it.
function updateRow(rows, id, changes) {
    return rows.map(row =>
        row.id === id
            ? { ...row, ...changes }
            : { ...row, children: updateRow(row.children, id, changes) }
    )
}

function removeRow(rows, id) {
    return rows
        .filter(row => row.id !== id)
        .map(row => ({ ...row, children: removeRow(row.children, id) }))
}

// parentId null appends at the top level.
function addRow(rows, parentId, row = newRow()) {
    if (parentId === null) return [...rows, row]
    return rows.map(r =>
        r.id === parentId
            ? { ...r, children: [...r.children, row] }
            : { ...r, children: addRow(r.children, parentId, row) }
    )
}

function moveRow(rows, id, delta) {
    const index = rows.findIndex(row => row.id === id)
    if (index !== -1) {
        const target = index + delta
        if (target < 0 || target >= rows.length) return rows
        const next = [...rows]
        const [moved] = next.splice(index, 1)
        next.splice(target, 0, moved)
        return next
    }
    return rows.map(row => ({ ...row, children: moveRow(row.children, id, delta) }))
}

/*
 * The optional columns, in their default order. Title is deliberately absent:
 * it carries the twisty and the indentation, so it is always rendered first and
 * can be neither hidden nor moved. Actions are likewise always last.
 */
const COLUMNS = [
    { key: "amount", label: "Amount Budgeted" },
    { key: "total", label: "Total" },
    { key: "notes", label: "Notes" }
]

/*
 * Reconciles a stored column list against COLUMNS, so the widget always gets
 * every known column exactly once, in the stored order. Unknown keys (a column
 * removed in a later version) are dropped and columns missing from the stored
 * list (one added in a later version) are appended visible, which keeps an old
 * config forward-compatible instead of losing a column.
 */
function resolveColumns(stored) {
    const list = Array.isArray(stored) ? stored : []
    const seen = new Set()
    const resolved = []

    for (const entry of list) {
        const column = COLUMNS.find(c => c.key === entry?.key)
        if (column && !seen.has(column.key)) {
            seen.add(column.key)
            resolved.push({ ...column, visible: entry.visible !== false })
        }
    }
    for (const column of COLUMNS) {
        if (!seen.has(column.key)) resolved.push({ ...column, visible: true })
    }
    return resolved
}

// Moves a column within the list; out-of-range moves are no-ops so the caller
// can wire up/down buttons without bounds-checking at the edges.
function moveColumn(columns, key, delta) {
    const index = columns.findIndex(c => c.key === key)
    if (index === -1) return columns
    const target = index + delta
    if (target < 0 || target >= columns.length) return columns
    const next = [...columns]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    return next
}

// Ids of every row that has children — the rows a collapse-all should collapse.
// Leaves are excluded so the collapsed set never carries ids that do nothing.
function parentIds(rows) {
    const ids = []
    function walk(row) {
        if (row.children.length > 0) {
            ids.push(row.id)
            row.children.forEach(walk)
        }
    }
    rows.forEach(walk)
    return ids
}

/*
 * Import accepts the same document shape serializeBudget writes, and also a
 * bare array of rows. Row ids are regenerated so importing a file twice, or a
 * file exported from another budget, can never collide with existing ids.
 * Throws on anything that isn't recognisably a budget so the caller can report
 * it rather than silently wiping the note.
 */
function importBudget(text) {
    let parsed
    try {
        parsed = JSON.parse(String(text).trim())
    } catch {
        throw new Error("Not valid JSON.")
    }

    const rows = Array.isArray(parsed) ? parsed : parsed?.rows
    if (!Array.isArray(rows)) {
        throw new Error('Expected a JSON object with a "rows" array.')
    }

    const reid = row => ({ ...normalizeRow(row), id: newId(), children: row?.children?.map?.(reid) ?? [] })
    return rows.map(reid)
}

function exportBudget(rows) {
    return serializeBudget({ rows })
}

function formatAmount(value, currency, locale) {
    return new Intl.NumberFormat(locale || undefined, {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value)
}

module.exports = {
    newRow,
    parseBudget,
    serializeBudget,
    computeTotals,
    grandTotal,
    updateRow,
    removeRow,
    addRow,
    moveRow,
    COLUMNS,
    resolveColumns,
    moveColumn,
    parentIds,
    importBudget,
    exportBudget,
    formatAmount
}
