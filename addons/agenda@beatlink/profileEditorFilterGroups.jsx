import { FormTextBox, FormCheckbox, FormDropdownList, useState } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { TreeList, generateKey, usedElementIds, mergeElementSubset } from "profileEditorGroups.jsx"
import { ElementSelect, firstElementId } from "elementPicker.jsx"

const filterTypeOptions = [
    { key: "search", title: "Search Query" },
    { key: "dayjs", title: "Date Comparison" }
]

function newGroup() {
    return { name: "New Filter", expanded: true, children: {} }
}

function newFilterElement() {
    return { name: "New Filter", type: "search", rule: "" }
}

// A usage's fields: which shared filter element it points at, whether it's
// enabled, and — since element definitions are folded into the groups tree
// rather than living in a separate library list — the element's own Type/
// Rule/Date Rule, editable right here. Editing those writes through to the
// shared `filters` registry (every other usage of the same element sees the
// change immediately), while Filter/Enabled only ever touch this usage.
function usageColumns({ filters, dateRules, onChangeFilters }) {
    function updateElement(elementId, patch) {
        onChangeFilters({ ...filters, [elementId]: { ...(filters[elementId] || {}), ...patch } })
    }

    function setType(elementId, element, newType) {
        if (newType === element.type) return
        updateElement(elementId, {
            type: newType,
            ...(newType === "dayjs"
                ? { dateRuleId: firstElementId({ dateRules }, "dateRules") }
                : { rule: "" })
        })
    }

    return [
        { label: "Filter", render: (usage, update) => (
            <ElementSelect
                category="filters"
                registry={{ filters }}
                value={usage.elementId}
                onChange={elementId => update({ ...usage, elementId })}
            />
        ) },
        { label: "Enabled", render: (usage, update) => (
            <FormCheckbox currentValue={usage.enabled} onChange={v => update({ ...usage, enabled: v })} />
        ) },
        { label: "Type", render: (usage) => filters[usage.elementId] ? (
            <FormDropdownList
                values={filterTypeOptions}
                currentValue={filters[usage.elementId].type}
                onChange={newType => setType(usage.elementId, filters[usage.elementId], newType)}
                keyProperty="key" titleProperty="title"
            />
        ) : null },
        { label: "Search Rule", render: (usage) => filters[usage.elementId]?.type === "search" ? (
            <FormTextBox
                currentValue={filters[usage.elementId].rule}
                onChange={v => updateElement(usage.elementId, { rule: v })}
            />
        ) : null },
        { label: "Date Rule", render: (usage) => filters[usage.elementId]?.type === "dayjs" ? (
            <ElementSelect
                category="dateRules"
                registry={{ dateRules }}
                value={filters[usage.elementId].dateRuleId}
                onChange={dateRuleId => updateElement(usage.elementId, { dateRuleId })}
            />
        ) : null }
    ]
}

function FilterGroupBody({ group, filters, dateRules, onChangeFilters, onChange }) {
    function newUsage() {
        const elementId = generateKey()
        onChangeFilters({ ...filters, [elementId]: newFilterElement() })
        return { elementId, enabled: true }
    }

    return (
        <>
            <FormTextBox currentValue={group.name} onChange={v => onChange({ ...group, name: v })} />
            <TreeList
                items={group.children}
                onChange={children => onChange({ ...group, children })}
                newItemFactory={newUsage}
                addLabel="Add Rule"
                getLabel={usage => filters[usage.elementId]?.name || "New Filter"}
                columns={usageColumns({ filters, dateRules, onChangeFilters })}
            />
        </>
    )
}

// Lives on the Filters tab. Every filter a profile can use is folded into
// this tree: each group holds its usages, and each usage's own fields are
// the actual shared filter element's Type/Rule/Date Rule — there's no
// separate flat "library" list to jump to. An element not currently
// referenced by any usage would otherwise be unreachable, so it falls into
// "Ungrouped Filters" below instead, still editable/removable there.
export function FilterGroupsEditor({ filterGroups, filters, dateRules, onChangeGroups, onChangeFilters }) {
    const [ungroupedExpanded, setUngroupedExpanded] = useState(false)
    const usedIds = usedElementIds(filterGroups)
    const ungrouped = Object.fromEntries(Object.entries(filters).filter(([id]) => !usedIds.has(id)))

    function setType(element, update, newType) {
        if (newType === element.type) return
        update({
            ...element,
            type: newType,
            ...(newType === "dayjs"
                ? { dateRuleId: firstElementId({ dateRules }, "dateRules") }
                : { rule: "" })
        })
    }

    return (
        <div className="pe-list">
            <Collapsible
                label="Filter Groups"
                expanded={filterGroups.expanded}
                onToggle={e => onChangeGroups({ ...filterGroups, expanded: e.currentTarget.open })}
                className="pe-section"
            >
                <TreeList
                    items={filterGroups.children}
                    onChange={children => onChangeGroups({ ...filterGroups, children })}
                    newItemFactory={newGroup}
                    addLabel="Add Filter Group"
                    getLabel={group => group.name}
                    renderItem={(key, group, update) => (
                        <FilterGroupBody
                            group={group}
                            filters={filters}
                            dateRules={dateRules}
                            onChangeFilters={onChangeFilters}
                            onChange={update}
                        />
                    )}
                />
            </Collapsible>
            <Collapsible
                label={`Ungrouped Filters (${Object.keys(ungrouped).length})`}
                expanded={ungroupedExpanded}
                onToggle={e => setUngroupedExpanded(e.currentTarget.open)}
                className="pe-section"
            >
                <TreeList
                    items={ungrouped}
                    onChange={newSubset => onChangeFilters(mergeElementSubset(filters, ungrouped, newSubset))}
                    newItemFactory={newFilterElement}
                    addLabel="Add Filter"
                    getLabel={element => element.name}
                    columns={[
                        { label: "Name", render: (element, update) => (
                            <FormTextBox currentValue={element.name} onChange={v => update({ ...element, name: v })} />
                        ) },
                        { label: "Type", render: (element, update) => (
                            <FormDropdownList
                                values={filterTypeOptions}
                                currentValue={element.type}
                                onChange={newType => setType(element, update, newType)}
                                keyProperty="key" titleProperty="title"
                            />
                        ) },
                        { label: "Search Rule", render: (element, update) => element.type === "search" ? (
                            <FormTextBox currentValue={element.rule} onChange={v => update({ ...element, rule: v })} />
                        ) : null },
                        { label: "Date Rule", render: (element, update) => element.type === "dayjs" ? (
                            <ElementSelect
                                category="dateRules"
                                registry={{ dateRules }}
                                value={element.dateRuleId}
                                onChange={dateRuleId => update({ ...element, dateRuleId })}
                            />
                        ) : null }
                    ]}
                />
            </Collapsible>
        </div>
    )
}
