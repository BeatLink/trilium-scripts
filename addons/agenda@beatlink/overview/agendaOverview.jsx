import {
    FormDropdownList,
    FormCheckbox,
    Button,
    defineWidget,
    RightPanelWidget,
    useActiveNoteContext,
    useNoteProperty,
    useEffect,
    useState,
    useTriliumEvent
} from "trilium:preact"

import { Collapsible } from "Collapsible.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { saveProfile, loadData, updateTaskLists, getMatchingProfile, getAllProfiles, setActiveProfile, rescheduleAllTasks, getSectionState, saveSectionState } = require("libAgendaOverview.js")

const VIEW_TYPES = [
    { key: "list", title: "List" },
    { key: "grid", title: "Grid" },
    { key: "table", title: "Table" },
    { key: "board", title: "Board" },
    { key: "calendar", title: "Calendar" },
    { key: "geoMap", title: "Geo Map" },
    { key: "dashboard", title: "Dashboard" },
    { key: "presentation", title: "Presentation" }
]

function CheckboxSection({
    sectionPath,
    stateKey,
    title,
    profile,
    update,
    sectionState,
    toggleSection
}) {
    const section = sectionPath.reduce((o, k) => o[k], profile)

    return (
        <Collapsible
            label={title}
            expanded={sectionState[stateKey] !== false}
            onToggle={toggleSection(stateKey)}
            className="mainSection"
        >
            {Object.entries(section.children || {}).map(([groupKey, group]) => (
                <Collapsible
                    label={group.name}
                    expanded={sectionState[`${stateKey}:${groupKey}`] === true}
                    onToggle={toggleSection(`${stateKey}:${groupKey}`)}
                    className="checkboxGroup"
                >
                    <ul>{Object.entries(group.children || {}).map(([itemKey, usage]) => (
                        <FormCheckbox
                            key={itemKey}
                            label={usage.name}
                            currentValue={usage.enabled}
                            onChange={checked =>
                                update(p => {
                                    sectionPath
                                      .concat(["children", groupKey, "children", itemKey])
                                      .reduce((o,k)=>o[k], p)
                                      .enabled = checked
                                })
                            }
                        />
                    ))}</ul>
                </Collapsible>
            ))}
        </Collapsible>
    )
}

function DropdownSection({
    sectionPath,
    title,
    registryKey,
    registry,
    profile,
    update,
    expanded,
    onToggle
}) {
    const section = sectionPath.reduce((o,k)=>o[k], profile)

    return (
        <Collapsible
            label={title}
            expanded={expanded}
            onToggle={onToggle}
            className="mainSection"
        >
            <FormDropdownList
                values={Object.entries(registry[registryKey])
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
    const [profiles, setProfiles] = useState(null)
    const [profileId, setProfileId] = useState(null)
    const [registry, setRegistry] = useState(null)
    const [ids, setIds] = useState(null)
    const [sectionState, setSectionState] = useState({})

    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            if (!settings) return
            const { constants, profileContext, icalNoteId } = settings
            setIds({ constants, profileContext, icalNoteId })
        })()
    }, [])

    const update = (fn) => {
        const newProfile = structuredClone(profile)
        fn(newProfile)
        setProfile(newProfile)
        setProfiles(ps => (ps || []).map(p => p.id === newProfile.id ? newProfile : p))
        saveProfile(newProfile)
        updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
    }

    const switchProfile = async (id) => {
        setProfileId(id)
        await setActiveProfile(ids.profileContext, id)
        ids.profileContext.activeProfileId = id
        await updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
    }

    useEffect(() => {
        if (!ids || !noteId) return
        (async () => {
            const active = await getMatchingProfile(ids.profileContext, noteId)
            if (!active) {
                setProfiles(null)
                setProfile(null)
                setProfileId(null)
                return
            }
            const data = await loadData(ids.profileContext.schemaNoteId, ids.profileContext.configNoteId)
            setRegistry(data)
            const allProfiles = await getAllProfiles(ids.profileContext)
            setProfiles(allProfiles)
            setProfileId(active.id)
            await updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
        })()
    }, [noteId, ids])

    useTriliumEvent("agenda:tasksChanged", () => {
        if (!ids) return
        updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
    })

    useEffect(() => {
        if (!profiles || !profileId) return
        setProfile(profiles.find(p => p.id === profileId) || null)
    }, [profileId, profiles])

    useEffect(() => {
        if (!ids || !profileId) return
        (async () => {
            setSectionState(await getSectionState(ids.profileContext, profileId) || {})
        })()
    }, [profileId, ids])

    const toggleSection = (key) => (e) => {
        const next = { ...sectionState, [key]: e.currentTarget.open }
        setSectionState(next)
        saveSectionState(ids.profileContext, profileId, next)
    }

    if (!profile || !registry){
        return null
    }

    return (
        <RightPanelWidget title="Agenda">
            <div id="x-agenda-overview-widget" className="agenda-widget">

                {profiles && profiles.length > 1 && (
                    <div className="agenda-profile-selector">
                        <label>Profile</label>
                        <FormDropdownList
                            values={profiles.map(p => ({ key: p.id, title: p.name }))}
                            currentValue={profileId}
                            onChange={switchProfile}
                            keyProperty="key"
                            titleProperty="title"
                            class="dropdown-component form-control"
                        />
                    </div>
                )}

                <div className="agenda-viewtype-selector">
                    <label>Collection View</label>
                    <FormDropdownList
                        values={VIEW_TYPES}
                        currentValue={profile.viewType || "list"}
                        onChange={value => update(p => { p.viewType = value })}
                        keyProperty="key"
                        titleProperty="title"
                        class="dropdown-component form-control"
                    />
                </div>

                {profile.viewType === "board" && (
                    <DropdownSection
                        title="Board Columns"
                        sectionPath={["groupings"]}
                        registryKey="groupings"
                        registry={registry}
                        profile={profile}
                        update={update}
                        expanded={sectionState.groupings !== false}
                        onToggle={toggleSection("groupings")}
                    />
                )}

                <CheckboxSection
                    title="Searches"
                    sectionPath={["searchGroups"]}
                    stateKey="searchGroups"
                    profile={profile}
                    update={update}
                    sectionState={sectionState}
                    toggleSection={toggleSection}
                />

                <CheckboxSection
                    title="Filters"
                    sectionPath={["filterGroups"]}
                    stateKey="filterGroups"
                    profile={profile}
                    update={update}
                    sectionState={sectionState}
                    toggleSection={toggleSection}
                />

                <DropdownSection
                    title="Sort Order"
                    sectionPath={["sorts"]}
                    registryKey="sorts"
                    registry={registry}
                    profile={profile}
                    update={update}
                    expanded={sectionState.sorts !== false}
                    onToggle={toggleSection("sorts")}
                />

                <DropdownSection
                    title="Prefix"
                    sectionPath={["prefixes"]}
                    registryKey="prefixes"
                    registry={registry}
                    profile={profile}
                    update={update}
                    expanded={sectionState.prefixes !== false}
                    onToggle={toggleSection("prefixes")}
                />

                <DropdownSection
                    title="Color"
                    sectionPath={["colors"]}
                    registryKey="colors"
                    registry={registry}
                    profile={profile}
                    update={update}
                    expanded={sectionState.colors !== false}
                    onToggle={toggleSection("colors")}
                />

                <div>
                    <label>Actions</label>
                    <div>
                        <Button
                            icon="bx bx-rocket"
                            text="Start All Tasks Today"
                            onClick={e => { rescheduleAllTasks(ids.profileContext, ids.constants, ids.icalNoteId) }}
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
