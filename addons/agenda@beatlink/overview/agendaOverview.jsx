import {
    FormDropdownList,
    Button,
    defineWidget,
    RightPanelWidget,
    useActiveNoteContext,
    useNoteProperty,
    useEffect,
    useState
} from "trilium:preact"

import { Collapsible } from "Collapsible.jsx"
import { FormCheckboxGroup } from "FormCheckboxGroup.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { saveProfile, loadData, updateTaskLists, getMatchingProfile, getAllProfiles, setActiveProfile, rescheduleAllTasks, getSectionState, saveSectionState } = require("libAgendaOverview.js")
const { subscribe } = require("libIpc.js")

// Trilium collection view types the overview note can be set to. Keep in sync
// with the `viewType` field's options in schema.json.
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

// Preact Components ------------------------------------------------------

// A group's `children` fully embed their own search/filter (name/rule/
// enabled, or name/type/rule-or-dateRuleId/enabled) — no separate registry
// to resolve a display name against.
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
            expanded={section.expanded}
            onToggle={e => update(p => {
                sectionPath.reduce((o,k)=>o[k], p).expanded = e.currentTarget.open
            })}
            className="mainSection"
        >
            {Object.entries(section.children || {}).map(([groupKey, group]) => (
                <FormCheckboxGroup
                    label={group.name}
                    expanded={group.expanded}
                    onToggle={e => update(p => {
                        sectionPath
                          .concat(["children", groupKey])
                          .reduce((o,k)=>o[k], p)
                          .expanded = e.currentTarget.open
                    })}
                    items={Object.entries(group.children || {}).map(
                        ([itemKey, usage]) => ({
                            key: itemKey,
                            label: usage.name,
                            currentValue: usage.enabled,
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
    // Per-profile collapse state for the dropdown sections (Sort/Prefix/Color),
    // persisted in the config note's `sectionState` map (see libAgendaOverview).
    const [sectionState, setSectionState] = useState({})

    // Resolve this widget's own relations + settings once — separate from
    // `noteId` above, which is whichever note the user is currently browsing
    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            if (!settings) return
            const { constants, profileContext, icalNoteId } = settings
            setIds({ constants, profileContext, icalNoteId })
        })()
    }, [])

    // Update / Save Profile
    const update = (fn) => {
        const newProfile = structuredClone(profile)
        fn(newProfile)
        setProfile(newProfile)
        setProfiles(ps => (ps || []).map(p => p.id === newProfile.id ? newProfile : p))
        saveProfile(newProfile)
        updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
    }

    // Switch which profile is active: persist `activeProfileId`, update local
    // state, and re-populate the shared overview note for the new profile.
    // Keeps `ids.profileContext` in sync so subsequent updates (e.g. editing a
    // section) file the profile just selected, and threads the new id straight
    // into the updateTaskLists call rather than relying on that state landing.
    const switchProfile = async (id) => {
        setProfileId(id)
        await setActiveProfile(ids.profileContext, id)
        ids.profileContext.activeProfileId = id
        await updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
    }

    // The widget only appears while browsing the single shared overview note;
    // on any other note it renders nothing. When shown, `getMatchingProfile`
    // returns the active profile, which seeds the initial dropdown pick; the
    // dropdown then lets the user switch the active profile.
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

    // A task mutation happened elsewhere (e.g. the Agenda Task widget completed
    // or rescheduled a task, broadcasting agenda:tasksChanged over libipc).
    // This widget owns the profile context and iCal note, so it is the one
    // that re-files the overview note in response — the Task widget itself has
    // no dependency on libAgendaOverview. Only active while the overview note
    // is shown (ids + a matched profile), and torn down via the returned
    // unsubscribe.
    useEffect(() => {
        if (!ids || !profile) return
        return subscribe("agenda:tasksChanged", () => {
            updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
        })
    }, [ids, profile])

    // Load the selected profile's editable object whenever the dropdown pick
    // (or the underlying profile list) changes.
    useEffect(() => {
        if (!profiles || !profileId) return
        setProfile(profiles.find(p => p.id === profileId) || null)
    }, [profileId, profiles])

    // Load the selected profile's persisted section collapse state.
    useEffect(() => {
        if (!ids || !profileId) return
        (async () => {
            setSectionState(await getSectionState(ids.profileContext, profileId) || {})
        })()
    }, [profileId, ids])

    // Toggle + persist a dropdown section's collapse state (defaults open).
    const toggleSection = (key) => (e) => {
        const next = { ...sectionState, [key]: e.currentTarget.open }
        setSectionState(next)
        saveSectionState(ids.profileContext, profileId, next)
    }

    // No profile claims the browsed note -> the widget doesn't appear at all.
    if (!profile || !registry){
        return null
    }

    return (
        <RightPanelWidget title="Agenda">
            <div id="x-agenda-overview-widget" className="agenda-widget">

                {/* Active profile selector — switches which profile populates
                    the shared overview note (persisted as activeProfileId) */}
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

                {/* Collection View — sets the overview note's #viewType, so
                    it renders as the chosen built-in Trilium collection view */}
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

                {/* Board Columns — only meaningful for the board view, where
                    the picked grouping's field drives the built-in board's
                    columns (#board:groupBy). Sits right under Collection View. */}
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
                    registryKey="sorts"
                    registry={registry}
                    profile={profile}
                    update={update}
                    expanded={sectionState.sorts !== false}
                    onToggle={toggleSection("sorts")}
                />

                {/* Prefixes */}
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


                {/* Colors */}
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
