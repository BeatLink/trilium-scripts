import { useActiveNoteContext, useNoteLabel, FormDropdownList } from "trilium:preact"

const { assignDimension } = require("dimensions.js")

const NONE_KEY = "__none__"

// One dropdown for one dimension, hosted in the Task pane's Classification
// section. Reads/writes the dimension's own note label and mirrors #color when
// the dimension asks for it — assignDimension does both, the same write the
// Organize triage queue uses, so the two always agree.
//
// A note may carry a value the vocabulary no longer lists (renamed or removed in
// settings since it was set). That is surfaced as its own "⚠ Invalid" option
// rather than silently coerced to None, which would hide that the note's data is
// stale rather than actually unset.
export function DimensionPicker({ dimension }) {
    const { note } = useActiveNoteContext()
    const [current, setCurrent] = useNoteLabel(note, dimension.label)
    const value = current || NONE_KEY

    const isInvalid = !!current && !dimension.values.some(v => v.key === current)
    const options = [
        { key: NONE_KEY, name: "None" },
        ...dimension.values.map(v => ({ key: v.key, name: v.name })),
        ...(isInvalid ? [{ key: current, name: `⚠ Invalid: ${current}` }] : [])
    ]

    async function onChange(key) {
        const chosen = key === NONE_KEY ? null : dimension.values.find(v => v.key === key)
        // Optimistic: reflect the choice immediately, then persist (with #color
        // and ~template side-effects) on the backend.
        setCurrent(key === NONE_KEY ? "" : key)
        await assignDimension(note.noteId, dimension, chosen || (key === NONE_KEY ? null : { key }))
    }

    return (
        <div className="agenda-dimension-picker">
            <label>{dimension.name}</label>
            <FormDropdownList
                class="dropdown-component form-control"
                values={options}
                currentValue={value}
                onChange={onChange}
                keyProperty="key" titleProperty="name"
            />
        </div>
    )
}
