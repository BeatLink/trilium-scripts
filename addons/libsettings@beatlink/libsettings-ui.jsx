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

// A registry's `default` doubles as its *shipped* entries — schema.json is a
// normal addon-shipped note (not `AddonData:`-tracked), so it gets fully
// overwritten on every TAM update just like the rest of the addon, meaning a
// newly-added shipped entry reaches existing installs for free. The
// persisted (config.json) shape for a registry field is therefore not the
// flat runtime map itself but `{ entries, removedIds }`: `entries` holds
// only additions/edits that differ from the shipped version (keyed by the
// same id to shadow a specific shipped entry), and `removedIds` records
// which shipped ids the user deleted — an untouched shipped entry is never
// duplicated into config.json, so it keeps tracking future shipped edits
// until the user actually changes it. `mergeRegistryDefaults` reconstructs
// the flat runtime map (shipped, minus removed, with entries overlaid) that
// the rest of this module and the UI both work with; `filterRegistryBySchema`
// is the inverse, run on save. Kept in exact lockstep with the identically-
// named functions in libsettings-backend.js.
function mergeRegistryDefaults(itemSchema, shipped, storedWrapper) {
    const storedEntries = isPlainObject(storedWrapper?.entries) ? storedWrapper.entries : {}
    const removedIds = Array.isArray(storedWrapper?.removedIds) ? storedWrapper.removedIds : []
    const merged = {}
    for (const [id, item] of Object.entries(shipped)) {
        if (!removedIds.includes(id)) merged[id] = mergeDefaults(itemSchema, item)
    }
    for (const [id, item] of Object.entries(storedEntries)) {
        merged[id] = mergeDefaults(itemSchema, item)
    }
    return merged
}

function filterRegistryBySchema(itemSchema, shipped, effective) {
    const entries = {}
    const removedIds = []
    for (const [id, item] of Object.entries(effective)) {
        const filteredItem = filterBySchema(itemSchema, item)
        const shippedItem = shipped[id]
        const shippedFiltered = shippedItem ? filterBySchema(itemSchema, mergeDefaults(itemSchema, shippedItem)) : null
        if (shippedFiltered === null || JSON.stringify(shippedFiltered) !== JSON.stringify(filteredItem)) {
            entries[id] = filteredItem
        }
    }
    for (const id of Object.keys(shipped)) {
        if (!(id in effective)) removedIds.push(id)
    }
    return { entries, removedIds }
}

function mergeDefaults(schema, stored) {
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        if (def.type === "list") {
            const storedList = Array.isArray(stored?.[key]) ? stored[key] : (def.default ?? [])
            values[key] = storedList.map(item => mergeDefaults(def.itemSchema, item))
        } else if (def.type === "registry") {
            values[key] = mergeRegistryDefaults(def.itemSchema, def.default || {}, stored?.[key])
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
            const effective = isPlainObject(values?.[key]) ? values[key] : {}
            filtered[key] = filterRegistryBySchema(def.itemSchema, def.default || {}, effective)
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

// The write-side counterpart, for frontend code that needs to persist a
// programmatic edit itself (e.g. a library function called from a widget,
// not just `SettingsForm`'s own Save button/autosave) — mirrors
// `libsettings-backend.js`'s `saveSettings` exactly, just backend-note-read
// via `api.runOnBackend` like every other frontend function in this file.
export async function saveSettings(schemaNoteId, configNoteId, values) {
    const schema = await loadSchema(schemaNoteId)
    await persistValues(schema, configNoteId, values)
}

// `registries` is the full top-level values object (every schema key's
// current value, keyed the same as the schema) — threaded down through
// every Field/ListItems/RegistryItems call so a `reference` field anywhere
// (including inside a nested itemSchema) can resolve `def.registry` against
// a sibling top-level `registry`/`list` field's current entries, regardless
// of how deep it's nested. `schemas` is the equivalent top-level *schema*
// object (needed only by an `inline` reference, to find the referenced
// registry's own `itemSchema`) and `updateReferencedField` is the write-
// through callback an `inline` reference uses to edit the referenced
// entry's own fields in place — both threaded the same unchanging way.
function Field({ def, value, onChange, registries, schemas, updateReferencedField }) {
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
            return (
                <ListItems
                    itemSchema={def.itemSchema} items={value || []} onChange={onChange}
                    registries={registries} schemas={schemas} updateReferencedField={updateReferencedField}
                />
            )
        case "registry":
            return (
                <RegistryItems
                    itemSchema={def.itemSchema} items={value || {}} onChange={onChange}
                    registries={registries} schemas={schemas} updateReferencedField={updateReferencedField}
                />
            )
        case "reference": {
            const targetRegistry = registries?.[def.registry] || {}
            const options = Object.entries(targetRegistry).map(([id, item]) => ({ key: id, title: item?.name ?? id }))
            const picker = (
                <FormDropdownList
                    currentValue={value}
                    values={options}
                    keyProperty="key" titleProperty="title"
                    onChange={onChange}
                />
            )
            // `inline` folds the referenced entry's own fields directly below
            // the picker, editable in place — writing through `updateReferencedField`
            // to the *other* registry, never to this field's own value. Falls back
            // to the plain picker if there's nothing resolvable to fold in (no
            // itemSchema for the target registry, or nothing currently selected).
            if (!def.inline) return picker
            const refItemSchema = schemas?.[def.registry]?.itemSchema
            const refItem = targetRegistry[value]
            if (!refItemSchema || !refItem) return picker
            return (
                <div class="lst-reference-inline">
                    {picker}
                    <div class="lst-item-fields">
                        {Object.entries(refItemSchema).map(([fieldKey, fieldDef]) => matchesShowWhen(fieldDef, refItem) && (
                            <div class="lst-field-row" key={fieldKey} title={fieldDef.description || undefined}>
                                <label>{fieldDef.label}</label>
                                <Field
                                    def={fieldDef}
                                    value={refItem[fieldKey]}
                                    onChange={v => updateReferencedField(def.registry, value, fieldKey, v)}
                                    registries={registries}
                                    schemas={schemas}
                                    updateReferencedField={updateReferencedField}
                                />
                            </div>
                        ))}
                    </div>
                </div>
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

// One labeled field row per itemSchema key (skipping a field whose `showWhen`
// doesn't match this item), used by both ListItems and RegistryItems so a
// `list` entry and a `registry` entry render identically — the only
// difference between the two types is how items are keyed/reordered/added,
// never how one item's own fields look.
function ItemFields({ itemSchema, item, onFieldChange, registries, schemas, updateReferencedField }) {
    return (
        <div class="lst-item-fields">
            {Object.entries(itemSchema).map(([fieldKey, def]) => matchesShowWhen(def, item) && (
                <div class="lst-field-row" key={fieldKey} title={def.description || undefined}>
                    <label>{def.label}</label>
                    <Field
                        def={def}
                        value={item[fieldKey]}
                        onChange={v => onFieldChange(fieldKey, v)}
                        registries={registries}
                        schemas={schemas}
                        updateReferencedField={updateReferencedField}
                    />
                </div>
            ))}
        </div>
    )
}

// Move-up/move-down/remove, always at the top of an item — so reordering or
// removing an entry never requires scrolling past its (possibly long) form
// first.
function ItemActions({ onMoveUp, onMoveDown, onRemove, disableUp, disableDown }) {
    return (
        <div class="lst-item-actions">
            <Button icon="bx-chevron-up" onClick={onMoveUp} disabled={disableUp} />
            <Button icon="bx-chevron-down" onClick={onMoveDown} disabled={disableDown} />
            <Button icon="bx-x" onClick={onRemove} />
        </div>
    )
}

// A positional array of items, each rendered as its own bordered form (top:
// reorder/remove controls, below: one labeled field row per itemSchema key)
// — no table, no columns, so an item's fields read top-to-bottom like any
// other form on this page rather than needing to scan across a row.
function ListItems({ itemSchema, items, onChange, registries, schemas, updateReferencedField }) {
    function updateItem(index, key, value) {
        onChange(items.map((item, i) => i === index ? { ...item, [key]: value } : item))
    }

    function addItem() {
        const blank = {}
        for (const [key, def] of Object.entries(itemSchema)) blank[key] = def.default
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
        <div class="lst-list">
            {items.length === 0 && <p class="lst-list-empty">No entries yet.</p>}
            {items.map((item, index) => (
                <div class="lst-item" key={index}>
                    <ItemActions
                        onMoveUp={() => moveItem(index, -1)} disableUp={index === 0}
                        onMoveDown={() => moveItem(index, 1)} disableDown={index === items.length - 1}
                        onRemove={() => removeItem(index)}
                    />
                    <ItemFields
                        itemSchema={itemSchema} item={item}
                        onFieldChange={(key, v) => updateItem(index, key, v)}
                        registries={registries} schemas={schemas} updateReferencedField={updateReferencedField}
                    />
                </div>
            ))}
            <Button icon="bx-plus" text="Add" onClick={addItem} />
        </div>
    )
}

let registryIdCounter = 0
function generateRegistryId() {
    registryIdCounter += 1
    return `item-${Date.now()}-${registryIdCounter}`
}

// Same shape as ListItems but keyed by id (`{ [id]: item }`) rather than a
// positional array — everything else (form-per-item, controls at the top)
// is identical; only add/remove/reorder work id-first instead of index-first.
function RegistryItems({ itemSchema, items, onChange, registries, schemas, updateReferencedField }) {
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
        const blank = {}
        for (const [key, def] of Object.entries(itemSchema)) blank[key] = def.default
        onChange({ ...items, [generateRegistryId()]: blank })
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
        <div class="lst-list">
            {keys.length === 0 && <p class="lst-list-empty">No entries yet.</p>}
            {keys.map((key, index) => (
                <div class="lst-item" key={key}>
                    <ItemActions
                        onMoveUp={() => moveItem(index, -1)} disableUp={index === 0}
                        onMoveDown={() => moveItem(index, 1)} disableDown={index === keys.length - 1}
                        onRemove={() => removeItem(key)}
                    />
                    <ItemFields
                        itemSchema={itemSchema} item={items[key]}
                        onFieldChange={(fieldKey, v) => updateItem(key, { ...items[key], [fieldKey]: v })}
                        registries={registries} schemas={schemas} updateReferencedField={updateReferencedField}
                    />
                </div>
            ))}
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
//
// A field marked `autosave: true` persists on every edit instead of only on
// Save — see `handleChange`/`updateReferencedField` below. The Save button
// itself is only rendered if at least one field isn't `autosave`; a schema
// that's entirely autosave fields has nothing left for it to do.
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

    // A field marked `autosave: true` persists immediately on every edit
    // instead of waiting on the Save button below — same full-document
    // `persistValues` write either way (there's no such thing as writing
    // "just one field" to config.json), just triggered right away instead of
    // on click. Silent by design (no save-status flash): the explicit Save
    // button's flash means "you have a pending edit, and it's now saved";
    // an autosave field never has a pending edit to report on.
    function persistNow(updatedValues) {
        persistValues(schema, configNoteId, updatedValues)
    }

    // Write-through for an `inline` reference field: edits the *referenced*
    // registry's entry directly (never this field's own value), regardless
    // of how deep the reference itself is nested — every reference resolves
    // and writes against these same top-level `values`. Autosaves if the
    // *referenced* registry's own field is marked `autosave` (not the
    // reference field itself, which has no persisted value of its own to
    // gate on) — editing a search's name inline from an autosaving Filters
    // tab shouldn't require a trip to the Searches tab's own Save button.
    function updateReferencedField(registryKey, entryId, fieldKey, newFieldValue) {
        const registry = values[registryKey] || {}
        const entry = registry[entryId] || {}
        const updated = {
            ...values,
            [registryKey]: { ...registry, [entryId]: { ...entry, [fieldKey]: newFieldValue } }
        }
        setValues(updated)
        if (schema[registryKey]?.autosave) persistNow(updated)
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
    // Nothing ever needs the explicit button if every field autosaves — the
    // common case for a schema that's entirely element-library-shaped, no
    // profile-identity-style fields that want a deliberate Save.
    const needsSaveButton = entries.some(([, def]) => !def.autosave)

    // A group field (list/registry) keeps its own heading above a full-width
    // widget — a fixed left-hand label column doesn't make sense next to
    // something that tall. A scalar field instead renders as a `.lst-field-row`
    // (label left, value right), the same left-label/right-value layout every
    // item's own fields already use, so a schema's top-level scalar fields
    // read consistently with everything nested inside a list/registry entry.
    // A field's own heading is redundant when the tab bar already shows the
    // same label right above it (the common case: a lone list/registry field
    // that is its own tab) — but still shown whenever there's no tab bar to
    // do that job, or the field shares a tab with something else and needs
    // its own name to stand out.
    function renderEntry([key, def], tabLabel) {
        const showHeading = !useTabs || def.label !== tabLabel
        const isGroup = def.type === "list" || def.type === "registry"

        function handleChange(v) {
            const updated = { ...values, [key]: v }
            setValues(updated)
            if (def.autosave) persistNow(updated)
        }

        return (
            <div
                class={isGroup ? "lst-field" : "lst-field-row"}
                key={key}
                title={!isGroup ? (def.description || undefined) : undefined}
            >
                {isGroup ? (
                    <>
                        {showHeading && <h4>{def.label}</h4>}
                        {def.description && <label class="lst-field-description">{def.description}</label>}
                    </>
                ) : (
                    <label>{def.label}</label>
                )}
                <Field
                    def={def}
                    value={values[key]}
                    onChange={handleChange}
                    registries={values}
                    schemas={schema}
                    updateReferencedField={updateReferencedField}
                />
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
            {needsSaveButton && (
                <div class="lst-actions">
                    <Button
                        icon={saveStatus === "saved" ? "bx-check" : "bx-save"}
                        text={saveStatus === "saved" ? "Saved!" : "Save"}
                        onClick={save}
                    />
                </div>
            )}
        </div>
    )
}
