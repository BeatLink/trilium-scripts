import { FormTextBox, FormCheckbox, FormDropdownList } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { KeyedList } from "profileEditorGroups.jsx"
import { DayjsRulePicker } from "dayjsRulePicker.jsx"

const typeOptions = [
    { key: "search", title: "Search Query" },
    { key: "dayjs", title: "Date Comparison" }
]

function newFilterGroup() {
    return { name: "New Filter", expanded: true, type: "search", children: {} }
}

function newFilterChild(groupType) {
    return groupType === "dayjs"
        ? { name: "New Rule", enabled: true, rule: ["isNull"] }
        : { name: "New Rule", enabled: true, rule: "" }
}

function FilterRow({ filter, groupType, onChange }) {
    return (
        <div className="pe-field-row">
            <FormTextBox currentValue={filter.name} onChange={v => onChange({ ...filter, name: v })} />
            {groupType === "dayjs" ? (
                <DayjsRulePicker value={filter.rule} onChange={rule => onChange({ ...filter, rule })} />
            ) : (
                <FormTextBox currentValue={filter.rule} onChange={v => onChange({ ...filter, rule: v })} />
            )}
            <FormCheckbox label="Enabled" currentValue={filter.enabled} onChange={v => onChange({ ...filter, enabled: v })} />
        </div>
    )
}

function FilterGroupEditor({ group, onChange }) {
    function setType(newType) {
        if (newType === group.type) return
        // A search-typed child's rule is a string; a dayjs-typed child's
        // rule is an array — the two can't coexist, so switching type clears
        // existing children rather than leaving stale, wrongly-shaped rules.
        onChange({
            ...group,
            type: newType,
            children: {},
            ...(newType === "dayjs"
                ? { datetimeLabel: group.datetimeLabel || "", useNumberOfDays: group.useNumberOfDays || false }
                : {})
        })
    }

    return (
        <Collapsible
            label={group.name}
            expanded={group.expanded}
            onToggle={e => onChange({ ...group, expanded: e.currentTarget.open })}
            className="pe-group"
        >
            <FormTextBox currentValue={group.name} onChange={v => onChange({ ...group, name: v })} />
            <FormDropdownList
                values={typeOptions}
                currentValue={group.type}
                onChange={setType}
                keyProperty="key" titleProperty="title"
            />
            {group.type === "dayjs" && (
                <>
                    <FormTextBox
                        currentValue={group.datetimeLabel || ""}
                        onChange={v => onChange({ ...group, datetimeLabel: v })}
                    />
                    <FormCheckbox
                        label="Use Number of Days"
                        currentValue={!!group.useNumberOfDays}
                        onChange={v => onChange({ ...group, useNumberOfDays: v })}
                    />
                </>
            )}
            <KeyedList
                items={group.children}
                onChange={children => onChange({ ...group, children })}
                newItemFactory={() => newFilterChild(group.type)}
                addLabel="Add Rule"
                renderItem={(key, filter, update) => (
                    <FilterRow filter={filter} groupType={group.type} onChange={update} />
                )}
            />
        </Collapsible>
    )
}

export function FilterGroupsEditor({ filterGroups, onChange }) {
    return (
        <Collapsible
            label="Filter Groups"
            expanded={filterGroups.expanded}
            onToggle={e => onChange({ ...filterGroups, expanded: e.currentTarget.open })}
            className="pe-section"
        >
            <KeyedList
                items={filterGroups.children}
                onChange={children => onChange({ ...filterGroups, children })}
                newItemFactory={newFilterGroup}
                addLabel="Add Filter Group"
                renderItem={(key, group, update) => <FilterGroupEditor group={group} onChange={update} />}
            />
        </Collapsible>
    )
}
