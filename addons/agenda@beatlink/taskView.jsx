import { useState, useEffect, FormDropdownList, useTriliumEvent } from "trilium:preact"
import { activateNote } from "trilium:api"
import { getAgendaSettings } from "agendaSettings.jsx"
import { TreeView } from "TreeView.jsx"
import { KanbanView } from "KanbanView.jsx"
import { AgendaCalendarView } from "agendaCalendarView.jsx"

const {
    loadData, getAllProfiles, getSortedTaskList,
    getPrefixes, getColors,
    getGroups, getGroupColumns, setGroupForNote
} = require("libAgendaOverview.js")

const VIEW_MODES = [
    { key: "tree", label: "Tree" },
    { key: "kanban", label: "Kanban" },
    { key: "calendar", label: "Calendar" }
]

export default function TaskView() {
    const [ids, setIds] = useState(null)
    const [data, setData] = useState(null)
    const [profiles, setProfiles] = useState(null)
    const [profileId, setProfileId] = useState(null)
    const [viewMode, setViewMode] = useState("tree")

    const [noteIds, setNoteIds] = useState(null)
    const [titles, setTitles] = useState({})
    const [prefixDict, setPrefixDict] = useState({})
    const [colorDict, setColorDict] = useState({})
    const [groupDict, setGroupDict] = useState({})

    // Bumped to force a full data reload. The Overview sidebar writes profile
    // edits (searches/filters/sort/prefix/color) into the shared config note;
    // this render note isn't otherwise told about that, so we watch for the
    // config note's content reloading and re-pull everything, keeping the web
    // view live with the sidebar. See useTriliumEvent below.
    const [reloadTick, setReloadTick] = useState(0)

    // Resolve this page's own relations + settings once.
    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            setIds(settings)
        })()
    }, [])

    // Refresh whenever the config note the sidebar just saved reloads on the
    // frontend — Trilium fires entitiesReloaded with a LoadResults describing
    // exactly which notes changed, so we only react to our own config note.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (ids && loadResults.isNoteContentReloaded(ids.profileContext.configNoteId)) {
            setReloadTick(t => t + 1)
        }
    })

    // Load the schema-driven registries + every profile. Re-runs on reloadTick
    // so a sidebar edit is reflected here; a profile the user had selected is
    // kept selected if it still exists, else falls back to the first.
    useEffect(() => {
        if (!ids) return
        (async () => {
            const loaded = await loadData(ids.profileContext.schemaNoteId, ids.profileContext.configNoteId)
            setData(loaded)
            const allProfiles = await getAllProfiles(ids.profileContext)
            setProfiles(allProfiles)
            setProfileId(prev => (prev && allProfiles.some(p => p.id === prev))
                ? prev
                : (allProfiles.length > 0 ? allProfiles[0].id : null))
        })()
    }, [ids, reloadTick])

    // Load the current profile's task list + prefix/color/group dicts.
    useEffect(() => {
        if (!ids || !data || !profileId) return
        (async () => {
            const profile = data.profiles[profileId]
            if (!profile) return
            const list = await getSortedTaskList(ids.profileContext, profileId)
            setNoteIds(list)

            const notes = await Promise.all(list.map(noteId => api.getNote(noteId)))
            setTitles(Object.fromEntries(notes.map(note => [note.noteId, note.title])))

            setPrefixDict(await getPrefixes(data.dateRules, data.prefixes[profile.prefixes.selected], list))
            setColorDict(await getColors(data.dateRules, data.colors[profile.colors.selected], list))

            const groupingInfo = data.groupings[profile.groupings.selected]
            setGroupDict(groupingInfo ? await getGroups(data.dateRules, groupingInfo, list) : {})
        })()
    }, [ids, data, profileId])

    async function onCardMove(noteId, newGroupKey) {
        setGroupDict(g => ({ ...g, [noteId]: newGroupKey }))
        const profile = data.profiles[profileId]
        const groupingInfo = data.groupings[profile.groupings.selected]
        await setGroupForNote(groupingInfo, noteId, newGroupKey)
    }

    if (!ids || !data || !profiles) return <div>Loading...</div>

    if (profiles.length === 0) {
        return <div className="agenda-task-view">No agenda profiles configured yet.</div>
    }

    const profile = data.profiles[profileId]
    const groupingInfo = profile.groupings.selected ? data.groupings[profile.groupings.selected] : null
    const columns = groupingInfo ? getGroupColumns(groupingInfo) : []

    return (
        <div className="agenda-task-view">
            <div className="agenda-task-view-toolbar">
                {profiles.length > 1 && (
                    <FormDropdownList
                        values={profiles.map(p => ({ key: p.id, title: p.name }))}
                        currentValue={profileId}
                        onChange={setProfileId}
                        keyProperty="key"
                        titleProperty="title"
                        class="dropdown-component form-control"
                    />
                )}
                <div className="agenda-task-view-modes">
                    {VIEW_MODES.map(mode => (
                        <button
                            key={mode.key}
                            className={"lst-tab" + (viewMode === mode.key ? " lst-tab-active" : "")}
                            onClick={() => setViewMode(mode.key)}
                        >
                            {mode.label}
                        </button>
                    ))}
                </div>
            </div>

            {viewMode === "tree" && (
                <TreeView
                    noteIds={noteIds}
                    titles={titles}
                    prefixDict={prefixDict}
                    colorDict={colorDict}
                    onCardClick={activateNote}
                />
            )}

            {viewMode === "kanban" && (
                !groupingInfo ? (
                    <div className="agenda-task-view-empty">
                        No grouping configured for this profile — pick one in the Agenda Editor's
                        Profiles tab.
                    </div>
                ) : (
                    <KanbanView
                        noteIds={noteIds}
                        titles={titles}
                        groupDict={groupDict}
                        columns={columns}
                        prefixDict={prefixDict}
                        colorDict={colorDict}
                        onCardClick={activateNote}
                        onCardMove={onCardMove}
                        dragEnabled={groupingInfo.type === "label"}
                    />
                )
            )}

            {viewMode === "calendar" && (
                <AgendaCalendarView
                    noteIds={noteIds}
                    constants={ids.constants}
                    onEventClick={activateNote}
                />
            )}
        </div>
    )
}
