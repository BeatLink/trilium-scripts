import {
    useActiveNoteContext,
    useNoteProperty,
    useState,
    useEffect,
    useCallback,
    useMemo,
    Button
} from "trilium:preact"

import { currentNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

const {
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
    resolveColumns,
    parentIds,
    importBudget,
    exportBudget,
    formatAmount
} = require("libBudget.js")

// How many months the report's trend covers, ending at the month being viewed.
const TREND_MONTHS = 6

function BudgetRow({ row, depth, totals, collapsed, settings, columns, onToggle, onChange, onAdd, onRemove, onMove }) {
    const info = totals[row.id] || { income: 0, expense: 0, balance: 0, isLeaf: true, over: false }
    const hasChildren = row.children.length > 0
    const isCollapsed = collapsed.has(row.id)

    // In computed mode a parent's amounts are derived, so its cells are read-only.
    const derived = hasChildren && settings.rollupMode === "computed"
    const money = value => formatAmount(value, settings.currency, settings.locale)

    const amountCell = column => (
        <td className="budget-cell-amount" key={column}>
            {derived ? (
                <span className="budget-derived">{money(info[column])}</span>
            ) : (
                <input
                    type="number"
                    step="0.01"
                    className="budget-input budget-input-amount"
                    value={row[column]}
                    onInput={e => onChange(row.id, { [column]: parseFloat(e.target.value) || 0 })}
                />
            )}
            {settings.rollupMode === "cap" && hasChildren && (
                <span className="budget-subtotal">
                    {money(column === "income" ? info.childrenIncome : info.childrenExpense)} used
                </span>
            )}
            {settings.rollupMode === "additive" && hasChildren && (
                <span className="budget-subtotal">incl. {money(row[column])} own</span>
            )}
        </td>
    )

    return (
        <>
            <tr className={info.over ? "budget-row budget-row-over" : "budget-row"}>
                <td className="budget-cell-title">
                    <div className="budget-title-inner" style={{ paddingLeft: `${depth * 20}px` }}>
                        <button
                            className={hasChildren ? "budget-twisty" : "budget-twisty budget-twisty-empty"}
                            onClick={() => onToggle(row.id)}
                            disabled={!hasChildren}
                            title={hasChildren ? (isCollapsed ? "Expand" : "Collapse") : ""}
                        >
                            <span className={hasChildren ? (isCollapsed ? "bx bx-chevron-right" : "bx bx-chevron-down") : "bx"} />
                        </button>
                        <input
                            type="text"
                            className="budget-input budget-input-title"
                            value={row.title}
                            placeholder="Untitled"
                            onInput={e => onChange(row.id, { title: e.target.value })}
                        />
                    </div>
                </td>
                {columns.map(column => {
                    if (column.key === "income" || column.key === "expense") return amountCell(column.key)
                    if (column.key === "balance") return (
                        <td className="budget-cell-balance" key={column.key}>
                            <span className={info.balance < 0 ? "budget-total budget-net-negative" : "budget-total"}>
                                {money(info.balance)}
                            </span>
                        </td>
                    )
                    return (
                        <td className="budget-cell-notes" key={column.key}>
                            <input
                                type="text"
                                className="budget-input budget-input-notes"
                                value={row.notes}
                                placeholder="Notes"
                                onInput={e => onChange(row.id, { notes: e.target.value })}
                            />
                        </td>
                    )
                })}
                <td className="budget-cell-actions">
                    <button className="budget-action bx bx-subdirectory-right" title="Add child row" onClick={() => onAdd(row.id)} />
                    <button className="budget-action bx bx-up-arrow-alt" title="Move up" onClick={() => onMove(row.id, -1)} />
                    <button className="budget-action bx bx-down-arrow-alt" title="Move down" onClick={() => onMove(row.id, 1)} />
                    <button className="budget-action budget-action-remove bx bx-trash" title="Remove row" onClick={() => onRemove(row.id)} />
                </td>
            </tr>
            {!isCollapsed && row.children.map(child => (
                <BudgetRow
                    key={child.id}
                    row={child}
                    depth={depth + 1}
                    totals={totals}
                    collapsed={collapsed}
                    settings={settings}
                    columns={columns}
                    onToggle={onToggle}
                    onChange={onChange}
                    onAdd={onAdd}
                    onRemove={onRemove}
                    onMove={onMove}
                />
            ))}
        </>
    )
}

// Shared by the Transactions and Report tabs, which always show the same month.
function MonthNav({ month, settings, onChange }) {
    return (
        <div className="budget-month-nav">
            <button
                className="budget-month-step bx bx-chevron-left"
                title="Previous month"
                onClick={() => onChange(shiftMonth(month, -1))}
            />
            <span className="budget-month-label">{formatMonth(month, settings.locale)}</span>
            <button
                className="budget-month-step bx bx-chevron-right"
                title="Next month"
                onClick={() => onChange(shiftMonth(month, 1))}
            />
            <input
                type="month"
                className="budget-month-input"
                value={month}
                onChange={e => e.target.value && onChange(e.target.value)}
            />
            <button className="budget-month-today" onClick={() => onChange(currentMonth())}>
                This month
            </button>
        </div>
    )
}

function TransactionsTab({ doc, month, settings, onMonth, onChange, onRemove, onAdd }) {
    // Sorted for reading rather than in storage, so the document keeps the
    // order things were entered in and a re-dated transaction just moves.
    const monthly = useMemo(
        () => [...transactionsForMonth(doc.transactions, month)].sort((a, b) => a.date.localeCompare(b.date)),
        [doc.transactions, month]
    )
    const options = useMemo(() => rowOptions(doc.rows), [doc.rows])
    const money = value => formatAmount(value, settings.currency, settings.locale)
    const income = monthly.reduce((sum, t) => sum + t.income, 0)
    const spent = monthly.reduce((sum, t) => sum + t.expense, 0)

    return (
        <>
            <MonthNav month={month} settings={settings} onChange={onMonth} />
            <table className="budget-table">
                <thead>
                    <tr>
                        <th className="budget-cell-date">Date</th>
                        <th>Description</th>
                        <th className="budget-cell-amount">Income</th>
                        <th className="budget-cell-amount">Expense</th>
                        <th className="budget-cell-balance">Balance</th>
                        <th className="budget-cell-row">Budget Row</th>
                        <th className="budget-cell-actions" />
                    </tr>
                </thead>
                <tbody>
                    {monthly.map(transaction => {
                        // A row deleted since the transaction was recorded leaves a
                        // dangling id; the select falls back to unassigned, which is
                        // exactly how the report counts it.
                        const known = options.some(option => option.id === transaction.rowId)
                        const balance = transaction.income - transaction.expense
                        return (
                            <tr className="budget-row" key={transaction.id}>
                                <td className="budget-cell-date">
                                    <input
                                        type="date"
                                        className="budget-input"
                                        value={transaction.date}
                                        // Committed values only, and never blank: an empty date
                                        // would drop the transaction out of every month's view.
                                        onChange={e => onChange(transaction.id, { date: e.target.value || transaction.date })}
                                    />
                                </td>
                                <td>
                                    <input
                                        type="text"
                                        className="budget-input"
                                        value={transaction.description}
                                        placeholder="Description"
                                        onInput={e => onChange(transaction.id, { description: e.target.value })}
                                    />
                                </td>
                                {["income", "expense"].map(column => (
                                    <td className="budget-cell-amount" key={column}>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="budget-input budget-input-amount"
                                            value={transaction[column]}
                                            onInput={e => onChange(transaction.id, { [column]: parseFloat(e.target.value) || 0 })}
                                        />
                                    </td>
                                ))}
                                <td className="budget-cell-balance">
                                    <span className={balance < 0 ? "budget-total budget-net-negative" : "budget-total"}>
                                        {money(balance)}
                                    </span>
                                </td>
                                <td className="budget-cell-row">
                                    <select
                                        className={known ? "budget-input budget-row-select" : "budget-input budget-row-select budget-off"}
                                        value={known ? transaction.rowId : ""}
                                        onChange={e => onChange(transaction.id, { rowId: e.target.value || null })}
                                    >
                                        <option value="">-- unbudgeted --</option>
                                        {options.map(option => (
                                            <option value={option.id} key={option.id}>{option.label}</option>
                                        ))}
                                    </select>
                                </td>
                                <td className="budget-cell-actions">
                                    <button
                                        className="budget-action budget-action-remove bx bx-trash"
                                        title="Remove transaction"
                                        onClick={() => onRemove(transaction.id)}
                                    />
                                </td>
                            </tr>
                        )
                    })}
                    {monthly.length === 0 && (
                        <tr><td colSpan={7} className="budget-empty">Nothing recorded this month.</td></tr>
                    )}
                </tbody>
                <tfoot>
                    <tr>
                        <td className="budget-grand-label" colSpan={2}>Month Total</td>
                        <td className="budget-cell-amount budget-grand-total budget-income-text">{money(income)}</td>
                        <td className="budget-cell-amount budget-grand-total">{money(spent)}</td>
                        <td className={income - spent < 0
                            ? "budget-cell-balance budget-grand-total budget-net-negative"
                            : "budget-cell-balance budget-grand-total"}>
                            {money(income - spent)}
                        </td>
                        <td colSpan={2} />
                    </tr>
                </tfoot>
            </table>
            <div className="budget-toolbar">
                <Button icon="bx-plus" text="Add Transaction" onClick={onAdd} />
            </div>
        </>
    )
}

// The month's plan adherence as one proportional bar. A month with nothing to
// measure renders an empty track rather than dividing by zero.
function SplitBar({ onBudget, offBudget }) {
    const total = onBudget + offBudget
    const share = value => (total > 0 ? `${(value / total) * 100}%` : "0%")
    return (
        <div className="budget-split-bar">
            <div className="budget-split-on" style={{ width: share(onBudget) }} />
            <div className="budget-split-off" style={{ width: share(offBudget) }} />
        </div>
    )
}

// Budgeted vs actual for one amount column. Variance is signed so that negative
// always means off plan: overspent for expenses, short for income.
function VarianceTable({ entries, money, emptyText }) {
    return (
        <table className="budget-table">
            <thead>
                <tr>
                    <th className="budget-cell-title">Row</th>
                    <th className="budget-cell-amount">Budgeted</th>
                    <th className="budget-cell-amount">Actual</th>
                    <th className="budget-cell-amount">Variance</th>
                </tr>
            </thead>
            <tbody>
                {entries.map(entry => (
                    <tr className={entry.offPlan ? "budget-row budget-row-over" : "budget-row"} key={entry.id}>
                        <td className="budget-cell-title">
                            <span style={{ paddingLeft: `${entry.depth * 20}px` }}>{entry.title || "Untitled"}</span>
                        </td>
                        <td className="budget-cell-amount">{money(entry.budgeted)}</td>
                        <td className="budget-cell-amount">{money(entry.actual)}</td>
                        <td className={entry.offPlan ? "budget-cell-amount budget-total-over" : "budget-cell-amount"}>
                            {money(entry.variance)}
                        </td>
                    </tr>
                ))}
                {entries.length === 0 && (
                    <tr><td colSpan={4} className="budget-empty">{emptyText}</td></tr>
                )}
            </tbody>
        </table>
    )
}

function ReportTab({ doc, month, settings, onMonth }) {
    const report = useMemo(
        () => monthlyReport(doc.rows, doc.transactions, month, settings.rollupMode),
        [doc, month, settings.rollupMode]
    )
    const trend = useMemo(
        () => monthlyTrend(doc.rows, doc.transactions, month, TREND_MONTHS, settings.rollupMode),
        [doc, month, settings.rollupMode]
    )
    const trendPeak = Math.max(...trend.map(entry => entry.onBudget + entry.offBudget), 0)
    const measured = report.onBudget + report.offBudget
    const percent = value => (measured > 0 ? `${Math.round((value / measured) * 100)}%` : "-")
    const money = value => formatAmount(value, settings.currency, settings.locale)

    return (
        <>
            <MonthNav month={month} settings={settings} onChange={onMonth} />

            <div className="budget-summary">
                <div className="budget-summary-card">
                    <span className="budget-summary-label">On budget</span>
                    <span className="budget-summary-value budget-on-text">{money(report.onBudget)}</span>
                    <span className="budget-summary-share">{percent(report.onBudget)} — went to plan</span>
                </div>
                <div className="budget-summary-card">
                    <span className="budget-summary-label">Off budget</span>
                    <span className="budget-summary-value budget-off-text">{money(report.offBudget)}</span>
                    <span className="budget-summary-share">{percent(report.offBudget)} — over or short</span>
                </div>
                <div className="budget-summary-card">
                    <span className="budget-summary-label">Income</span>
                    <span className="budget-summary-value budget-income-text">{money(report.income)}</span>
                    <span className="budget-summary-share">
                        {report.incomeTransactions.length} entr{report.incomeTransactions.length === 1 ? "y" : "ies"}
                    </span>
                </div>
                <div className="budget-summary-card">
                    <span className="budget-summary-label">Spent</span>
                    <span className="budget-summary-value">{money(report.spent)}</span>
                    <span className="budget-summary-share">
                        {report.transactions.length} record{report.transactions.length === 1 ? "" : "s"}
                    </span>
                </div>
                <div className="budget-summary-card">
                    <span className="budget-summary-label">Balance</span>
                    <span className={report.balance < 0 ? "budget-summary-value budget-net-negative" : "budget-summary-value"}>
                        {money(report.balance)}
                    </span>
                    <span className="budget-summary-share">income minus spending</span>
                </div>
            </div>
            <SplitBar onBudget={report.onBudget} offBudget={report.offBudget} />

            <h4 className="budget-report-heading">What went off budget</h4>
            <table className="budget-table">
                <thead>
                    <tr>
                        <th className="budget-cell-title">Category</th>
                        <th className="budget-cell-amount">Overspent</th>
                        <th className="budget-cell-amount">Income short</th>
                        <th className="budget-cell-amount">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {report.offBudgetDetail.map(entry => (
                        <tr className="budget-row" key={entry.id ?? "unbudgeted"}>
                            <td className="budget-cell-title">{entry.title}</td>
                            <td className="budget-cell-amount">{entry.overspent > 0 ? money(entry.overspent) : ""}</td>
                            <td className="budget-cell-amount">{entry.shortfall > 0 ? money(entry.shortfall) : ""}</td>
                            <td className="budget-cell-amount budget-total-over">{money(entry.total)}</td>
                        </tr>
                    ))}
                    {report.offBudgetDetail.length === 0 && (
                        <tr><td colSpan={4} className="budget-empty">Everything this month went to plan.</td></tr>
                    )}
                </tbody>
            </table>

            <h4 className="budget-report-heading">Expenses: budgeted vs actual</h4>
            <VarianceTable entries={report.perRowExpense} money={money} emptyText="No expense rows yet." />

            <h4 className="budget-report-heading">Income: budgeted vs actual</h4>
            <VarianceTable entries={report.perRowIncome} money={money} emptyText="No income rows yet." />

            <h4 className="budget-report-heading">Income this month</h4>
            <table className="budget-table">
                <thead>
                    <tr>
                        <th className="budget-cell-date">Date</th>
                        <th>Description</th>
                        <th className="budget-cell-amount">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {[...report.incomeTransactions]
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map(transaction => (
                            <tr className="budget-row" key={transaction.id}>
                                <td className="budget-cell-date">{formatDate(transaction.date, settings.locale)}</td>
                                <td>{transaction.description || "Untitled"}</td>
                                <td className="budget-cell-amount budget-income-text">{money(transaction.income)}</td>
                            </tr>
                        ))}
                    {report.incomeTransactions.length === 0 && (
                        <tr><td colSpan={3} className="budget-empty">No income recorded this month.</td></tr>
                    )}
                </tbody>
            </table>

            <h4 className="budget-report-heading">Last {TREND_MONTHS} months</h4>
            <table className="budget-table budget-trend">
                <thead>
                    <tr>
                        <th>Month</th>
                        <th className="budget-cell-trend">On / off budget</th>
                        <th className="budget-cell-amount">On budget</th>
                        <th className="budget-cell-amount">Off budget</th>
                        <th className="budget-cell-amount">Income</th>
                        <th className="budget-cell-amount">Spent</th>
                        <th className="budget-cell-amount">Balance</th>
                    </tr>
                </thead>
                <tbody>
                    {trend.map(entry => {
                        const total = entry.onBudget + entry.offBudget
                        return (
                            <tr className="budget-row" key={entry.month}>
                                <td>
                                    <button className="budget-trend-month" onClick={() => onMonth(entry.month)}>
                                        {formatMonth(entry.month, settings.locale)}
                                    </button>
                                </td>
                                <td className="budget-cell-trend">
                                    {/* Bars are scaled against the busiest month in the window, so
                                        the series is comparable month to month rather than each
                                        row filling its own width. */}
                                    <div
                                        className="budget-split-bar budget-split-bar-trend"
                                        style={{ width: trendPeak > 0 ? `${(total / trendPeak) * 100}%` : "0%" }}
                                    >
                                        <div
                                            className="budget-split-on"
                                            style={{ width: total > 0 ? `${(entry.onBudget / total) * 100}%` : "0%" }}
                                        />
                                        <div
                                            className="budget-split-off"
                                            style={{ width: total > 0 ? `${(entry.offBudget / total) * 100}%` : "0%" }}
                                        />
                                    </div>
                                </td>
                                <td className="budget-cell-amount budget-on-text">{money(entry.onBudget)}</td>
                                <td className="budget-cell-amount budget-off-text">{money(entry.offBudget)}</td>
                                <td className="budget-cell-amount budget-income-text">{money(entry.income)}</td>
                                <td className="budget-cell-amount">{money(entry.spent)}</td>
                                <td className={entry.balance < 0 ? "budget-cell-amount budget-net-negative" : "budget-cell-amount"}>
                                    {money(entry.balance)}
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </>
    )
}

/*
 * Rendered as the whole body of any note using the Budget template, which
 * carries `~renderNote` pointing here (template attributes are inherited by
 * instances unconditionally). The note being viewed IS the budget note;
 * `api.currentNote` stays this JSX note, so the addon's own schema/settings
 * relations still resolve off it.
 */
function BudgetTable() {
    const { note } = useActiveNoteContext()
    const noteId = useNoteProperty(note, "noteId")

    const [settings, setSettings] = useState(null)
    const [doc, setDoc] = useState(null)
    const [collapsed, setCollapsed] = useState(() => new Set())
    const [tab, setTab] = useState("budget")
    const [month, setMonth] = useState(() => currentMonth())

    useEffect(() => {
        (async () => {
            const schemaNoteId = await currentNote.getRelationValue("schemaNote")
            const settingsNote = await currentNote.getRelationTarget("settingsNote")
            const configNote = await settingsNote.getRelationTarget("configNote")
            setSettings(await loadSettings(schemaNoteId, configNote.noteId))
        })()
    }, [])

    useEffect(() => {
        (async () => {
            if (!noteId || !note) { setDoc(null); return }
            const content = (await note.getBlob()).content
            setDoc(parseBudget(content))
            setCollapsed(new Set())
        })()
    }, [noteId, note])

    // Single mutation path: apply `mutator` to the current document, set state,
    // and write it back to the note's own content.
    const mutate = useCallback(mutator => {
        setDoc(current => {
            const next = mutator(current)
            api.runOnBackend(
                (id, content) => api.getNote(id).setContent(content),
                [noteId, serializeBudget(next)]
            )
            return next
        })
    }, [noteId])

    const onChange = useCallback((id, changes) => mutate(doc => ({ ...doc, rows: updateRow(doc.rows, id, changes) })), [mutate])
    const onRemove = useCallback(id => mutate(doc => ({ ...doc, rows: removeRow(doc.rows, id) })), [mutate])
    const onMove = useCallback((id, delta) => mutate(doc => ({ ...doc, rows: moveRow(doc.rows, id, delta) })), [mutate])

    const onAdd = useCallback(parentId => {
        mutate(doc => ({ ...doc, rows: addRow(doc.rows, parentId, newRow()) }))
        // A row added to a collapsed parent would otherwise be invisible.
        if (parentId) setCollapsed(current => {
            const next = new Set(current)
            next.delete(parentId)
            return next
        })
    }, [mutate])

    const onTransactionChange = useCallback(
        (id, changes) => mutate(doc => ({ ...doc, transactions: updateTransaction(doc.transactions, id, changes) })),
        [mutate]
    )
    const onTransactionRemove = useCallback(
        id => mutate(doc => ({ ...doc, transactions: removeTransaction(doc.transactions, id) })),
        [mutate]
    )
    // New entries land in the month being viewed — today if that's the current
    // month, else the 1st, so they never file themselves into a month you can't
    // see.
    const onTransactionAdd = useCallback(() => {
        const date = monthOf(currentDate()) === month ? currentDate() : `${month}-01`
        mutate(doc => ({ ...doc, transactions: addTransaction(doc.transactions, newTransaction({ date })) }))
    }, [mutate, month])

    // Downloads the note's document as a .json file named after the note.
    const onExport = useCallback(() => {
        const blob = new Blob([exportBudget(doc)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `${note?.title || "budget"}.json`
        link.click()
        URL.revokeObjectURL(url)
    }, [doc, note])

    // Replaces the whole document, so a non-empty budget confirms first.
    const onImport = useCallback(() => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = "application/json,.json"
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            let imported
            try {
                imported = importBudget(await file.text())
            } catch (e) {
                api.showError(`Could not import budget: ${e.message}`)
                return
            }
            if ((doc.rows.length > 0 || doc.transactions.length > 0) && !await api.showConfirmDialog(
                `Replace all ${doc.rows.length} top-level row(s) and ${doc.transactions.length} transaction(s) `
                + `with ${imported.rows.length} imported row(s) and ${imported.transactions.length} transaction(s)? `
                + `This cannot be undone.`
            )) return
            mutate(() => imported)
            setCollapsed(new Set())
            api.showMessage(`Imported ${imported.rows.length} top-level row(s) and ${imported.transactions.length} transaction(s).`)
        }
        input.click()
    }, [doc, mutate])

    const parents = useMemo(() => (doc ? parentIds(doc.rows) : []), [doc])

    const onExpandAll = useCallback(() => setCollapsed(new Set()), [])
    const onCollapseAll = useCallback(() => setCollapsed(new Set(parents)), [parents])

    const onToggle = useCallback(id => {
        setCollapsed(current => {
            const next = new Set(current)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }, [])

    const totals = useMemo(
        () => (doc && settings ? computeTotals(doc.rows, settings.rollupMode) : {}),
        [doc, settings]
    )

    // Only the visible columns are rendered; order follows the stored config.
    const columns = useMemo(
        () => resolveColumns(settings?.columns).filter(c => c.visible),
        [settings]
    )

    if (!doc || !settings) return <div className="budget-table-widget">Loading...</div>

    const tabs = [
        { key: "budget", label: "Budget" },
        { key: "transactions", label: "Transactions" },
        { key: "report", label: "Report" }
    ]

    const planned = grandTotals(doc.rows, totals)
    const money = value => formatAmount(value, settings.currency, settings.locale)

    /* Each figure lands under its own column; a column that's been hidden takes
       its figure with it, and the label spans whatever is left. */
    const footerCell = column => {
        if (column.key === "income") return <td className="budget-cell-amount budget-grand-total budget-income-text" key={column.key}>{money(planned.income)}</td>
        if (column.key === "expense") return <td className="budget-cell-amount budget-grand-total" key={column.key}>{money(planned.expense)}</td>
        if (column.key === "balance") return (
            <td className={planned.balance < 0
                ? "budget-cell-balance budget-grand-total budget-net-negative"
                : "budget-cell-balance budget-grand-total"} key={column.key}>
                {money(planned.balance)}
            </td>
        )
        return <td key={column.key} />
    }

    return (
        <div className="budget-table-widget">
            <div className="budget-tabs">
                {tabs.map(entry => (
                    <button
                        className={tab === entry.key ? "budget-tab budget-tab-active" : "budget-tab"}
                        key={entry.key}
                        onClick={() => setTab(entry.key)}
                    >
                        {entry.label}
                    </button>
                ))}
            </div>

            {tab === "budget" && (
                <>
                    <table className="budget-table">
                        <thead>
                            <tr>
                                <th className="budget-cell-title">Title</th>
                                {columns.map(column => (
                                    <th className={`budget-cell-${column.key}`} key={column.key}>{column.label}</th>
                                ))}
                                <th className="budget-cell-actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {doc.rows.map(row => (
                                <BudgetRow
                                    key={row.id}
                                    row={row}
                                    depth={0}
                                    totals={totals}
                                    collapsed={collapsed}
                                    settings={settings}
                                    columns={columns}
                                    onToggle={onToggle}
                                    onChange={onChange}
                                    onAdd={onAdd}
                                    onRemove={onRemove}
                                    onMove={onMove}
                                />
                            ))}
                            {doc.rows.length === 0 && (
                                <tr><td colSpan={columns.length + 2} className="budget-empty">No rows yet.</td></tr>
                            )}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td className="budget-cell-title budget-grand-label">Budget Total</td>
                                {columns.map(footerCell)}
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                    <div className="budget-toolbar">
                        <Button icon="bx-plus" text="Add Row" onClick={() => onAdd(null)} />
                        <Button
                            icon="bx-expand-vertical"
                            text="Expand All"
                            onClick={onExpandAll}
                            disabled={collapsed.size === 0}
                        />
                        <Button
                            icon="bx-collapse-vertical"
                            text="Collapse All"
                            onClick={onCollapseAll}
                            disabled={collapsed.size === parents.length}
                        />
                        <Button icon="bx-import" text="Import JSON" onClick={onImport} />
                        <Button icon="bx-export" text="Export JSON" onClick={onExport} />
                    </div>
                </>
            )}

            {tab === "transactions" && (
                <TransactionsTab
                    doc={doc}
                    month={month}
                    settings={settings}
                    onMonth={setMonth}
                    onChange={onTransactionChange}
                    onRemove={onTransactionRemove}
                    onAdd={onTransactionAdd}
                />
            )}

            {tab === "report" && (
                <ReportTab doc={doc} month={month} settings={settings} onMonth={setMonth} />
            )}
        </div>
    )
}

export default BudgetTable
