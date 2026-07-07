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

function mergeDefaults(schema, stored) {
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        if (def.type === "list") {
            const storedList = Array.isArray(stored?.[key]) ? stored[key] : (def.default ?? [])
            values[key] = storedList.map(item => mergeDefaults(def.itemSchema, item))
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

function Field({ def, value, onChange }) {
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
            return <ListField itemSchema={def.itemSchema} items={value || []} onChange={onChange} />
        case "color":
            return <ColorPicker currentValue={value} onChange={onChange} />
        default:
            return <FormTextBox currentValue={value} onChange={onChange} />
    }
}

// One row per item, each row rendering a Field per itemSchema key, plus
// move/remove controls and an Add button that seeds a blank item from defaults.
function ListField({ itemSchema, items, onChange }) {
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
            {items.length === 0 && <p class="lst-list-empty">No entries yet. Add one below.</p>}
            {items.map((item, index) => (
                <div class="lst-list-item" key={index}>
                    <div class="lst-list-item-fields">
                        {Object.entries(itemSchema).map(([key, def]) => (
                            <div class="lst-field" key={key}>
                                <h4>{def.label}</h4>
                                {def.description && <label class="lst-field-description">{def.description}</label>}
                                <Field def={def} value={item[key]} onChange={v => updateItem(index, key, v)} />
                            </div>
                        ))}
                    </div>
                    <div class="lst-list-item-controls">
                        <Button icon="bx-chevron-up" onClick={() => moveItem(index, -1)} disabled={index === 0} />
                        <Button icon="bx-chevron-down" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1} />
                        <Button icon="bx-x" onClick={() => removeItem(index)} />
                    </div>
                </div>
            ))}
            <Button icon="bx-plus" text="Add" onClick={addItem} />
        </div>
    )
}

// Self-contained: loads schema.json + config.json itself, renders one field per schema
// entry, and owns its own Save button. The consuming addon just places this wherever
// it wants in its own settings widget.
export function SettingsForm({ schemaNoteId, configNoteId }) {
    const [schema, setSchema] = useState(null)
    const [values, setValues] = useState(null)
    const [saveStatus, setSaveStatus] = useState(null)

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

    return (
        <div class="lst-panel">
            {Object.entries(schema).map(([key, def]) => (
                <div class="lst-field" key={key}>
                    <h4>{def.label}</h4>
                    {def.description && <label class="lst-field-description">{def.description}</label>}
                    <Field def={def} value={values[key]} onChange={v => setValues({ ...values, [key]: v })} />
                </div>
            ))}
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
