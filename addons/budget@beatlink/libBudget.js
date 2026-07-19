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
    importBudget,
    exportBudget,
    formatAmount
}
