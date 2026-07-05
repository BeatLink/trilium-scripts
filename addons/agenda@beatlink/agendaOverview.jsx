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

const { saveProfile, updateTaskLists, getMatchingProfile, rescheduleAllTasks } = require("libAgendaOverview.js")

// Preact Components ------------------------------------------------------

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
    const [unclaimed, setUnclaimed] = useState(false)
    const [ids, setIds] = useState(null)

    // Resolve this widget's own relations + settings once — separate from
    // `noteId` above, which is whichever note the user is currently browsing
    useEffect(() => {
        (async () => {
            const { constants, profileNoteIds } = await getAgendaSettings()
            const icalNoteId = await startNote.getRelationValue("icalNote")
            setIds({ constants, profileNoteIds, icalNoteId })
        })()
    }, [])

    // Update / Save Profile
    const update = (fn) => {
        const newProfile = structuredClone(profile)
        fn(newProfile)
        setProfile(newProfile)
        saveProfile(newProfile)
        updateTaskLists(ids.profileNoteIds, ids.constants, ids.icalNoteId)
    }

    // Load Profile
    useEffect(() => {
        if (!ids || !noteId) return
        (async () => {
            const profileData = await getMatchingProfile(ids.profileNoteIds, noteId)
            if (profileData) {
                setProfile(profileData)
                setUnclaimed(false)
                await updateTaskLists(ids.profileNoteIds, ids.constants, ids.icalNoteId)
            } else {
                setProfile(null)
                setUnclaimed(true)
            }
        })()
    }, [noteId, ids])

    // The shipped default profile has no parentNoteId yet — it can't know
    // the real id of whatever note you want it to file tasks into ahead of
    // install time. This lets you pick that note explicitly instead of
    // requiring a manual profile.json edit.
    async function claimThisNote() {
        const profileNoteId = ids.profileNoteIds[0]
        const rawProfile = JSON.parse(await (await api.getNote(profileNoteId)).getContent())
        rawProfile.noteId = profileNoteId
        rawProfile.parentNoteId = noteId
        await saveProfile(rawProfile)
        setProfile(rawProfile)
        setUnclaimed(false)
        await updateTaskLists(ids.profileNoteIds, ids.constants, ids.icalNoteId)
    }

    if (unclaimed) {
        return (
            <RightPanelWidget title="Agenda">
                <div className="agenda-widget">
                    <p>No agenda profile files tasks into this note yet.</p>
                    <Button icon="bx bx-link" text="File Tasks Here" onClick={claimThisNote} />
                </div>
            </RightPanelWidget>
        )
    }

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
                            onClick={e => { rescheduleAllTasks(ids.profileNoteIds, ids.constants, ids.icalNoteId) }}
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
