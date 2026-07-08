import { FormTextBox } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { KeyedList } from "profileEditorGroups.jsx"
import { ElementUsageRow, firstElementId } from "elementPicker.jsx"

function newGroup() {
    return { name: "New Group", expanded: true, children: {} }
}

function SearchGroupEditor({ group, registry, onChange, onOpenLibrary }) {
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
                newItemFactory={() => ({ elementId: firstElementId(registry, "searches"), enabled: true })}
                addLabel="Add Search"
                renderItem={(key, usage, update) => (
                    <ElementUsageRow
                        usage={usage}
                        category="searches"
                        registry={registry}
                        onChange={update}
                        onOpenLibrary={onOpenLibrary}
                    />
                )}
            />
        </Collapsible>
    )
}

export function SearchGroupsEditor({ searchGroups, registry, onChange, onOpenLibrary }) {
    return (
        <Collapsible
            label="Search Groups"
            expanded={searchGroups.expanded}
            onToggle={e => onChange({ ...searchGroups, expanded: e.currentTarget.open })}
            className="pe-section"
        >
            <KeyedList
                items={searchGroups.children}
                onChange={children => onChange({ ...searchGroups, children })}
                newItemFactory={newGroup}
                addLabel="Add Group"
                renderItem={(key, group, update) => (
                    <SearchGroupEditor group={group} registry={registry} onChange={update} onOpenLibrary={onOpenLibrary} />
                )}
            />
        </Collapsible>
    )
}
