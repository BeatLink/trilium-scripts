import { FormTextBox, FormCheckbox } from "trilium:preact"
import { Collapsible } from "Collapsible.jsx"
import { KeyedList } from "profileEditorGroups.jsx"

function newSearch() {
    return { name: "New Search", rule: "", enabled: true }
}

function newGroup() {
    return { name: "New Group", expanded: true, children: {} }
}

function SearchRow({ search, onChange }) {
    return (
        <div className="pe-field-row">
            <FormTextBox currentValue={search.name} onChange={v => onChange({ ...search, name: v })} />
            <FormTextBox currentValue={search.rule} onChange={v => onChange({ ...search, rule: v })} />
            <FormCheckbox label="Enabled" currentValue={search.enabled} onChange={v => onChange({ ...search, enabled: v })} />
        </div>
    )
}

function SearchGroupEditor({ group, onChange }) {
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
                newItemFactory={newSearch}
                addLabel="Add Search"
                renderItem={(key, search, update) => <SearchRow search={search} onChange={update} />}
            />
        </Collapsible>
    )
}

export function SearchGroupsEditor({ searchGroups, onChange }) {
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
                renderItem={(key, group, update) => <SearchGroupEditor group={group} onChange={update} />}
            />
        </Collapsible>
    )
}
