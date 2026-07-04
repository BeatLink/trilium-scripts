

import { 
    FormGroup,
    FormDropdownList,
    FormCheckbox,
    Button,
    defineWidget,
    RightPanelWidget,
    useActiveNoteContext,
    useNoteProperty,
    useEffect,
    useState
} from "trilium:preact"

import { 
    searchForNotes,
    getActiveContextNote,
    currentNote,
    log
} from "trilium:api"

const { Collapsible } = libAgendajsx
const {
    overview: {
        saveProfile,
        updateTaskLists,
        getMatchingProfile,
        sendNotificationForDueTasks,
        rescheduleAllTasks
    }
} = require("libAgenda.js")


// Core Functions --------------------------------------------------------


// Preact Components ------------------------------------------------------
function CheckboxGroup({id, label, expanded, onToggle, items}) {
    return (
        <Collapsible
            label={label}
            collapsible={true}
            expanded={expanded}
            onToggle={onToggle}
            className="checkboxGroup"
        >
            <ul>{
                items.map(item => 
                    (<FormCheckbox
                        key={item.key}
                        label={item.label}
                        currentValue={item.currentValue}
                        onChange={item.onChange} 
                    />)
                )
            }</ul>
        </Collapsible>
    )
}

function CheckboxSection({
    sectionPath,   // e.g. ["searchGroups"]
    title,
    profile,
    update
}) {
    const section = sectionPath.reduce((o, k) => o[k], profile)

    return (
        <Collapsible
            label={title}
            collapsible={true}
            expanded={section.expanded}
            onToggle={e => update(p => {
                sectionPath.reduce((o,k)=>o[k], p).expanded = e.currentTarget.open
            })}
            className="mainSection"
        >
            {Object.entries(section.children || {}).map(([groupKey, group]) => (
                <CheckboxGroup
                    key={groupKey}
                    label={group.name}
                    expanded={group.expanded}
                    onToggle={e => update(p => {
                        sectionPath
                          .concat(["children", groupKey])
                          .reduce((o,k)=>o[k], p)
                          .expanded = e.currentTarget.open
                    })}
                    items={Object.entries(group.children || {}).map(
                        ([itemKey, item]) => ({
                            key: itemKey,
                            label: item.name,
                            currentValue: item.enabled,
                            onChange: checked =>
                                update(p => {
                                    sectionPath
                                      .concat(["children", groupKey, "children", itemKey])
                                      .reduce((o,k)=>o[k], p)
                                      .enabled = checked
                                })
                        })
                    )}
                />
            ))}
        </Collapsible>
    )
}

function DropdownSection({
    sectionPath,
    title,
    profile,
    update
}) {
    const section = sectionPath.reduce((o,k)=>o[k], profile)

    return (
        <Collapsible
            label={title}
            collapsible={true}
            expanded={section.expanded}
            onToggle={e => update(p => {
                sectionPath.reduce((o,k)=>o[k], p).expanded = e.currentTarget.open
            })}
            className="mainSection"
        >
            <FormDropdownList
                values={Object.entries(section["children"])
                    .map(([key, value]) => ({
                        key,
                        title: value.name
                    }))
                }
                currentValue={section.selected}
                onChange={value =>
                    update(p =>
                        sectionPath.reduce((o,k)=>o[k], p).selected = value
                    )
                }
                keyProperty="key"
                titleProperty="title"
                class="dropdown-component form-control"
            />
        </Collapsible>
    )
}

function AgendaOverviewWidgetJSX() {
    const { note } = useActiveNoteContext()
    const noteId = useNoteProperty(note, "noteId")
    const [profile, setProfile] = useState(null)

    // Update / Save Profile
    const update = (fn) => {
        const newProfile = structuredClone(profile)
        fn(newProfile)
        setProfile(newProfile)
        saveProfile(newProfile)
        updateTaskLists()
    }

    // Load Profile
    useEffect(() => {
        async function loadProfile() {
            const profileData = await getMatchingProfile(noteId)
            setProfile(profileData)
            await updateTaskLists()
        }
        loadProfile()
    }, [noteId])


    if (!profile){
        return null
    }

    return (
        <RightPanelWidget title="Agenda">
            <div id="x-agenda-overview-widget" className="agenda-widget">

                {/* Search */}
                <CheckboxSection
                    title="Searches"
                    sectionPath={["searchGroups"]}
                    profile={profile}
                    update={update}
                />
                
                {/* Filters */}
                <CheckboxSection
                    title="Filters"
                    sectionPath={["filterGroups"]}
                    profile={profile}
                    update={update}
                />

                
                {/* Sort Order */}
                <DropdownSection
                    title="Sort Order"
                    sectionPath={["sorts"]}
                    profile={profile}
                    update={update}
                />

                {/* Prefixes */}
                <DropdownSection
                    title="Prefix"
                    sectionPath={["prefixes"]}
                    profile={profile}
                    update={update}
                />


                {/* Colors */}
                <DropdownSection
                    title="Color"
                    sectionPath={["colors"]}
                    profile={profile}
                    update={update}
                />
                <div>
                    <label>Actions</label>
                    <div>
                        <Button
                            icon="bx bx-rocket"
                            text="Start All Tasks Today"
                            onClick={e => {rescheduleAllTasks()}}
                        />
                    </div>
                </div>
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 3,
    render: AgendaOverviewWidgetJSX
})
