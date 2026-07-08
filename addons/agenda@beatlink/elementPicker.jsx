import { FormDropdownList, FormCheckbox, Button } from "trilium:preact"

function optionsFor(registry, category) {
    return Object.entries(registry[category] || {}).map(([key, el]) => ({ key, title: el.name }))
}

// A single { elementId, enabled } usage inside a profile's search/filter
// group — picks which shared element (by name) this usage points at, plus
// a per-profile enabled toggle. The element's own definition (its rule) is
// never edited here — that only ever happens in the Element Library.
export function ElementUsageRow({ usage, category, registry, onChange, onOpenLibrary }) {
    const options = optionsFor(registry, category)
    return (
        <div className="pe-field-row">
            <FormDropdownList
                values={options}
                currentValue={usage.elementId}
                onChange={elementId => onChange({ ...usage, elementId })}
                keyProperty="key" titleProperty="title"
            />
            <FormCheckbox
                label="Enabled"
                currentValue={usage.enabled}
                onChange={v => onChange({ ...usage, enabled: v })}
            />
            {onOpenLibrary && (
                <Button icon="bx-library" text="Manage Elements" onClick={onOpenLibrary} />
            )}
        </div>
    )
}

// A bare selected-element dropdown, for the single-selection sort/prefix/
// color case (a profile picks exactly one named preset from the registry).
export function ElementSelect({ category, registry, value, onChange }) {
    const options = optionsFor(registry, category)
    return (
        <FormDropdownList
            values={options}
            currentValue={value}
            onChange={onChange}
            keyProperty="key" titleProperty="title"
        />
    )
}

export function firstElementId(registry, category) {
    return Object.keys(registry[category] || {})[0] ?? ""
}
