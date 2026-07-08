import { FormTextBox, FormCheckbox, FormDropdownList } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { KeyedList, LabelValueMapEditor } from "profileEditorGroups.jsx"
import { DayjsRulePicker } from "dayjsRulePicker.jsx"

const typeOptions = [
    { key: "label", title: "By Label Value" },
    { key: "dayjs", title: "By Date" }
]

function newVariant() {
    return { name: "New Prefix", type: "label", label: "", children: {} }
}

function newInterval() {
    return { rule: ["isNull"], formatString: "" }
}

function VariantEditor({ variant, onChange }) {
    function setType(newType) {
        if (newType === variant.type) return
        // A label-typed variant's data lives in `children` (a labelValue ->
        // prefix map); a dayjs-typed one lives in `intervals` (a rule ->
        // format map) — switching type resets rather than leaving the other
        // shape's stale, now-unused fields behind.
        onChange({
            ...variant,
            type: newType,
            ...(newType === "label"
                ? { label: "", children: {} }
                : { dateLabel: "", useNumberOfDays: false, intervals: {} })
        })
    }

    return (
        <div className="pe-group">
            <FormTextBox currentValue={variant.name} onChange={v => onChange({ ...variant, name: v })} />
            <FormDropdownList
                values={typeOptions}
                currentValue={variant.type}
                onChange={setType}
                keyProperty="key" titleProperty="title"
            />
            {variant.type === "label" && (
                <>
                    <FormTextBox
                        currentValue={variant.label || ""}
                        onChange={v => onChange({ ...variant, label: v })}
                    />
                    <LabelValueMapEditor
                        entries={variant.children || {}}
                        onChange={children => onChange({ ...variant, children })}
                        defaultValue=""
                        renderValue={(value, update) => (
                            <FormTextBox currentValue={value} onChange={update} />
                        )}
                    />
                </>
            )}
            {variant.type === "dayjs" && (
                <>
                    <FormTextBox
                        currentValue={variant.dateLabel || ""}
                        onChange={v => onChange({ ...variant, dateLabel: v })}
                    />
                    <FormCheckbox
                        label="Use Number of Days"
                        currentValue={!!variant.useNumberOfDays}
                        onChange={v => onChange({ ...variant, useNumberOfDays: v })}
                    />
                    <KeyedList
                        items={variant.intervals || {}}
                        onChange={intervals => onChange({ ...variant, intervals })}
                        newItemFactory={newInterval}
                        addLabel="Add Interval"
                        renderItem={(key, interval, update) => (
                            <div className="pe-field-row">
                                <DayjsRulePicker value={interval.rule} onChange={rule => update({ ...interval, rule })} />
                                <FormTextBox
                                    currentValue={interval.formatString || ""}
                                    onChange={v => update({ ...interval, formatString: v })}
                                />
                            </div>
                        )}
                    />
                </>
            )}
        </div>
    )
}

export function PrefixesEditor({ prefixes, onChange }) {
    const selectedOptions = Object.entries(prefixes.children).map(([key, v]) => ({ key, title: v.name }))
    return (
        <Collapsible
            label="Prefixes"
            expanded={prefixes.expanded}
            onToggle={e => onChange({ ...prefixes, expanded: e.currentTarget.open })}
            className="pe-section"
        >
            <FormDropdownList
                values={selectedOptions}
                currentValue={prefixes.selected}
                onChange={selected => onChange({ ...prefixes, selected })}
                keyProperty="key" titleProperty="title"
            />
            <KeyedList
                items={prefixes.children}
                onChange={children => onChange({ ...prefixes, children })}
                newItemFactory={newVariant}
                addLabel="Add Prefix Variant"
                renderItem={(key, variant, update) => <VariantEditor variant={variant} onChange={update} />}
            />
        </Collapsible>
    )
}
