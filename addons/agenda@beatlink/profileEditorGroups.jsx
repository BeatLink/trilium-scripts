import { Button, FormTextBox, useState, useEffect } from "trilium:preact"

let idCounter = 0
function generateKey() {
    idCounter += 1
    return `item-${Date.now()}-${idCounter}`
}

// Generic add/remove/reorder editor for a `{ [key]: value }` object (the
// shape every group/child collection in a profile uses). Reorder rebuilds
// key insertion order via a fresh object rather than mutating in place.
export function KeyedList({ items, onChange, newItemFactory, renderItem, addLabel = "Add" }) {
    const keys = Object.keys(items)

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
        <div className="pe-list">
            {keys.length === 0 && <p className="pe-list-empty">No entries yet.</p>}
            {keys.map((key, index) => (
                <div className="pe-list-item" key={key}>
                    <div className="pe-list-item-body">
                        {renderItem(key, items[key], value => updateItem(key, value))}
                    </div>
                    <div className="pe-list-item-controls">
                        <Button icon="bx-chevron-up" onClick={() => moveItem(index, -1)} disabled={index === 0} />
                        <Button icon="bx-chevron-down" onClick={() => moveItem(index, 1)} disabled={index === keys.length - 1} />
                        <Button icon="bx-x" onClick={() => removeItem(key)} />
                    </div>
                </div>
            ))}
            <Button icon="bx-plus" text={addLabel} onClick={addItem} />
        </div>
    )
}

// Same add/remove/reorder contract as KeyedList, but only one item is
// rendered at a time — picked via a tab bar — instead of every item
// stacked and expanded at once. Meant for collections whose items are big
// enough (a full element definition) that showing all of them together is
// more scrolling than browsing.
export function TabbedKeyedList({ items, onChange, newItemFactory, renderItem, addLabel = "Add", nameOf = item => item.name }) {
    const keys = Object.keys(items)
    const [activeKey, setActiveKey] = useState(keys[0] ?? null)

    useEffect(() => {
        if (activeKey === null || !keys.includes(activeKey)) {
            setActiveKey(keys[0] ?? null)
        }
    }, [items])

    function updateItem(key, newValue) {
        onChange({ ...items, [key]: newValue })
    }

    function removeItem(key) {
        const updated = { ...items }
        delete updated[key]
        onChange(updated)
    }

    function addItem() {
        const key = generateKey()
        onChange({ ...items, [key]: newItemFactory() })
        setActiveKey(key)
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

    const activeIndex = keys.indexOf(activeKey)

    return (
        <div className="pe-tabbed">
            <div className="pe-tabbed-tabs">
                {keys.map((key, index) => (
                    <button
                        type="button"
                        key={key}
                        className={`pe-tab${key === activeKey ? " pe-tab-active" : ""}`}
                        onClick={() => setActiveKey(key)}
                    >
                        {nameOf(items[key]) || `Item ${index + 1}`}
                    </button>
                ))}
                <Button icon="bx-plus" text={addLabel} onClick={addItem} />
            </div>
            {keys.length === 0 && <p className="pe-list-empty">No entries yet.</p>}
            {activeKey !== null && items[activeKey] && (
                <div className="pe-tabbed-panel">
                    <div className="pe-tabbed-panel-body">
                        {renderItem(activeKey, items[activeKey], value => updateItem(activeKey, value))}
                    </div>
                    <div className="pe-tabbed-panel-controls">
                        <Button icon="bx-chevron-left" onClick={() => moveItem(activeIndex, -1)} disabled={activeIndex <= 0} />
                        <Button icon="bx-chevron-right" onClick={() => moveItem(activeIndex, 1)} disabled={activeIndex === -1 || activeIndex === keys.length - 1} />
                        <Button icon="bx-x" text="Remove" onClick={() => removeItem(activeKey)} />
                    </div>
                </div>
            )}
        </div>
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
