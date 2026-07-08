import { FormTextBox, FormCheckbox, FormDropdownList } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { KeyedList } from "profileEditorGroups.jsx"

const { parseSortCriteria } = require("libMultisort.js")

function criteriaToString(rows) {
    return rows
        .filter(r => r.attribute)
        .map(r => [r.attribute, r.desc ? "desc" : null, r.caseInsensitive ? "caseInsensitive" : null]
            .filter(Boolean).join(":"))
        .join(";")
}

function newSort() {
    return { name: "New Sort", rule: "" }
}

function newCriterion() {
    return { attribute: "", desc: false, caseInsensitive: false }
}

// Criteria rows have no identity of their own (they're positional segments
// of a semicolon string) — key them non-numerically so JS's integer-index
// key-reordering quirk never kicks in once a freshly-added row (KeyedList's
// own generated keys are already non-numeric) sits alongside these.
function rowsToItems(rows) {
    return Object.fromEntries(rows.map((row, i) => [`c-${i}`, row]))
}

function CriteriaEditor({ rule, onChange }) {
    const items = rowsToItems(parseSortCriteria(rule || ""))

    function handleChange(newItems) {
        onChange(criteriaToString(Object.values(newItems)))
    }

    return (
        <KeyedList
            items={items}
            onChange={handleChange}
            newItemFactory={newCriterion}
            addLabel="Add Criterion"
            renderItem={(key, row, update) => (
                <div className="pe-field-row">
                    <FormTextBox currentValue={row.attribute} onChange={v => update({ ...row, attribute: v })} />
                    <FormCheckbox label="Descending" currentValue={row.desc} onChange={v => update({ ...row, desc: v })} />
                    <FormCheckbox
                        label="Case Insensitive"
                        currentValue={row.caseInsensitive}
                        onChange={v => update({ ...row, caseInsensitive: v })}
                    />
                </div>
            )}
        />
    )
}

export function SortsEditor({ sorts, onChange }) {
    const selectedOptions = Object.entries(sorts.children).map(([key, s]) => ({ key, title: s.name }))
    return (
        <Collapsible
            label="Sorts"
            expanded={sorts.expanded}
            onToggle={e => onChange({ ...sorts, expanded: e.currentTarget.open })}
            className="pe-section"
        >
            <FormDropdownList
                values={selectedOptions}
                currentValue={sorts.selected}
                onChange={selected => onChange({ ...sorts, selected })}
                keyProperty="key" titleProperty="title"
            />
            <KeyedList
                items={sorts.children}
                onChange={children => onChange({ ...sorts, children })}
                newItemFactory={newSort}
                addLabel="Add Sort"
                renderItem={(key, sort, update) => (
                    <div className="pe-group">
                        <FormTextBox currentValue={sort.name} onChange={v => update({ ...sort, name: v })} />
                        <CriteriaEditor rule={sort.rule} onChange={rule => update({ ...sort, rule })} />
                    </div>
                )}
            />
        </Collapsible>
    )
}
