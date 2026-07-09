import { FormTextBox } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { KeyedList } from "profileEditorGroups.jsx"
import { ElementUsageRow, firstElementId } from "elementPicker.jsx"

function newFilterGroup() {
    return { name: "New Filter", expanded: true, children: {} }
}

function FilterGroupEditor({ group, registry, onChange }) {
    return (
        <Collapsible
            label={group.name}
            expanded={group.expanded}
            onToggle={e => onChange({ ...group, expanded: e.currentTarget.open })}
            className="pe-group"
        >
            <FormTextBox currentValue={group.name} onChange={v => onChange({ ...group, name: v })} />
            <KeyedList
                items={group.children}
                onChange={children => onChange({ ...group, children })}
                newItemFactory={() => ({ elementId: firstElementId(registry, "filters"), enabled: true })}
                addLabel="Add Rule"
                renderItem={(key, usage, update) => (
                    <ElementUsageRow
                        usage={usage}
                        category="filters"
                        registry={registry}
                        onChange={update}
                    />
                )}
            />
        </Collapsible>
    )
}

// Lives on the Filters tab, alongside the shared filter element library it
// picks from, rather than on the Profile tab — keeping "which filters
// exist" and "how they're grouped for this profile" on one screen.
export function FilterGroupsEditor({ filterGroups, registry, onChange }) {
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
                renderItem={(key, group, update) => (
                    <FilterGroupEditor group={group} registry={registry} onChange={update} />
                )}
            />
        </Collapsible>
    )
}
