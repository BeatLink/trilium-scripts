/*
 * Budget tree model. Pure functions over the JSON document stored in a budget
 * note's own content:
 *   {
 *     rows: [ { id, title, amount, notes, children: [...] } ],
 *     transactions: [ { id, date, description, amount, rowId } ]
 *   }
 * `rows` is what was planned, `transactions` what was actually spent. A
 * transaction naming a row is on-budget spending; one with no row (or naming a
 * row that has since been deleted) is off-budget.
 */

function newId() {
    return Math.random().toString(36).slice(2, 10)
}

function newRow(overrides = {}) {
    return { id: newId(), title: "", amount: 0, notes: "", children: [], ...overrides }
}

function newTransaction(overrides = {}) {
    return { id: newId(), date: "", description: "", amount: 0, rowId: null, ...overrides }
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
    const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : []
    return { rows: rows.map(normalizeRow), transactions: transactions.map(normalizeTransaction) }
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

function normalizeTransaction(transaction) {
    const amount = Number(transaction?.amount)
    return {
        id: typeof transaction?.id === "string" && transaction.id ? transaction.id : newId(),
        date: typeof transaction?.date === "string" ? transaction.date : "",
        description: typeof transaction?.description === "string" ? transaction.description : "",
        amount: Number.isFinite(amount) ? amount : 0,
        rowId: typeof transaction?.rowId === "string" && transaction.rowId ? transaction.rowId : null
    }
}

function serializeBudget(budget) {
    return JSON.stringify({ rows: budget.rows, transactions: budget.transactions }, null, 4)
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

// Transaction edits. Like the row edits above, each returns a new array.
function addTransaction(transactions, transaction = newTransaction()) {
    return [...transactions, transaction]
}

function updateTransaction(transactions, id, changes) {
    return transactions.map(t => (t.id === id ? { ...t, ...changes } : t))
}

function removeTransaction(transactions, id) {
    return transactions.filter(t => t.id !== id)
}

/*
 * Months are handled as "YYYY-MM" strings sliced straight off the ISO date,
 * never through Date parsing — an ISO date string parsed as a Date is UTC, so
 * anywhere west of Greenwich the 1st of a month would land in the previous one.
 */
function monthOf(date) {
    return typeof date === "string" ? date.slice(0, 7) : ""
}

function shiftMonth(month, delta) {
    const [year, index] = month.split("-").map(Number)
    const absolute = year * 12 + (index - 1) + delta
    return `${String(Math.floor(absolute / 12)).padStart(4, "0")}-${String((absolute % 12) + 1).padStart(2, "0")}`
}

function formatMonth(month, locale) {
    const [year, index] = month.split("-").map(Number)
    return new Date(year, index - 1, 1).toLocaleDateString(locale || undefined, {
        month: "long",
        year: "numeric"
    })
}

// Today in the local timezone, as the ISO date and month the pickers use.
// toISOString would be UTC and so give yesterday for part of the evening.
function currentDate() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function currentMonth() {
    return monthOf(currentDate())
}

function rowIds(rows) {
    const ids = new Set()
    function walk(row) {
        ids.add(row.id)
        row.children.forEach(walk)
    }
    rows.forEach(walk)
    return ids
}

/*
 * A transaction is on-budget when it names a row that still exists. Deleting a
 * row therefore turns its spending off-budget rather than making it vanish from
 * the totals, and no cleanup pass over the transactions is needed on delete.
 */
function isOnBudget(transaction, ids) {
    return Boolean(transaction.rowId) && ids.has(transaction.rowId)
}

function transactionsForMonth(transactions, month) {
    return transactions.filter(t => monthOf(t.date) === month)
}

// Flattened rows for the transaction row picker, each labelled by its full path
// so two rows sharing a title stay distinguishable.
function rowOptions(rows) {
    const options = []
    function walk(row, depth, path) {
        const label = path ? `${path} / ${row.title || "Untitled"}` : row.title || "Untitled"
        options.push({ id: row.id, label, depth })
        row.children.forEach(child => walk(child, depth + 1, label))
    }
    rows.forEach(row => walk(row, 0, ""))
    return options
}

/*
 * The month's spending resolved against the budget: the on/off split, and each
 * row's budgeted amount beside what was actually spent against it. A row's
 * actual includes its descendants' spending, so a parent's actual is comparable
 * to the budgeted total the rollup mode gives it.
 */
function spendingReport(rows, transactions, month, mode) {
    const ids = rowIds(rows)
    const totals = computeTotals(rows, mode)
    const monthly = transactionsForMonth(transactions, month)

    const direct = {}
    let onBudget = 0
    let offBudget = 0
    for (const transaction of monthly) {
        if (isOnBudget(transaction, ids)) {
            onBudget += transaction.amount
            direct[transaction.rowId] = (direct[transaction.rowId] ?? 0) + transaction.amount
        } else {
            offBudget += transaction.amount
        }
    }

    const actuals = {}
    function rollup(row) {
        const total = (direct[row.id] ?? 0) + row.children.reduce((sum, child) => sum + rollup(child), 0)
        actuals[row.id] = total
        return total
    }
    rows.forEach(rollup)

    const perRow = []
    function flatten(row, depth) {
        const budgeted = totals[row.id]?.total ?? 0
        const actual = actuals[row.id] ?? 0
        perRow.push({
            id: row.id,
            title: row.title,
            depth,
            budgeted,
            actual,
            variance: budgeted - actual,
            over: actual > budgeted
        })
        row.children.forEach(child => flatten(child, depth + 1))
    }
    rows.forEach(row => flatten(row, 0))

    return {
        month,
        transactions: monthly,
        offBudgetTransactions: monthly.filter(t => !isOnBudget(t, ids)),
        onBudget,
        offBudget,
        total: onBudget + offBudget,
        perRow
    }
}

// The on/off split for `count` months ending at (and including) `endMonth`,
// oldest first. Months with no spending are included as zeroes so the series
// has no gaps.
function monthlyTrend(rows, transactions, endMonth, count) {
    const ids = rowIds(rows)
    const trend = []
    for (let offset = count - 1; offset >= 0; offset--) {
        const month = shiftMonth(endMonth, -offset)
        let onBudget = 0
        let offBudget = 0
        for (const transaction of transactionsForMonth(transactions, month)) {
            if (isOnBudget(transaction, ids)) onBudget += transaction.amount
            else offBudget += transaction.amount
        }
        trend.push({ month, onBudget, offBudget, total: onBudget + offBudget })
    }
    return trend
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
 * file exported from another budget, can never collide with existing ids; each
 * transaction's `rowId` is remapped through the same table so the imported
 * spending still points at the row it was recorded against. Throws on anything
 * that isn't recognisably a budget so the caller can report it rather than
 * silently wiping the note.
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

    const remap = new Map()
    const reid = row => {
        const id = newId()
        if (typeof row?.id === "string" && row.id) remap.set(row.id, id)
        return { ...normalizeRow(row), id, children: row?.children?.map?.(reid) ?? [] }
    }
    const imported = rows.map(reid)

    const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : []
    return {
        rows: imported,
        transactions: transactions.map(transaction => {
            const normalized = normalizeTransaction(transaction)
            return { ...normalized, id: newId(), rowId: remap.get(normalized.rowId) ?? null }
        })
    }
}

function exportBudget(budget) {
    return serializeBudget(budget)
}

function formatAmount(value, currency, locale) {
    return new Intl.NumberFormat(locale || undefined, {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value)
}

function formatDate(date, locale) {
    const [year, month, day] = String(date).split("-").map(Number)
    if (!year || !month || !day) return date || ""
    return new Date(year, month - 1, day).toLocaleDateString(locale || undefined, {
        month: "short",
        day: "numeric"
    })
}

module.exports = {
    newRow,
    newTransaction,
    parseBudget,
    serializeBudget,
    computeTotals,
    grandTotal,
    updateRow,
    removeRow,
    addRow,
    moveRow,
    addTransaction,
    updateTransaction,
    removeTransaction,
    monthOf,
    currentDate,
    currentMonth,
    shiftMonth,
    formatMonth,
    formatDate,
    transactionsForMonth,
    rowOptions,
    spendingReport,
    monthlyTrend,
    COLUMNS,
    resolveColumns,
    moveColumn,
    parentIds,
    importBudget,
    exportBudget,
    formatAmount
}
