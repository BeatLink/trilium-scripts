/*
 * Budget tree model. Pure functions over the JSON document stored in a budget
 * note's own content:
 *   {
 *     rows: [ { id, title, income, expense, notes, children: [...] } ],
 *     transactions: [ { id, date, description, income, expense, rowId } ]
 *   }
 * `rows` is what was planned, `transactions` what actually moved. Single-entry
 * bookkeeping: every record carries an income amount and an expense amount, and
 * its balance is income minus expense. Nothing marks a record as one kind or the
 * other — a record with only an expense is a bill, one with only income is a
 * paycheck, and one with both nets out.
 *
 * A transaction naming a row is on-budget; one with no row, or naming a row that
 * has since been deleted, is off-budget.
 */

function newId() {
    return Math.random().toString(36).slice(2, 10)
}

/*
 * Both amounts off any record shape, tolerating the pre-2.0 single `amount`
 * field, which was always an expense. Keeps an old document readable rather
 * than silently zeroing every figure in it.
 */
function normalizeAmounts(source) {
    const income = Number(source?.income)
    const expense = Number(source?.expense)
    const legacy = Number(source?.amount)
    return {
        income: Number.isFinite(income) ? income : 0,
        expense: Number.isFinite(expense)
            ? expense
            : (source?.expense === undefined && Number.isFinite(legacy) ? legacy : 0)
    }
}

function newRow(overrides = {}) {
    return { id: newId(), title: "", income: 0, expense: 0, notes: "", children: [], ...overrides }
}

function newTransaction(overrides = {}) {
    return { id: newId(), date: "", description: "", income: 0, expense: 0, rowId: null, ...overrides }
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
    const { income, expense } = normalizeAmounts(row)
    return {
        id: typeof row?.id === "string" && row.id ? row.id : newId(),
        title: typeof row?.title === "string" ? row.title : "",
        income,
        expense,
        notes: typeof row?.notes === "string" ? row.notes : "",
        children: Array.isArray(row?.children) ? row.children.map(normalizeRow) : []
    }
}

function normalizeTransaction(transaction) {
    const { income, expense } = normalizeAmounts(transaction)
    return {
        id: typeof transaction?.id === "string" && transaction.id ? transaction.id : newId(),
        date: typeof transaction?.date === "string" ? transaction.date : "",
        description: typeof transaction?.description === "string" ? transaction.description : "",
        income,
        expense,
        rowId: typeof transaction?.rowId === "string" && transaction.rowId ? transaction.rowId : null
    }
}

function serializeBudget(budget) {
    return JSON.stringify({ rows: budget.rows, transactions: budget.transactions }, null, 4)
}

/*
 * Resolves each row's effective income and expense according to the configured
 * rollup mode, returning a parallel map of
 * { id -> { income, expense, balance, childrenIncome, childrenExpense, isLeaf, over } }.
 * The mode applies to each of the two amounts independently. Kept separate from
 * the rows themselves so the stored document always holds only what the user
 * actually typed.
 */
function computeTotals(rows, mode) {
    const totals = {}

    function walk(row) {
        const isLeaf = row.children.length === 0
        let childrenIncome = 0
        let childrenExpense = 0
        for (const child of row.children) {
            const resolved = walk(child)
            childrenIncome += resolved.income
            childrenExpense += resolved.expense
        }

        let income
        let expense
        if (isLeaf || mode === "cap") {
            income = row.income
            expense = row.expense
        } else if (mode === "additive") {
            income = row.income + childrenIncome
            expense = row.expense + childrenExpense
        } else {
            income = childrenIncome
            expense = childrenExpense
        }

        totals[row.id] = {
            income,
            expense,
            balance: income - expense,
            childrenIncome,
            childrenExpense,
            isLeaf,
            // Only meaningful in cap mode: children spending past the allocation.
            over: mode === "cap" && !isLeaf && childrenExpense > row.expense
        }
        return { income, expense }
    }

    rows.forEach(walk)
    return totals
}

// The document's bottom line, from the top-level rows' effective totals.
function grandTotals(rows, totals) {
    let income = 0
    let expense = 0
    for (const row of rows) {
        income += totals[row.id]?.income ?? 0
        expense += totals[row.id]?.expense ?? 0
    }
    return { income, expense, balance: income - expense }
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
 * row therefore turns its transactions off-budget rather than making them vanish
 * from the totals, and no cleanup pass over the transactions is needed on delete.
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
 * One month resolved against the budget. On/off budget is a measure of how
 * closely the month followed the plan, not of whether a transaction was filed
 * under a category:
 *
 *   off budget = spending past a category's allocation
 *              + income that fell short of what the category expected
 *              + spending charged to no category at all (no allocation to be
 *                within, so all of it counts as off)
 *   on budget  = spending that stayed inside its allocation
 *              + income received up to what was expected
 *
 * Both are measured at the top-level rows — the categories that carry an
 * allocation. They cover every assigned transaction exactly once whatever depth
 * it was charged at; measuring at every level would count a parent's allocation
 * and its children's twice over.
 *
 * The two figures do not sum to the month's cash flow, and are not meant to: a
 * shortfall is money that never arrived, and income above expectation is a
 * happy deviation that belongs in neither figure. `income`/`spent`/`balance`
 * are the actual cash.
 */
function resolveMonth(rows, transactions, month, totals) {
    const ids = rowIds(rows)
    const monthly = transactionsForMonth(transactions, month)

    const direct = {}
    const unassigned = { income: 0, expense: 0 }
    let income = 0
    let spent = 0
    for (const transaction of monthly) {
        income += transaction.income
        spent += transaction.expense
        if (isOnBudget(transaction, ids)) {
            const own = direct[transaction.rowId] || (direct[transaction.rowId] = { income: 0, expense: 0 })
            own.income += transaction.income
            own.expense += transaction.expense
        } else {
            unassigned.income += transaction.income
            unassigned.expense += transaction.expense
        }
    }

    const actuals = {}
    function rollup(row) {
        const own = direct[row.id] ?? { income: 0, expense: 0 }
        let rowIncome = own.income
        let rowExpense = own.expense
        for (const child of row.children) {
            const resolved = rollup(child)
            rowIncome += resolved.income
            rowExpense += resolved.expense
        }
        actuals[row.id] = { income: rowIncome, expense: rowExpense }
        return { income: rowIncome, expense: rowExpense }
    }
    rows.forEach(rollup)

    const categories = rows.map(row => {
        const budgeted = totals[row.id] ?? { income: 0, expense: 0 }
        const actual = actuals[row.id] ?? { income: 0, expense: 0 }
        return {
            id: row.id,
            title: row.title,
            budgeted,
            actual,
            overspent: Math.max(0, actual.expense - budgeted.expense),
            shortfall: Math.max(0, budgeted.income - actual.income)
        }
    })

    let onBudget = 0
    let offBudget = unassigned.expense
    for (const category of categories) {
        onBudget += Math.min(category.actual.expense, category.budgeted.expense)
        onBudget += Math.min(category.actual.income, category.budgeted.income)
        offBudget += category.overspent + category.shortfall
    }

    return { month, monthly, actuals, categories, unassigned, income, spent, balance: income - spent, onBudget, offBudget }
}

/*
 * The full report for one month: the on/off budget measure above, the cash
 * figures, an itemisation of everything counted as off budget, and each row's
 * budgeted figures beside what actually moved against it.
 *
 * The per-row comparison comes back as two lists, one per amount column, since
 * a row is over budget when it spends more than planned but off plan when it
 * earns less. Both use a `variance` signed so negative always reads as off plan,
 * and a row appears in a list only if it has a figure in that column.
 */
function monthlyReport(rows, transactions, month, mode) {
    const totals = computeTotals(rows, mode)
    const resolved = resolveMonth(rows, transactions, month, totals)

    const flat = []
    function flatten(row, depth) {
        flat.push({
            id: row.id,
            title: row.title,
            depth,
            budgeted: totals[row.id] ?? { income: 0, expense: 0 },
            actual: resolved.actuals[row.id] ?? { income: 0, expense: 0 }
        })
        row.children.forEach(child => flatten(child, depth + 1))
    }
    rows.forEach(row => flatten(row, 0))

    const compare = (column, sign) => flat
        .filter(entry => entry.budgeted[column] !== 0 || entry.actual[column] !== 0)
        .map(entry => {
            const budgeted = entry.budgeted[column]
            const actual = entry.actual[column]
            const variance = sign * (budgeted - actual)
            return { id: entry.id, title: entry.title, depth: entry.depth, budgeted, actual, variance, offPlan: variance < 0 }
        })

    // Every component of the off-budget figure, so it can be audited rather
    // than just read. Unassigned spending closes the list as its own line.
    const offBudgetDetail = resolved.categories
        .filter(category => category.overspent > 0 || category.shortfall > 0)
        .map(category => ({
            id: category.id,
            title: category.title || "Untitled",
            overspent: category.overspent,
            shortfall: category.shortfall,
            total: category.overspent + category.shortfall
        }))
    if (resolved.unassigned.expense > 0) {
        offBudgetDetail.push({
            id: null,
            title: "Unbudgeted spending",
            overspent: resolved.unassigned.expense,
            shortfall: 0,
            total: resolved.unassigned.expense
        })
    }

    return {
        month,
        transactions: resolved.monthly,
        incomeTransactions: resolved.monthly.filter(t => t.income !== 0),
        onBudget: resolved.onBudget,
        offBudget: resolved.offBudget,
        offBudgetDetail,
        unassigned: resolved.unassigned,
        income: resolved.income,
        spent: resolved.spent,
        balance: resolved.balance,
        // Overspending is negative variance; earning less than planned is too.
        perRowExpense: compare("expense", 1),
        perRowIncome: compare("income", -1)
    }
}

// The on/off budget measure, income, spending and balance for `count` months
// ending at (and including) `endMonth`, oldest first. Months with nothing
// recorded are included as zeroes so the series has no gaps.
function monthlyTrend(rows, transactions, endMonth, count, mode) {
    const totals = computeTotals(rows, mode)
    const trend = []
    for (let offset = count - 1; offset >= 0; offset--) {
        const { month, income, spent, balance, onBudget, offBudget } =
            resolveMonth(rows, transactions, shiftMonth(endMonth, -offset), totals)
        trend.push({ month, income, spent, balance, onBudget, offBudget })
    }
    return trend
}

/*
 * The optional columns, in their default order. Title is deliberately absent:
 * it carries the twisty and the indentation, so it is always rendered first and
 * can be neither hidden nor moved. Actions are likewise always last.
 */
const COLUMNS = [
    { key: "income", label: "Income" },
    { key: "expense", label: "Expense" },
    { key: "balance", label: "Balance" },
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
    grandTotals,
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
    monthlyReport,
    monthlyTrend,
    COLUMNS,
    resolveColumns,
    moveColumn,
    parentIds,
    importBudget,
    exportBudget,
    formatAmount
}
