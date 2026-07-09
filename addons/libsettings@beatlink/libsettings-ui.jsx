import {
    useState,
    useEffect,
    Button,
    FormTextBox,
    FormCheckbox,
    FormDropdownList,
    NoteAutocomplete
} from "trilium:preact"
import { ColorPicker } from "ColorPicker.jsx"

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function mergeDefaults(schema, stored) {
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        if (def.type === "list") {
            const storedList = Array.isArray(stored?.[key]) ? stored[key] : (def.default ?? [])
            values[key] = storedList.map(item => mergeDefaults(def.itemSchema, item))
        } else if (def.type === "registry") {
            const storedRegistry = isPlainObject(stored?.[key]) ? stored[key] : (def.default ?? {})
            values[key] = Object.fromEntries(
                Object.entries(storedRegistry).map(([id, item]) => [id, mergeDefaults(def.itemSchema, item)])
            )
        } else {
            values[key] = (stored && key in stored) ? stored[key] : def.default
        }
    }
    return values
}

function filterBySchema(schema, values) {
    const filtered = {}
    for (const key of Object.keys(schema)) {
        const def = schema[key]
        if (def.type === "list") {
            const list = Array.isArray(values?.[key]) ? values[key] : []
            filtered[key] = list.map(item => filterBySchema(def.itemSchema, item))
        } else if (def.type === "registry") {
            const registry = isPlainObject(values?.[key]) ? values[key] : {}
            filtered[key] = Object.fromEntries(
                Object.entries(registry).map(([id, item]) => [id, filterBySchema(def.itemSchema, item)])
            )
        } else {
            filtered[key] = values[key]
        }
    }
    return filtered
}

async function loadSchema(schemaNoteId) {
    const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [schemaNoteId])
    return JSON.parse(content || "{}")
}

async function loadValues(schema, configNoteId) {
    const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [configNoteId])
    const stored = content ? JSON.parse(content) : {}
    return mergeDefaults(schema, stored)
}

async function persistValues(schema, configNoteId, values) {
    const filtered = filterBySchema(schema, values)
    await api.runOnBackend(
        (id, content) => api.getNote(id).setContent(content),
        [configNoteId, JSON.stringify(filtered, null, 4)]
    )
}

// Exported so other frontend code (e.g. a note-context-aware widget) can read merged
// settings without duplicating the schema/config-loading logic.
export async function loadSettings(schemaNoteId, configNoteId) {
    const schema = await loadSchema(schemaNoteId)
    return loadValues(schema, configNoteId)
}

// `registries` is the full top-level values object (every schema key's
// current value, keyed the same as the schema) — threaded down through
// every Field/ListTable/RegistryTree call so a `reference` field anywhere
// (including inside a nested itemSchema) can resolve `def.registry` against
// a sibling top-level `registry`/`list` field's current entries, regardless
// of how deep it's nested.
function Field({ def, value, onChange, registries }) {
    switch (def.type) {
        case "boolean":
            return <FormCheckbox label={def.label} currentValue={value} onChange={onChange} />
        case "select":
            return (
                <FormDropdownList
                    currentValue={value}
                    values={def.options}
                    keyProperty="value" titleProperty="label"
                    onChange={onChange}
                />
            )
        case "note":
            return <NoteAutocomplete noteId={value} noteIdChanged={onChange} />
        case "number":
            return (
                <FormTextBox
                    type="number"
                    currentValue={value}
                    onChange={e => onChange(Number(e))}
                />
            )
        case "list":
            return <ListTable itemSchema={def.itemSchema} items={value || []} onChange={onChange} registries={registries} />
        case "registry":
            return <RegistryTree itemSchema={def.itemSchema} items={value || {}} onChange={onChange} registries={registries} />
        case "reference": {
            const entries = Object.entries(registries?.[def.registry] || {})
            const options = entries.map(([id, item]) => ({ key: id, title: item?.name ?? id }))
            return (
                <FormDropdownList
                    currentValue={value}
                    values={options}
                    keyProperty="key" titleProperty="title"
                    onChange={onChange}
                />
            )
        }
        case "color":
            return <ColorPicker currentValue={value} onChange={onChange} />
        default:
            return <FormTextBox currentValue={value} onChange={onChange} />
    }
}

// A field only applies to an item whose sibling values match its own
// `showWhen` condition (e.g. `{"type": "dayjs"}`, or `{"type": ["dayjs", "search"]}`
// for more than one matching value) — this is what lets one itemSchema
// describe a polymorphic item (a filter that's either a search query or a
// date comparison, a variant that's either by-label or by-date) instead of
// needing every field to always apply. A field with no `showWhen` always
// applies, same as before this existed.
function matchesShowWhen(def, item) {
    if (!def.showWhen) return true
    return Object.entries(def.showWhen).every(([key, expected]) => {
        const actual = item?.[key]
        return Array.isArray(expected) ? expected.includes(actual) : actual === expected
    })
}

// One row per item, one column per itemSchema key, plus a fixed actions
// column (move/remove) and an Add button that seeds a blank item from
// defaults — a real <table> rather than a stack of always-expanded cards.
// A column whose `showWhen` doesn't match a given row renders as a blank
// cell rather than being omitted — the column (and its header) still exists
// for every other row where it does apply.
function ListTable({ itemSchema, items, onChange, registries }) {
    const columns = Object.entries(itemSchema)

    function updateItem(index, key, value) {
        onChange(items.map((item, i) => i === index ? { ...item, [key]: value } : item))
    }

    function addItem() {
        const blank = {}
        for (const [key, def] of columns) blank[key] = def.default
        onChange([...items, blank])
    }

    function removeItem(index) {
        onChange(items.filter((_, i) => i !== index))
    }

    function moveItem(index, direction) {
        const target = index + direction
        if (target < 0 || target >= items.length) return
        const updated = [...items]
        ;[updated[index], updated[target]] = [updated[target], updated[index]]
        onChange(updated)
    }

    return (
        <table class="lst-table">
            <thead>
                <tr>
                    {columns.map(([key, def]) => <th key={key} title={def.description || undefined}>{def.label}</th>)}
                    <th></th>
                </tr>
            </thead>
            <tbody>
                {items.length === 0 && (
                    <tr><td class="lst-table-empty" colSpan={columns.length + 1}>No entries yet.</td></tr>
                )}
                {items.map((item, index) => (
                    <tr key={index}>
                        {columns.map(([key, def]) => (
                            <td key={key}>
                                {matchesShowWhen(def, item) && (
                                    <Field def={def} value={item[key]} onChange={v => updateItem(index, key, v)} registries={registries} />
                                )}
                            </td>
                        ))}
                        <td class="lst-table-actions-cell">
                            <div class="lst-table-actions">
                                <Button icon="bx-chevron-up" onClick={() => moveItem(index, -1)} disabled={index === 0} />
                                <Button icon="bx-chevron-down" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1} />
                                <Button icon="bx-x" onClick={() => removeItem(index)} />
                            </div>
                        </td>
                    </tr>
                ))}
            </tbody>
            <tfoot>
                <tr><td colSpan={columns.length + 1}><Button icon="bx-plus" text="Add" onClick={addItem} /></td></tr>
            </tfoot>
        </table>
    )
}

let registryIdCounter = 0
function generateRegistryId() {
    registryIdCounter += 1
    return `item-${Date.now()}-${registryIdCounter}`
}

// Same shape as ListTable but keyed by id (`{ [id]: item }`) rather than a
// positional array, and rendered as a stack of collapsible cards instead of
// table rows — one labeled field row per itemSchema key inside each card,
// via the same `Field` dispatch every other entry uses (including passing
// `registries` through, so a nested `reference` field can resolve another
// top-level registry's current entries). A registry entry's collapsed label
// prefers an itemSchema field literally named `name` (matching the
// convention every consumer's item schema already uses for its display
// name — also what a `reference` field pointing at this registry shows in
// its own dropdown); otherwise it falls back to the first field's value.
// Expand/collapse state is local-only (not persisted) — a pure editing
// convenience, not data every reader of the settings needs to agree on.
function RegistryTree({ itemSchema, items, onChange, registries }) {
    const keys = Object.keys(items)
    const [expandedKeys, setExpandedKeys] = useState(() => new Set())
    const [firstKey, firstDef] = Object.entries(itemSchema)[0] || []

    // An item without its own `name` field falls back to its first field's
    // value — but a nested registry whose entries are themselves usages of
    // another registry (elementId+enabled, no `name` of their own) would
    // otherwise show a raw reference id as the card label. Resolving through
    // a first field that's itself a `reference` shows the referenced entry's
    // own name instead, same as a `reference` field's own dropdown does.
    function labelFor(item) {
        if ("name" in itemSchema) return item.name || "Untitled"
        if (!firstKey) return "Untitled"
        const rawValue = item[firstKey]
        if (firstDef.type === "reference") {
            const referenced = registries?.[firstDef.registry]?.[rawValue]
            return referenced?.name || rawValue || "Untitled"
        }
        return rawValue || "Untitled"
    }

    function updateItem(key, newValue) {
        onChange({ ...items, [key]: newValue })
    }

    function removeItem(key) {
        const updated = { ...items }
        delete updated[key]
        onChange(updated)
    }

    function addItem() {
        const blank = {}
        for (const [key, def] of Object.entries(itemSchema)) blank[key] = def.default
        const id = generateRegistryId()
        setExpandedKeys(prev => new Set(prev).add(id))
        onChange({ ...items, [id]: blank })
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

    function setExpanded(key, isExpanded) {
        setExpandedKeys(prev => {
            const next = new Set(prev)
            if (isExpanded) next.add(key)
            else next.delete(key)
            return next
        })
    }

    return (
        <div class="lst-tree">
            {keys.length === 0 && <p class="lst-tree-empty">No entries yet.</p>}
            {keys.map((key, index) => {
                const item = items[key]
                return (
                    <details
                        key={key}
                        class="lst-tree-item"
                        open={expandedKeys.has(key)}
                        onToggle={e => setExpanded(key, e.currentTarget.open)}
                    >
                        <summary>{labelFor(item)}</summary>
                        <div class="lst-tree-item-body">
                            <div class="lst-tree-item-fields">
                                {Object.entries(itemSchema).map(([fieldKey, def]) => matchesShowWhen(def, item) && (
                                    <div class="lst-field-row" key={fieldKey} title={def.description || undefined}>
                                        <label>{def.label}</label>
                                        <Field
                                            def={def}
                                            value={item[fieldKey]}
                                            onChange={v => updateItem(key, { ...item, [fieldKey]: v })}
                                            registries={registries}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div class="lst-tree-item-actions">
                                <Button icon="bx-chevron-up" onClick={() => moveItem(index, -1)} disabled={index === 0} />
                                <Button icon="bx-chevron-down" onClick={() => moveItem(index, 1)} disabled={index === keys.length - 1} />
                                <Button icon="bx-x" onClick={() => removeItem(key)} />
                            </div>
                        </div>
                    </details>
                )
            })}
            <Button icon="bx-plus" text="Add" onClick={addItem} />
        </div>
    )
}

// A field lands on the tab its own `tab` property names; absent that, a
// `list`/`registry` field defaults to its own label (so it gets its own tab
// automatically, the original behavior), and everything else defaults to
// "General". This lets a schema author combine several fields — including
// more than one list/registry, or a mix of scalar and list/registry fields —
// onto one named tab explicitly, while a schema that never sets `tab` groups
// exactly as before.
function resolveTab(def) {
    if (def.tab) return def.tab
    return (def.type === "list" || def.type === "registry") ? (def.label || "General") : "General"
}

// Self-contained: loads schema.json + config.json itself, renders one field per schema
// entry, and owns its own Save button. The consuming addon just places this wherever
// it wants in its own settings widget.
//
// Entries are grouped by `resolveTab` into an ordered map (first-occurrence
// order), and when there's more than one group they become top-level tabs —
// one page at a time — rather than every group stacked and expanded
// together; a schema with only one group (the common case: just a handful of
// scalar fields, or just one list/registry) renders directly with no tab bar.
export function SettingsForm({ schemaNoteId, configNoteId }) {
    const [schema, setSchema] = useState(null)
    const [values, setValues] = useState(null)
    const [saveStatus, setSaveStatus] = useState(null)
    const [activeTab, setActiveTab] = useState(null)

    useEffect(() => {
        (async () => {
            const loadedSchema = await loadSchema(schemaNoteId)
            setSchema(loadedSchema)
            setValues(await loadValues(loadedSchema, configNoteId))
        })()
    }, [schemaNoteId, configNoteId])

    async function save() {
        await persistValues(schema, configNoteId, values)
        setSaveStatus("saved")
        setTimeout(() => setSaveStatus(null), 2000)
    }

    if (!schema || !values) return <div class="lst-loading">Loading settings...</div>

    const entries = Object.entries(schema)
    const tabOrder = []
    const tabEntries = {}
    for (const entry of entries) {
        const tabLabel = resolveTab(entry[1])
        if (!(tabLabel in tabEntries)) {
            tabEntries[tabLabel] = []
            tabOrder.push(tabLabel)
        }
        tabEntries[tabLabel].push(entry)
    }
    const tabs = tabOrder.map(label => ({ key: label, label }))
    const useTabs = tabs.length > 1
    const activeKey = useTabs && tabs.some(t => t.key === activeTab) ? activeTab : tabs[0]?.key

    // A field's own heading is redundant when the tab bar already shows the
    // same label right above it (the common case: a lone list/registry field
    // that is its own tab) — but still shown whenever there's no tab bar to
    // do that job, or the field shares a tab with something else and needs
    // its own name to stand out.
    function renderEntry([key, def], tabLabel) {
        const showHeading = !useTabs || def.label !== tabLabel
        const isGroup = def.type === "list" || def.type === "registry"
        return (
            <div class={isGroup ? undefined : "lst-field"} key={key}>
                {showHeading && <h4>{def.label}</h4>}
                {def.description && <label class="lst-field-description">{def.description}</label>}
                <Field def={def} value={values[key]} onChange={v => setValues({ ...values, [key]: v })} registries={values} />
            </div>
        )
    }

    return (
        <div class="lst-panel">
            {useTabs ? (
                <div class="lst-tabbed">
                    <div class="lst-tabbed-tabs">
                        {tabs.map(tab => (
                            <button
                                type="button"
                                key={tab.key}
                                class={`lst-tab${tab.key === activeKey ? " lst-tab-active" : ""}`}
                                onClick={() => setActiveTab(tab.key)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <div class="lst-tabbed-panel">
                        {(tabEntries[activeKey] || []).map(entry => renderEntry(entry, activeKey))}
                    </div>
                </div>
            ) : (
                entries.map(entry => renderEntry(entry, tabs[0]?.key))
            )}
            <div class="lst-actions">
                <Button
                    icon={saveStatus === "saved" ? "bx-check" : "bx-save"}
                    text={saveStatus === "saved" ? "Saved!" : "Save"}
                    onClick={save}
                />
            </div>
        </div>
    )
}
