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

import { startNote, activateNote } from "trilium:api"

import { Collapsible } from "Collapsible.jsx"
import { FormCheckboxGroup } from "FormCheckboxGroup.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { saveProfile, loadData, updateTaskLists, getMatchingProfile, rescheduleAllTasks } = require("libAgendaOverview.js")

// Preact Components ------------------------------------------------------

// registryKey selects which of data.searches/data.filters a group's usages
// (elementId + enabled) resolve display names against.
function CheckboxSection({
    sectionPath,   // e.g. ["searchGroups"]
    title,
    registryKey,
    registry,
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
                            label: registry[registryKey][usage.elementId]?.name ?? "(missing element)",
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
    const [registry, setRegistry] = useState(null)
    const [unclaimed, setUnclaimed] = useState(false)
    const [ids, setIds] = useState(null)

    // Resolve this widget's own relations + settings once — separate from
    // `noteId` above, which is whichever note the user is currently browsing
    useEffect(() => {
        (async () => {
            const { constants, profileContext } = await getAgendaSettings()
            const icalNoteId = await startNote.getRelationValue("icalNote")
            setIds({ constants, profileContext, icalNoteId })
        })()
    }, [])

    // Update / Save Profile
    const update = (fn) => {
        const newProfile = structuredClone(profile)
        fn(newProfile)
        setProfile(newProfile)
        saveProfile(newProfile)
        updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
    }

    // Load Profile
    useEffect(() => {
        if (!ids || !noteId) return
        (async () => {
            const data = await loadData(ids.profileContext.schemaNoteId, ids.profileContext.configNoteId)
            setRegistry(data)
            const profileData = await getMatchingProfile(ids.profileContext, noteId)
            if (profileData) {
                setProfile(profileData)
                setUnclaimed(false)
                await updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
            } else {
                setProfile(null)
                setUnclaimed(true)
            }
        })()
    }, [noteId, ids])

    // Filing tasks into a note requires a fully-built profile (search/filter/
    // sort/prefix/color rules), not just picking a parent note — that's what
    // the Profile Editor page is for. Resolved live via the profileEditorNote
    // relation rather than hardcoded, same as every other cross-note jump in
    // this addon.
    async function openProfileEditor() {
        const profileEditorNoteId = await startNote.getRelationValue("profileEditorNote")
        if (profileEditorNoteId) await activateNote(profileEditorNoteId)
    }

    if (unclaimed) {
        return (
            <RightPanelWidget title="Agenda">
                <div className="agenda-widget">
                    <p>No agenda profile files tasks into this note yet.</p>
                    <Button icon="bx bx-edit" text="Open Profile Editor" onClick={openProfileEditor} />
                </div>
            </RightPanelWidget>
        )
    }

    if (!profile || !registry){
        return null
    }

    return (
        <RightPanelWidget title="Agenda">
            <div id="x-agenda-overview-widget" className="agenda-widget">

                {/* Search */}
                <CheckboxSection
                    title="Searches"
                    sectionPath={["searchGroups"]}
                    registryKey="searches"
                    registry={registry}
                    profile={profile}
                    update={update}
                />

                {/* Filters */}
                <CheckboxSection
                    title="Filters"
                    sectionPath={["filterGroups"]}
                    registryKey="filters"
                    registry={registry}
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
