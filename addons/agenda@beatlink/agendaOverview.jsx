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

import { startNote } from "trilium:api"

import { Collapsible } from "Collapsible.jsx"
import { FormCheckboxGroup } from "FormCheckboxGroup.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { saveProfile, loadData, updateTaskLists, getMatchingProfile, getAllProfiles, rescheduleAllTasks } = require("libAgendaOverview.js")

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
    update
}) {
    const section = sectionPath.reduce((o,k)=>o[k], profile)

    return (
        <Collapsible
            label={title}
            expanded={true}
            onToggle={() => {}}
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

    // Resolve this widget's own relations + settings once — separate from
    // `noteId` above, which is whichever note the user is currently browsing
    useEffect(() => {
        (async () => {
            const { constants, profileContext } = await getAgendaSettings()
            const icalNoteId = await startNote.getRelationValue("icalNote")
            const taskViewNoteId = await startNote.getRelationValue("taskViewRenderNote")
            setIds({ constants, profileContext, icalNoteId, taskViewNoteId })
        })()
    }, [])

    // Update / Save Profile
    const update = (fn) => {
        const newProfile = structuredClone(profile)
        fn(newProfile)
        setProfile(newProfile)
        setProfiles(ps => (ps || []).map(p => p.id === newProfile.id ? newProfile : p))
        saveProfile(newProfile)
        updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId, ids.taskViewNoteId)
    }

    // The widget only appears when the browsed note is claimed by a profile
    // (its `parentNoteId` in reparent mode, its `viewNoteId` in virtual mode);
    // on any other note it renders nothing at all. When claimed, the dropdown
    // still lets the user edit *any* profile, but the initial pick is the one
    // that claims this note. `claimed` gates rendering (see the early return
    // below); `profileId` drives which profile is edited.
    useEffect(() => {
        if (!ids || !noteId) return
        (async () => {
            const claimed = await getMatchingProfile(ids.profileContext, noteId)
            if (!claimed) {
                setProfiles(null)
                setProfile(null)
                setProfileId(null)
                return
            }
            const data = await loadData(ids.profileContext.schemaNoteId, ids.profileContext.configNoteId)
            setRegistry(data)
            const allProfiles = await getAllProfiles(ids.profileContext)
            setProfiles(allProfiles)
            setProfileId(claimed.id)
            await updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId, ids.taskViewNoteId)
        })()
    }, [noteId, ids])

    // Load the selected profile's editable object whenever the dropdown pick
    // (or the underlying profile list) changes.
    useEffect(() => {
        if (!profiles || !profileId) return
        setProfile(profiles.find(p => p.id === profileId) || null)
    }, [profileId, profiles])

    // No profile claims the browsed note -> the widget doesn't appear at all.
    if (!profile || !registry){
        return null
    }

    return (
        <RightPanelWidget title="Agenda">
            <div id="x-agenda-overview-widget" className="agenda-widget">

                {/* Profile selector — edit any profile, not just the one that
                    claims the current note */}
                {profiles && profiles.length > 1 && (
                    <div className="agenda-profile-selector">
                        <label>Profile</label>
                        <FormDropdownList
                            values={profiles.map(p => ({ key: p.id, title: p.name }))}
                            currentValue={profileId}
                            onChange={setProfileId}
                            keyProperty="key"
                            titleProperty="title"
                            class="dropdown-component form-control"
                        />
                    </div>
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
                />

                {/* Prefixes */}
                <DropdownSection
                    title="Prefix"
                    sectionPath={["prefixes"]}
                    registryKey="prefixes"
                    registry={registry}
                    profile={profile}
                    update={update}
                />


                {/* Colors */}
                <DropdownSection
                    title="Color"
                    sectionPath={["colors"]}
                    registryKey="colors"
                    registry={registry}
                    profile={profile}
                    update={update}
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
