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
    parseBudget,
    serializeBudget,
    computeTotals,
    grandTotal,
    updateRow,
    removeRow,
    addRow,
    moveRow,
    formatAmount
} = require("libBudget.js")

function BudgetRow({ row, depth, totals, collapsed, settings, onToggle, onChange, onAdd, onRemove, onMove }) {
    const info = totals[row.id] || { total: 0, isLeaf: true, over: false }
    const hasChildren = row.children.length > 0
    const isCollapsed = collapsed.has(row.id)

    // In computed mode a parent's amount is derived, so its cell is read-only.
    const amountDerived = hasChildren && settings.rollupMode === "computed"

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
                <td className="budget-cell-amount">
                    {amountDerived ? (
                        <span className="budget-derived">{formatAmount(info.total, settings.currency, settings.locale)}</span>
                    ) : (
                        <input
                            type="number"
                            step="0.01"
                            className="budget-input budget-input-amount"
                            value={row.amount}
                            onInput={e => onChange(row.id, { amount: parseFloat(e.target.value) || 0 })}
                        />
                    )}
                </td>
                <td className="budget-cell-total">
                    <span className={info.over ? "budget-total budget-total-over" : "budget-total"}>
                        {formatAmount(info.total, settings.currency, settings.locale)}
                    </span>
                    {settings.rollupMode === "cap" && hasChildren && (
                        <span className="budget-subtotal">
                            {formatAmount(info.childrenTotal, settings.currency, settings.locale)} used
                        </span>
                    )}
                    {settings.rollupMode === "additive" && hasChildren && (
                        <span className="budget-subtotal">
                            incl. {formatAmount(row.amount, settings.currency, settings.locale)} own
                        </span>
                    )}
                </td>
                <td className="budget-cell-notes">
                    <input
                        type="text"
                        className="budget-input budget-input-notes"
                        value={row.notes}
                        placeholder="Notes"
                        onInput={e => onChange(row.id, { notes: e.target.value })}
                    />
                </td>
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
    const [rows, setRows] = useState(null)
    const [collapsed, setCollapsed] = useState(() => new Set())

    useEffect(() => {
        (async () => {
            const schemaNoteId = await currentNote.getRelationValue("schemaNote")
            const settingsNote = await currentNote.getRelationTarget("settingsNote")
            const configNote = await settingsNote.getRelationTarget("AddonData:config")
            setSettings(await loadSettings(schemaNoteId, configNote.noteId))
        })()
    }, [])

    useEffect(() => {
        (async () => {
            if (!noteId || !note) { setRows(null); return }
            const content = (await note.getBlob()).content
            setRows(parseBudget(content).rows)
            setCollapsed(new Set())
        })()
    }, [noteId, note])

    // Single mutation path: apply `mutator` to the current rows, set state, and
    // write the document back to the note's own content.
    const mutate = useCallback(mutator => {
        setRows(current => {
            const next = mutator(current)
            api.runOnBackend(
                (id, content) => api.getNote(id).setContent(content),
                [noteId, serializeBudget({ rows: next })]
            )
            return next
        })
    }, [noteId])

    const onChange = useCallback((id, changes) => mutate(rows => updateRow(rows, id, changes)), [mutate])
    const onRemove = useCallback(id => mutate(rows => removeRow(rows, id)), [mutate])
    const onMove = useCallback((id, delta) => mutate(rows => moveRow(rows, id, delta)), [mutate])

    const onAdd = useCallback(parentId => {
        mutate(rows => addRow(rows, parentId, newRow()))
        // A row added to a collapsed parent would otherwise be invisible.
        if (parentId) setCollapsed(current => {
            const next = new Set(current)
            next.delete(parentId)
            return next
        })
    }, [mutate])

    const onToggle = useCallback(id => {
        setCollapsed(current => {
            const next = new Set(current)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }, [])

    const totals = useMemo(
        () => (rows && settings ? computeTotals(rows, settings.rollupMode) : {}),
        [rows, settings]
    )

    if (!rows || !settings) return <div className="budget-table-widget">Loading...</div>

    return (
        <div className="budget-table-widget">
            <table className="budget-table">
                <thead>
                    <tr>
                        <th className="budget-cell-title">Title</th>
                        <th className="budget-cell-amount">Amount Budgeted</th>
                        <th className="budget-cell-total">Total</th>
                        <th className="budget-cell-notes">Notes</th>
                        <th className="budget-cell-actions" />
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <BudgetRow
                            key={row.id}
                            row={row}
                            depth={0}
                            totals={totals}
                            collapsed={collapsed}
                            settings={settings}
                            onToggle={onToggle}
                            onChange={onChange}
                            onAdd={onAdd}
                            onRemove={onRemove}
                            onMove={onMove}
                        />
                    ))}
                    {rows.length === 0 && (
                        <tr><td colSpan="5" className="budget-empty">No rows yet.</td></tr>
                    )}
                </tbody>
                <tfoot>
                    <tr>
                        <td className="budget-cell-title budget-grand-label">Grand Total</td>
                        <td />
                        <td className="budget-cell-total budget-grand-total">
                            {formatAmount(grandTotal(rows, totals), settings.currency, settings.locale)}
                        </td>
                        <td colSpan="2" />
                    </tr>
                </tfoot>
            </table>
            <Button icon="bx-plus" text="Add Row" onClick={() => onAdd(null)} />
        </div>
    )
}

export default BudgetTable
