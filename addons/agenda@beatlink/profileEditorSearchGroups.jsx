import { FormTextBox, FormCheckbox, useState } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { TreeList, generateKey, usedElementIds, mergeElementSubset } from "profileEditorGroups.jsx"
import { ElementSelect } from "elementPicker.jsx"

function newGroup() {
    return { name: "New Group", expanded: true, children: {} }
}

function newSearchElement() {
    return { name: "New Search", rule: "" }
}

// A usage's fields: which shared search element it points at, whether it's
// enabled, and — since element definitions are folded into the groups tree
// rather than living in a separate library list — the element's own Name/
// Search Rule, editable right here. Editing Name/Rule writes through to the
// shared `searches` registry (every other usage of the same element sees
// the change immediately), while Search/Enabled only ever touch this usage.
function usageColumns({ searches, onChangeSearches }) {
    function updateElement(elementId, patch) {
        onChangeSearches({ ...searches, [elementId]: { ...(searches[elementId] || {}), ...patch } })
    }

    return [
        { label: "Search", render: (usage, update) => (
            <ElementSelect
                category="searches"
                registry={{ searches }}
                value={usage.elementId}
                onChange={elementId => update({ ...usage, elementId })}
            />
        ) },
        { label: "Enabled", render: (usage, update) => (
            <FormCheckbox currentValue={usage.enabled} onChange={v => update({ ...usage, enabled: v })} />
        ) },
        { label: "Name", render: (usage) => searches[usage.elementId] ? (
            <FormTextBox
                currentValue={searches[usage.elementId].name}
                onChange={v => updateElement(usage.elementId, { name: v })}
            />
        ) : null },
        { label: "Search Rule", render: (usage) => searches[usage.elementId] ? (
            <FormTextBox
                currentValue={searches[usage.elementId].rule}
                onChange={v => updateElement(usage.elementId, { rule: v })}
            />
        ) : null }
    ]
}

function SearchGroupBody({ group, searches, onChangeSearches, onChange }) {
    function newUsage() {
        const elementId = generateKey()
        onChangeSearches({ ...searches, [elementId]: newSearchElement() })
        return { elementId, enabled: true }
    }

    return (
        <>
            <FormTextBox currentValue={group.name} onChange={v => onChange({ ...group, name: v })} />
            <TreeList
                items={group.children}
                onChange={children => onChange({ ...group, children })}
                newItemFactory={newUsage}
                addLabel="Add Search"
                getLabel={usage => searches[usage.elementId]?.name || "New Search"}
                columns={usageColumns({ searches, onChangeSearches })}
            />
        </>
    )
}

// Lives on the Searches tab. Every search a profile can use is folded into
// this tree: each group holds its usages, and each usage's own fields are
// the actual shared search element's Name/Rule — there's no separate flat
// "library" list to jump to. An element not currently referenced by any
// usage would otherwise be unreachable, so it falls into "Ungrouped
// Searches" below instead, still editable/removable there.
export function SearchGroupsEditor({ searchGroups, searches, onChangeGroups, onChangeSearches }) {
    const [ungroupedExpanded, setUngroupedExpanded] = useState(false)
    const usedIds = usedElementIds(searchGroups)
    const ungrouped = Object.fromEntries(Object.entries(searches).filter(([id]) => !usedIds.has(id)))

    return (
        <div className="pe-list">
            <Collapsible
                label="Search Groups"
                expanded={searchGroups.expanded}
                onToggle={e => onChangeGroups({ ...searchGroups, expanded: e.currentTarget.open })}
                className="pe-section"
            >
                <TreeList
                    items={searchGroups.children}
                    onChange={children => onChangeGroups({ ...searchGroups, children })}
                    newItemFactory={newGroup}
                    addLabel="Add Group"
                    getLabel={group => group.name}
                    renderItem={(key, group, update) => (
                        <SearchGroupBody
                            group={group}
                            searches={searches}
                            onChangeSearches={onChangeSearches}
                            onChange={update}
                        />
                    )}
                />
            </Collapsible>
            <Collapsible
                label={`Ungrouped Searches (${Object.keys(ungrouped).length})`}
                expanded={ungroupedExpanded}
                onToggle={e => setUngroupedExpanded(e.currentTarget.open)}
                className="pe-section"
            >
                <TreeList
                    items={ungrouped}
                    onChange={newSubset => onChangeSearches(mergeElementSubset(searches, ungrouped, newSubset))}
                    newItemFactory={newSearchElement}
                    addLabel="Add Search"
                    getLabel={element => element.name}
                    columns={[
                        { label: "Name", render: (element, update) => (
                            <FormTextBox currentValue={element.name} onChange={v => update({ ...element, name: v })} />
                        ) },
                        { label: "Search Rule", render: (element, update) => (
                            <FormTextBox currentValue={element.rule} onChange={v => update({ ...element, rule: v })} />
                        ) }
                    ]}
                />
            </Collapsible>
        </div>
    )
}
