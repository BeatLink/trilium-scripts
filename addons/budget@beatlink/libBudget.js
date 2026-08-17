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
 * The rows an on/off budget measure may compare against, each paired with the
 * allocation that is genuinely its own and the actual that belongs to it.
 * Nothing here may overlap: a budget counted at both a parent and its children
 * would report one overrun twice, and a tree with a single root would report
 * every figure in it two or three times over.
 *
 * Which rows own an allocation depends on the rollup mode:
 *
 *   computed   A parent's budget is only the sum of its children's, so the
 *              parent owns nothing and every leaf owns what it was typed.
 *   own+child  Every row owns what it was typed; a parent's children are extra
 *              on top, so parent and child never share an amount.
 *   cap        A parent's amount is the allocation everything beneath it draws
 *              on, so it is measured against its whole subtree's actual and its
 *              descendants are not measured separately at all.
 *
 * In every mode the actual is what was charged to that row directly, except a
 * cap, which takes its subtree's — matching the allocation it is compared to.
 */
function measurableRows(rows, mode, direct, rolled) {
    const measurable = []
    // An allocation below zero is not a limit anything can be within — it would
    // make the on-budget figure negative — so a row typed that way is read as
    // having no allocation at all.
    const allocation = row => ({ income: Math.max(0, row.income), expense: Math.max(0, row.expense) })
    function walk(row, path) {
        const label = path ? `${path} / ${row.title || "Untitled"}` : (row.title || "Untitled")
        const hasChildren = row.children.length > 0
        if (mode === "cap" && hasChildren) {
            measurable.push({
                id: row.id,
                label,
                budgeted: allocation(row),
                actual: rolled[row.id] ?? { income: 0, expense: 0 }
            })
            return
        }
        measurable.push({
            id: row.id,
            label,
            budgeted: (mode === "computed" && hasChildren)
                ? { income: 0, expense: 0 }
                : allocation(row),
            actual: direct[row.id] ?? { income: 0, expense: 0 }
        })
        row.children.forEach(child => walk(child, label))
    }
    rows.forEach(row => walk(row, ""))
    return measurable
}

/*
 * One month resolved against the budget. On/off budget is a measure of how
 * closely the month followed the plan, not of whether a transaction was filed
 * under a category:
 *
 *   on budget  = every amount that stayed within the limits of the record it
 *                was charged to — spending inside its allocation, and income
 *                received up to what that record expected
 *   off budget = the variances that broke those limits — spending past an
 *                allocation, income short of expectation, and income beyond it —
 *                plus anything charged to no record at all, which had no limit
 *                to be within
 *
 * Measured record by record over `measurableRows` above, so a figure is
 * compared against the allocation that actually governs it and no allocation is
 * counted twice. Reported per column: see the note on the return value for why
 * spending partitions exactly and income cannot.
 */
function resolveMonth(rows, transactions, month, totals, mode) {
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

    const measured = measurableRows(rows, mode, direct, actuals).map(entry => ({
        ...entry,
        withinExpense: Math.min(entry.actual.expense, entry.budgeted.expense),
        withinIncome: Math.min(entry.actual.income, entry.budgeted.income),
        overspent: Math.max(0, entry.actual.expense - entry.budgeted.expense),
        shortfall: Math.max(0, entry.budgeted.income - entry.actual.income),
        surplus: Math.max(0, entry.actual.income - entry.budgeted.income)
    }))

    const sum = key => measured.reduce((total, entry) => total + entry[key], 0)
    const overspent = sum("overspent")
    const shortfall = sum("shortfall")
    const surplus = sum("surplus")

    return {
        month,
        monthly,
        actuals,
        measured,
        unassigned,
        income,
        spent,
        balance: income - spent,
        overspent,
        shortfall,
        surplus,
        /*
         * On and off budget are kept per column rather than as one combined
         * figure, since adding money in to money out gives a number that means
         * nothing on its own.
         *
         * Spending is a true partition — on plus off is exactly what was spent.
         * Income is not, and can't be: a shortfall is money that never arrived,
         * so it sits in the off-budget figure without ever having been cash.
         * On plus off minus the shortfall is what actually came in.
         */
        onBudgetExpense: sum("withinExpense"),
        offBudgetExpense: overspent + unassigned.expense,
        onBudgetIncome: sum("withinIncome"),
        offBudgetIncome: surplus + shortfall + unassigned.income
    }
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
    const resolved = resolveMonth(rows, transactions, month, totals, mode)

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
    // than just read: the column adds back up to it exactly. Rows are labelled
    // by full path, since an overrun usually sits on a leaf whose title alone
    // ("Bills") wouldn't say which one.
    const offBudgetDetail = resolved.measured
        .filter(entry => entry.overspent > 0 || entry.shortfall > 0 || entry.surplus > 0)
        .map(entry => ({
            id: entry.id,
            title: entry.label,
            overspent: entry.overspent,
            shortfall: entry.shortfall,
            surplus: entry.surplus,
            total: entry.overspent + entry.shortfall + entry.surplus
        }))
    if (resolved.unassigned.expense > 0) {
        offBudgetDetail.push({
            id: "unbudgeted-expense",
            title: "Unbudgeted spending",
            overspent: resolved.unassigned.expense,
            shortfall: 0,
            surplus: 0,
            total: resolved.unassigned.expense
        })
    }
    if (resolved.unassigned.income > 0) {
        offBudgetDetail.push({
            id: "unbudgeted-income",
            title: "Unbudgeted income",
            overspent: 0,
            shortfall: 0,
            surplus: resolved.unassigned.income,
            total: resolved.unassigned.income
        })
    }

    return {
        month,
        transactions: resolved.monthly,
        incomeTransactions: resolved.monthly.filter(t => t.income !== 0),
        offBudgetDetail,
        onBudgetExpense: resolved.onBudgetExpense,
        offBudgetExpense: resolved.offBudgetExpense,
        onBudgetIncome: resolved.onBudgetIncome,
        offBudgetIncome: resolved.offBudgetIncome,
        overspent: resolved.overspent,
        shortfall: resolved.shortfall,
        surplus: resolved.surplus,
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
// ending at (and including) `endMonth`, oldest first. `onBudget`/`offBudget`
// here are the spending split — the one that partitions its column exactly, and
// so the one a bar can be drawn from. Months with nothing
// recorded are included as zeroes so the series has no gaps.
function monthlyTrend(rows, transactions, endMonth, count, mode) {
    const totals = computeTotals(rows, mode)
    const trend = []
    for (let offset = count - 1; offset >= 0; offset--) {
        const resolved = resolveMonth(rows, transactions, shiftMonth(endMonth, -offset), totals, mode)
        const { month, income, spent, balance } = resolved
        trend.push({
            month,
            income,
            spent,
            balance,
            onBudget: resolved.onBudgetExpense,
            offBudget: resolved.offBudgetExpense
        })
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

/*
 * Amounts are held and shown to a configurable number of decimal places, 2 by
 * default. Intl caps fraction digits at 20 and rejects a negative, so an
 * out-of-range setting is clamped rather than thrown on — a settings field is
 * free text as far as this is concerned.
 */
function resolveDecimals(decimals) {
    const places = Math.floor(Number(decimals))
    return Number.isFinite(places) ? Math.min(Math.max(places, 0), 20) : 2
}

// Trims a typed amount to the configured precision, via a scaled integer so it
// comes back as a number rather than toFixed's string. Rounding is only ever as
// good as the double it's handed: 1.005 is really 1.00499…, so it trims to 1.00
// exactly as toFixed would.
function roundAmount(value, decimals) {
    const places = resolveDecimals(decimals)
    const scale = 10 ** places
    return Math.round((Number(value) || 0) * scale) / scale
}

// The step a number input should advance by at the configured precision.
function amountStep(decimals) {
    const places = resolveDecimals(decimals)
    return places === 0 ? "1" : `0.${"0".repeat(places - 1)}1`
}

function formatAmount(value, currency, locale, decimals) {
    const places = resolveDecimals(decimals)
    return new Intl.NumberFormat(locale || undefined, {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: places,
        maximumFractionDigits: places
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
    formatAmount,
    roundAmount,
    amountStep
}
