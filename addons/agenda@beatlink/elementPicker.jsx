import { FormDropdownList } from "trilium:preact"

function optionsFor(registry, category) {
    return Object.entries(registry[category] || {}).map(([key, el]) => ({ key, title: el.name }))
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
