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
// normal addon-shipped note (under addonRoot, not persistenceRoot), so it gets fully
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
// A registry field can itself nest further `list`/`registry` fields in its
// `itemSchema` (e.g. a colour/prefix variant's `children`, one flat
// label-value map per variant — see libsettings@beatlink's README "Nesting"
// section). The shipped baseline for such a nested field lives inside its
// *parent item's own* shipped default (`shippedItem[key]`, e.g.
// `colors.default.priority.children`), never in the nested field's own
// schema `default` (which is only the blank starting point for a brand-new
// item added through the UI, always `{}`) — so `mergeDefaults`/
// `filterBySchema` thread a `shippedNode` parameter through every level of
// recursion instead of re-deriving "shipped" from `def.default` past the
// top level. Kept in exact lockstep with the identically-named functions in
// libsettings-backend.js.
function mergeRegistryDefaults(itemSchema, shipped, storedWrapper) {
    const storedEntries = isPlainObject(storedWrapper?.entries) ? storedWrapper.entries : {}
    const removedIds = Array.isArray(storedWrapper?.removedIds) ? storedWrapper.removedIds : []
    const merged = {}
    for (const [id, item] of Object.entries(shipped)) {
        if (!removedIds.includes(id)) merged[id] = mergeDefaults(itemSchema, item, null)
    }
    for (const [id, item] of Object.entries(storedEntries)) {
        merged[id] = mergeDefaults(itemSchema, shipped[id] ?? null, item)
    }
    return merged
}

function filterRegistryBySchema(itemSchema, shipped, effective) {
    const entries = {}
    const removedIds = []
    for (const [id, item] of Object.entries(effective)) {
        const shippedItem = shipped[id] ?? null
        const filteredItem = filterBySchema(itemSchema, item, shippedItem)
        const shippedFiltered = shippedItem
            ? filterBySchema(itemSchema, mergeDefaults(itemSchema, shippedItem, null), shippedItem)
            : null
        if (shippedFiltered === null || JSON.stringify(shippedFiltered) !== JSON.stringify(filteredItem)) {
            entries[id] = filteredItem
        }
    }
    for (const id of Object.keys(shipped)) {
        if (!(id in effective)) removedIds.push(id)
    }
    return { entries, removedIds }
}

function mergeDefaults(schema, shippedNode, storedNode) {
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        // Keys starting with `_` are schema-level metadata (e.g. `_categories`,
        // the ordered category list SettingsForm reads), not fields — they
        // carry no per-user value, so they never enter the merged/persisted map.
        if (key.startsWith("_")) continue
        const shippedValue = (shippedNode && key in shippedNode) ? shippedNode[key] : def.default
        if (def.type === "list") {
            const storedList = Array.isArray(storedNode?.[key]) ? storedNode[key] : (shippedValue ?? [])
            values[key] = storedList.map(item => mergeDefaults(def.itemSchema, item, item))
        } else if (def.type === "registry") {
            values[key] = mergeRegistryDefaults(def.itemSchema, shippedValue || {}, storedNode?.[key])
        } else {
            values[key] = (storedNode && key in storedNode) ? storedNode[key] : shippedValue
        }
    }
    return values
}

function filterBySchema(schema, values, shippedNode) {
    const filtered = {}
    for (const key of Object.keys(schema)) {
        if (key.startsWith("_")) continue
        const def = schema[key]
        if (def.type === "list") {
            const list = Array.isArray(values?.[key]) ? values[key] : []
            filtered[key] = list.map(item => filterBySchema(def.itemSchema, item, item))
        } else if (def.type === "registry") {
            const effective = isPlainObject(values?.[key]) ? values[key] : {}
            const shippedValue = (shippedNode && key in shippedNode) ? shippedNode[key] : (def.default || {})
            filtered[key] = filterRegistryBySchema(def.itemSchema, shippedValue || {}, effective)
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
    return mergeDefaults(schema, null, stored)
}

async function persistValues(schema, configNoteId, values) {
    const filtered = filterBySchema(schema, values, null)
    await api.runOnBackend(
        (id, content) => api.getNote(id).setContent(content),
        [configNoteId, JSON.stringify(filtered, null, 4)]
    )
}

// Resolves the pair of note ids every settings consumer needs, from whichever
// note is calling. Two wirings exist and both appear across addons, so this
// accepts either:
//
//   - a *settings* note (the render-note case, what `SettingsPage` uses): the
//     schema and config hang off this note directly, as `schemaNote` and
//     `configNote`.
//   - a *widget* script note: it carries `schemaNote` itself but reaches config
//     indirectly, via its `settingsNote` relation — so the config lookup needs a
//     backend hop to read a relation off a note that isn't the current one.
//
// `note` is required and must be the *consumer's* own note — do not default it
// to `api.currentNote`. Inside this module `api.currentNote` is the library's
// note, not the settings/widget note that owns the `schemaNote` and
// `configNote` relations, so a default silently resolves nothing and
// strands the caller on its loading state. Settings notes pass `api.currentNote`
// from their own module; widgets pass the `currentNote` they import from
// `trilium:api`.
//
// The config note is a persistent note (under the addon's persistenceRoot); the
// `configNote` relation points at it directly and TAM never overwrites its content.
//
// Returns `{ schemaNoteId, configNoteId }`, either of which may be null if the
// relation is absent — callers already gate their render on that.
export async function resolveConfigNotes(note) {
    const schemaNoteId = await note.getRelationValue("schemaNote")
    const settingsNoteId = await note.getRelationValue("settingsNote")
    // No `settingsNote` means this *is* the settings note: read config locally.
    const configNoteId = settingsNoteId
        ? await api.runOnBackend(
            (id) => api.getNote(id).getRelationValue("configNote"),
            [settingsNoteId]
        )
        : (await note.getRelationTarget("configNote"))?.noteId
    return { schemaNoteId, configNoteId }
}

// Exported so other frontend code (e.g. a note-context-aware widget) can read merged
// settings without duplicating the schema/config-loading logic.
export async function loadSettings(schemaNoteId, configNoteId) {
    const schema = await loadSchema(schemaNoteId)
    return loadValues(schema, configNoteId)
}

// The write-side counterpart, for frontend code that needs to persist a
// programmatic edit itself (e.g. a library function called from a widget,
// not just `SettingsForm`'s own Save button) — mirrors
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
// of how deep it's nested. `itemKey` is the id of the enclosing registry
// entry (only meaningful inside a `registry`'s itemSchema — `RegistryItems`
// passes its own entry id down; `ListItems` passes its index for signature
// symmetry) — `checklist` needs it to filter a sibling registry down to just
// the entries that reference this one. `onRegistriesChange` replaces the
// *entire* top-level values object (staged like any other edit — Save persists
// it); only `checklist` uses it, since toggling one edits a sibling top-level
// field rather than this field's own value.
function Field({ def, value, onChange, registries, itemKey, onRegistriesChange }) {
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
                    registries={registries} onRegistriesChange={onRegistriesChange}
                />
            )
        case "registry":
            return (
                <RegistryItems
                    itemSchema={def.itemSchema} items={value || {}} onChange={onChange}
                    registries={registries} onRegistriesChange={onRegistriesChange}
                />
            )
        case "checklist": {
            const sourceRegistry = registries?.[def.registry] || {}
            const groups = Object.entries(sourceRegistry).filter(([, g]) => g?.[def.filterBy] === itemKey)
            return (
                <div class="lst-checklist">
                    {groups.length === 0 && <p class="lst-list-empty">Nothing assigned yet.</p>}
                    {groups.map(([groupId, group]) => (
                        <details class="lst-checklist-group" key={groupId} open>
                            <summary>{group.name}</summary>
                            <div class="lst-checklist-items">
                                {Object.entries(group.children || {}).map(([childId, child]) => (
                                    <FormCheckbox
                                        key={childId}
                                        label={child.name}
                                        currentValue={child.enabled}
                                        onChange={v => {
                                            const updatedGroup = {
                                                ...group,
                                                children: { ...group.children, [childId]: { ...child, enabled: v } }
                                            }
                                            onRegistriesChange({
                                                ...registries,
                                                [def.registry]: { ...sourceRegistry, [groupId]: updatedGroup }
                                            })
                                        }}
                                    />
                                ))}
                            </div>
                        </details>
                    ))}
                </div>
            )
        }
        case "reference": {
            const targetRegistry = registries?.[def.registry] || {}
            const options = Object.entries(targetRegistry).map(([id, item]) => ({ key: id, title: item?.name ?? id }))
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

// An item's collapsed-summary title prefers an itemSchema field literally
// named `name` (matching the convention every consumer's item schema already
// uses for its display name — also what a `reference` field pointing at this
// registry shows in its own dropdown); otherwise it falls back to the first
// field's value — resolved through a `reference` field to the *referenced*
// entry's own name (rather than showing a raw reference id) when that first
// field is itself a `reference`.
function titleFor(itemSchema, item, registries) {
    if ("name" in itemSchema) return item.name || "Untitled"
    const [firstKey, firstDef] = Object.entries(itemSchema)[0] || []
    if (!firstKey) return "Untitled"
    const rawValue = item[firstKey]
    if (firstDef.type === "reference") {
        const referenced = registries?.[firstDef.registry]?.[rawValue]
        return referenced?.name || rawValue || "Untitled"
    }
    return rawValue || "Untitled"
}

// One labeled field row per itemSchema key (skipping a field whose `showWhen`
// doesn't match this item), used by both ListItems and RegistryItems so a
// `list` entry and a `registry` entry render identically — the only
// difference between the two types is how items are keyed/reordered/added,
// never how one item's own fields look.
function ItemFields({ itemSchema, item, onFieldChange, registries, itemKey, onRegistriesChange }) {
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
                        itemKey={itemKey}
                        onRegistriesChange={onRegistriesChange}
                    />
                </div>
            ))}
        </div>
    )
}

// A collapsible entry — the summary is the item's own title (see `titleFor`)
// *and* its move-up/move-down/remove controls, so acting on an entry never
// requires expanding it first; the form-based fields below only show once
// expanded. Shared by ListItems and RegistryItems; expand/collapse state is
// local-only (not persisted) — a pure editing convenience, not data every
// reader of the settings needs to agree on.
function Item({
    itemSchema, item, onFieldChange, registries, itemKey, onRegistriesChange,
    expanded, onToggle, onMoveUp, onMoveDown, onRemove, disableUp, disableDown
}) {
    // A click on the actions would otherwise also toggle the <details> open/
    // closed, since <summary> treats any click inside it as "toggle" unless
    // told not to — preventDefault stops just that default action, letting
    // each Button's own onClick still fire normally.
    return (
        <details class="lst-item" open={expanded} onToggle={onToggle}>
            <summary>
                <span class="lst-item-title">{titleFor(itemSchema, item, registries)}</span>
                <div class="lst-item-actions" onClick={e => e.preventDefault()}>
                    <Button icon="bx-chevron-up" onClick={onMoveUp} disabled={disableUp} />
                    <Button icon="bx-chevron-down" onClick={onMoveDown} disabled={disableDown} />
                    <Button icon="bx-x" onClick={onRemove} />
                </div>
            </summary>
            <div class="lst-item-body">
                <ItemFields
                    itemSchema={itemSchema} item={item} onFieldChange={onFieldChange}
                    registries={registries} itemKey={itemKey} onRegistriesChange={onRegistriesChange}
                />
            </div>
        </details>
    )
}

// A positional array of items, each its own collapsible form — no table, no
// columns, so an expanded item's fields read top-to-bottom like any other
// form on this page rather than needing to scan across a row.
function ListItems({ itemSchema, items, onChange, registries, onRegistriesChange }) {
    const [expandedKeys, setExpandedKeys] = useState(() => new Set())

    function updateItem(index, key, value) {
        onChange(items.map((item, i) => i === index ? { ...item, [key]: value } : item))
    }

    function addItem() {
        const blank = {}
        for (const [key, def] of Object.entries(itemSchema)) blank[key] = def.default
        setExpandedKeys(prev => new Set(prev).add(items.length))
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

    function setExpanded(index, isExpanded) {
        setExpandedKeys(prev => {
            const next = new Set(prev)
            if (isExpanded) next.add(index)
            else next.delete(index)
            return next
        })
    }

    return (
        <div class="lst-list">
            {items.length === 0 && <p class="lst-list-empty">No entries yet.</p>}
            {items.map((item, index) => (
                <Item
                    key={index}
                    itemSchema={itemSchema} item={item}
                    onFieldChange={(key, v) => updateItem(index, key, v)}
                    registries={registries} itemKey={index} onRegistriesChange={onRegistriesChange}
                    expanded={expandedKeys.has(index)} onToggle={e => setExpanded(index, e.currentTarget.open)}
                    onMoveUp={() => moveItem(index, -1)} disableUp={index === 0}
                    onMoveDown={() => moveItem(index, 1)} disableDown={index === items.length - 1}
                    onRemove={() => removeItem(index)}
                />
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
// positional array — everything else (collapsible form-per-item, controls at
// the top) is identical; only add/remove/reorder work id-first instead of
// index-first.
function RegistryItems({ itemSchema, items, onChange, registries, onRegistriesChange }) {
    const keys = Object.keys(items)
    const [expandedKeys, setExpandedKeys] = useState(() => new Set())

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
        <div class="lst-list">
            {keys.length === 0 && <p class="lst-list-empty">No entries yet.</p>}
            {keys.map((key, index) => (
                <Item
                    key={key}
                    itemSchema={itemSchema} item={items[key]}
                    onFieldChange={(fieldKey, v) => updateItem(key, { ...items[key], [fieldKey]: v })}
                    registries={registries} itemKey={key} onRegistriesChange={onRegistriesChange}
                    expanded={expandedKeys.has(key)} onToggle={e => setExpanded(key, e.currentTarget.open)}
                    onMoveUp={() => moveItem(index, -1)} disableUp={index === 0}
                    onMoveDown={() => moveItem(index, 1)} disableDown={index === keys.length - 1}
                    onRemove={() => removeItem(key)}
                />
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

// A field's category is an optional second grouping level *above* tabs: a
// field with `"category": "X"` puts its tab inside category X's tab row. A
// field with no `category` is uncategorized (returns null). Categories only
// take effect when the schema declares a top-level `_categories` array (the
// ordered list of every category label, empty ones included) — see
// SettingsForm.
function resolveCategory(def) {
    return def.category || null
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
// Every edit stages in local state; nothing is written to config.json until the
// Save button is clicked (`save` below persists the whole document at once).
//
// `extraPanels` lets a consumer inject its own non-schema content into the
// same category/tab structure: each entry is `{ category, tab, render }`,
// where `render()` returns the tab's body (any JSX — a custom widget the
// schema can't express). Its `tab` joins the given `category`'s tab row (after
// the schema tabs already there); when active, `render()` is shown in place of
// schema fields. An extra panel naming a category not in `_categories` falls
// under the first declared category, same as a field would. Purely additive:
// no `extraPanels` and the form behaves exactly as before.
// `only` restricts the form to a single tab (by its resolved label): the
// category/tab nav is hidden and just that tab's fields render directly — for
// embedding one tab of a larger schema on its own page while the full schema
// still edits elsewhere. Fields on other tabs are still loaded/merged/persisted
// (it's a display filter, not a schema subset), so Save writes the whole doc.
//
// `onSaved(values)` (optional) fires after a successful Save, for a consumer
// that needs to run a side-effect off the just-persisted config — e.g. writing
// derived labels onto notes once the config that describes them is on disk.
export function SettingsForm({ schemaNoteId, configNoteId, extraPanels = [], only = null, onSaved = null }) {
    const [schema, setSchema] = useState(null)
    const [values, setValues] = useState(null)
    const [saveStatus, setSaveStatus] = useState(null)
    const [activeTab, setActiveTab] = useState(null)
    const [activeCategory, setActiveCategory] = useState(null)

    useEffect(() => {
        (async () => {
            const loadedSchema = await loadSchema(schemaNoteId)
            setSchema(loadedSchema)
            setValues(await loadValues(loadedSchema, configNoteId))
        })()
    }, [schemaNoteId, configNoteId])

    async function save() {
        await persistValues(schema, configNoteId, values)
        if (onSaved) await onSaved(values)
        setSaveStatus("saved")
        setTimeout(() => setSaveStatus(null), 2000)
    }

    if (!schema || !values) return <div class="lst-loading">Loading settings...</div>

    // A `hidden: true` field is still loaded, merged, and persisted like any
    // other (it stays in `values` and rides every save) — it's just never
    // rendered into a tab. For state a widget writes programmatically and
    // wants durable in the config note, without a place in the editor UI.
    const entries = Object.entries(schema).filter(([key, def]) => !key.startsWith("_") && !def.hidden)
    const tabOrder = []
    const tabEntries = {}
    // A tab's category is that of the first field that lands on it — a schema
    // shouldn't split one tab across categories, but if it did the first wins.
    const tabCategory = {}
    // A tab backed by an `extraPanels` entry rather than schema fields maps to
    // its render function here; a tab is never both (a schema tab and an extra
    // panel sharing one label would collide, so consumers give panels their
    // own tab names).
    const extraRender = {}
    for (const entry of entries) {
        const tabLabel = resolveTab(entry[1])
        if (!(tabLabel in tabEntries)) {
            tabEntries[tabLabel] = []
            tabOrder.push(tabLabel)
            tabCategory[tabLabel] = resolveCategory(entry[1])
        }
        tabEntries[tabLabel].push(entry)
    }
    for (const panel of extraPanels) {
        const tabLabel = panel.tab
        if (!(tabLabel in tabEntries) && !(tabLabel in extraRender)) {
            tabOrder.push(tabLabel)
            tabCategory[tabLabel] = panel.category || null
        }
        extraRender[tabLabel] = panel.render
    }
    const tabs = tabOrder.map(label => ({ key: label, label }))

    // Categories are the optional second grouping level: active only when the
    // schema declares a top-level `_categories` array (the ordered category
    // list, empty ones included). When active, the top row is the category bar
    // and the tab bar below it is scoped to the active category; a tab whose
    // field carries no `category` (or names one not in `_categories`) falls
    // under the first declared category so no field is ever unreachable.
    const declaredCategories = Array.isArray(schema._categories) ? schema._categories : []
    // `only` collapses everything to a single tab: no category bar, no tab bar.
    const useCategories = declaredCategories.length > 0 && !only
    const tabsForCategory = (cat) => tabs.filter(t => {
        const c = tabCategory[t.key]
        const resolved = (c && declaredCategories.includes(c)) ? c : declaredCategories[0]
        return resolved === cat
    })

    const activeCat = useCategories
        ? (declaredCategories.includes(activeCategory)
            ? activeCategory
            : (declaredCategories.find(c => tabsForCategory(c).length > 0) || declaredCategories[0]))
        : null
    const visibleTabs = only
        ? tabs.filter(t => t.key === only)
        : (useCategories ? tabsForCategory(activeCat) : tabs)

    // With `only`, never show the tab bar even for the one matching tab.
    const useTabs = !only && visibleTabs.length > 1
    const activeKey = visibleTabs.some(t => t.key === activeTab) ? activeTab : visibleTabs[0]?.key
    // The Save button shows whenever there's at least one field to save. Under
    // `only`, scope that to the visible tab — an embedded single-tab panel gets
    // its own Save when that tab has fields, and none when it doesn't.
    const saveScopeEntries = only
        ? (tabEntries[only] || [])
        : entries
    const needsSaveButton = saveScopeEntries.length > 0

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
            setValues({ ...values, [key]: v })
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
                    onRegistriesChange={v => setValues(v)}
                />
            </div>
        )
    }

    // Render a tab's schema entries, optionally split into sub-groups. A field
    // may carry a `subgroup` string; entries sharing one are rendered under a
    // labelled sub-heading (a fieldset within the tab), in first-seen group
    // order, with entries keeping their original order inside each group.
    // Entries with no `subgroup` render first, ungrouped and unheaded, so a tab
    // that uses no sub-groups behaves exactly as before (a flat field stack).
    function renderTabEntries(entries, tabLabel) {
        const hasSubgroups = entries.some(([, def]) => def.subgroup)
        if (!hasSubgroups) return entries.map(entry => renderEntry(entry, tabLabel))

        const ungrouped = []
        const groupOrder = []
        const byGroup = {}
        for (const entry of entries) {
            const name = entry[1].subgroup
            if (!name) { ungrouped.push(entry); continue }
            if (!(name in byGroup)) { byGroup[name] = []; groupOrder.push(name) }
            byGroup[name].push(entry)
        }
        return (
            <>
                {ungrouped.map(entry => renderEntry(entry, tabLabel))}
                {groupOrder.map(name => (
                    <fieldset class="lst-subgroup" key={name}>
                        <legend class="lst-subgroup-legend">{name}</legend>
                        {byGroup[name].map(entry => renderEntry(entry, tabLabel))}
                    </fieldset>
                ))}
            </>
        )
    }

    // The content of whichever tab is active: an extra panel's own render
    // output if it owns this tab, otherwise the schema fields grouped onto it.
    const activeContent = extraRender[activeKey]
        ? extraRender[activeKey]()
        : renderTabEntries(tabEntries[activeKey] || [], activeKey)

    // The panel body for whichever tabs are in scope: a tab bar plus the
    // active tab's content when there's more than one tab, otherwise just the
    // single tab's content stacked directly (no bar), or an empty-state line
    // when the active category has no tabs at all.
    const panelBody = visibleTabs.length === 0 ? (
        <p class="lst-list-empty">Nothing here yet.</p>
    ) : useTabs ? (
        <div class="lst-tabbed">
            <div class="lst-tabbed-tabs">
                {visibleTabs.map(tab => (
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
                {activeContent}
            </div>
        </div>
    ) : (
        activeContent
    )

    return (
        <div class="lst-panel">
            {useCategories && (
                <div class="lst-categories">
                    {declaredCategories.map(cat => {
                        const empty = tabsForCategory(cat).length === 0
                        return (
                            <button
                                type="button"
                                key={cat}
                                class={`lst-category${cat === activeCat ? " lst-category-active" : ""}`}
                                disabled={empty}
                                onClick={() => { setActiveCategory(cat); setActiveTab(null) }}
                            >
                                {cat}
                            </button>
                        )
                    })}
                </div>
            )}
            {panelBody}
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

// The whole of a typical addon's settings note: resolve this note's schema and
// config, then render the form. Every addon's settings.jsx was otherwise the
// same twenty lines of resolve-then-render boilerplate differing only by
// function name, so they now just re-export this. Extra props (`extraPanels`,
// `only`, `onSaved`) pass straight through to `SettingsForm`, which is what lets
// an addon needing more than a bare form — template-picker's Scan button — still
// use this rather than hand-rolling the resolution again.
export function SettingsPage({ note, ...props }) {
    const [notes, setNotes] = useState(null)

    useEffect(() => {
        (async () => setNotes(await resolveConfigNotes(note)))()
    }, [note])

    if (!notes?.schemaNoteId || !notes?.configNoteId) return <div>Loading...</div>

    return (
        <SettingsForm
            schemaNoteId={notes.schemaNoteId}
            configNoteId={notes.configNoteId}
            {...props}
        />
    )
}
