import { FormTextBox, FormCheckbox, FormDropdownList } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { KeyedList, LabelValueMapEditor } from "profileEditorGroups.jsx"
import { DayjsRulePicker } from "dayjsRulePicker.jsx"
import { ColorPicker } from "ColorPicker.jsx"

const typeOptions = [
    { key: "label", title: "By Label Value" },
    { key: "dayjs", title: "By Date" }
]

function newVariant() {
    return { name: "New Color", type: "label", label: "", children: {} }
}

function newInterval() {
    return { rule: ["isNull"], color: "gray" }
}

function VariantEditor({ variant, onChange }) {
    function setType(newType) {
        if (newType === variant.type) return
        // Same reset-on-type-switch reasoning as PrefixesEditor: label vs.
        // dayjs variants store data in incompatible shapes (children map vs.
        // intervals map).
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
                        defaultValue="gray"
                        renderValue={(value, update) => (
                            <ColorPicker currentValue={value} onChange={update} />
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
                                <ColorPicker
                                    currentValue={interval.color}
                                    onChange={c => update({ ...interval, color: c })}
                                />
                            </div>
                        )}
                    />
                </>
            )}
        </div>
    )
}

export function ColorsEditor({ colors, onChange }) {
    const selectedOptions = Object.entries(colors.children).map(([key, v]) => ({ key, title: v.name }))
    return (
        <Collapsible
            label="Colors"
            expanded={colors.expanded}
            onToggle={e => onChange({ ...colors, expanded: e.currentTarget.open })}
            className="pe-section"
        >
            <FormDropdownList
                values={selectedOptions}
                currentValue={colors.selected}
                onChange={selected => onChange({ ...colors, selected })}
                keyProperty="key" titleProperty="title"
            />
            <KeyedList
                items={colors.children}
                onChange={children => onChange({ ...colors, children })}
                newItemFactory={newVariant}
                addLabel="Add Color Variant"
                renderItem={(key, variant, update) => <VariantEditor variant={variant} onChange={update} />}
            />
        </Collapsible>
    )
}
