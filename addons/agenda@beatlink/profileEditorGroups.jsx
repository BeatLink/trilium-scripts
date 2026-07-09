import { Button, FormTextBox, useState } from "trilium:preact"

let idCounter = 0
function generateKey() {
    idCounter += 1
    return `item-${Date.now()}-${idCounter}`
}

// Generic add/remove/reorder editor for a `{ [key]: value }` object (the
// shape every group/child collection in a profile uses). Reorder rebuilds
// key insertion order via a fresh object rather than mutating in place.
// Renders as a real <table>. Pass `columns` (an array of
// `{ label, render: (item, update) => node }`) for a fixed-shape item
// (each field gets its own column); omit it and pass `renderItem` instead
// for an item whose shape varies (e.g. a type dropdown that swaps in
// different fields) — that content spans a single wide cell.
export function KeyedList({ items, onChange, newItemFactory, renderItem, columns, addLabel = "Add" }) {
    const keys = Object.keys(items)
    const columnCount = (columns ? columns.length : 1) + 1

    function updateItem(key, newValue) {
        onChange({ ...items, [key]: newValue })
    }

    function removeItem(key) {
        const updated = { ...items }
        delete updated[key]
        onChange(updated)
    }

    function addItem() {
        onChange({ ...items, [generateKey()]: newItemFactory() })
    }

    function moveItem(index, direction) {
        const target = index + direction
        if (target < 0 || target >= keys.length) return
        const newKeys = [...keys]
        ;[newKeys[index], newKeys[target]] = [newKeys[target], newKeys[index]]
        const reordered = {}
        for (const k of newKeys) reordered[k] = items[k]
        onChange(reordered)
    }

    return (
        <table className="pe-table">
            {columns && (
                <thead>
                    <tr>
                        {columns.map(col => <th key={col.label}>{col.label}</th>)}
                        <th></th>
                    </tr>
                </thead>
            )}
            <tbody>
                {keys.length === 0 && (
                    <tr><td className="pe-table-empty" colSpan={columnCount}>No entries yet.</td></tr>
                )}
                {keys.map((key, index) => {
                    const item = items[key]
                    const update = value => updateItem(key, value)
                    return (
                        <tr key={key}>
                            {columns
                                ? columns.map(col => <td key={col.label}>{col.render(item, update)}</td>)
                                : <td>{renderItem(key, item, update)}</td>}
                            <td className="pe-table-actions-cell">
                                <div className="pe-table-actions">
                                    <Button icon="bx-chevron-up" onClick={() => moveItem(index, -1)} disabled={index === 0} />
                                    <Button icon="bx-chevron-down" onClick={() => moveItem(index, 1)} disabled={index === keys.length - 1} />
                                    <Button icon="bx-x" onClick={() => removeItem(key)} />
                                </div>
                            </td>
                        </tr>
                    )
                })}
            </tbody>
            <tfoot>
                <tr><td colSpan={columnCount}><Button icon="bx-plus" text={addLabel} onClick={addItem} /></td></tr>
            </tfoot>
        </table>
    )
}

let rowIdCounter = 0
function nextRowId() {
    rowIdCounter += 1
    return `row-${rowIdCounter}`
}

function objectToRows(obj) {
    return Object.entries(obj || {}).map(([key, value]) => ({ id: nextRowId(), key, value }))
}

// For the one profile shape where the *key* itself is meaningful data (a
// note label value, e.g. "4-critical"), not just opaque bookkeeping — the
// key has to be user-editable text, so KeyedList's generated-key convention
// doesn't fit. Keeps its own local row list (stable ids for reordering/
// editing) and re-derives the `{ [labelValue]: value }` object on every
// change; this component is the sole owner of that object's shape, so
// there's no external-mutation source to stay in sync with.
export function LabelValueMapEditor({ entries, onChange, renderValue, defaultValue }) {
    const [rows, setRows] = useState(() => objectToRows(entries))

    function commit(newRows) {
        setRows(newRows)
        const obj = {}
        for (const row of newRows) {
            if (row.key) obj[row.key] = row.value
        }
        onChange(obj)
    }

    function updateRow(id, patch) {
        commit(rows.map(r => r.id === id ? { ...r, ...patch } : r))
    }

    function removeRow(id) {
        commit(rows.filter(r => r.id !== id))
    }

    function addRow() {
        commit([...rows, { id: nextRowId(), key: "", value: defaultValue }])
    }

    return (
        <div className="pe-list">
            {rows.map(row => (
                <div className="pe-list-item" key={row.id}>
                    <div className="pe-list-item-body">
                        <FormTextBox currentValue={row.key} onChange={v => updateRow(row.id, { key: v })} />
                        {renderValue(row.value, v => updateRow(row.id, { value: v }))}
                    </div>
                    <div className="pe-list-item-controls">
                        <Button icon="bx-x" onClick={() => removeRow(row.id)} />
                    </div>
                </div>
            ))}
            <Button icon="bx-plus" text="Add" onClick={addRow} />
        </div>
    )
}
