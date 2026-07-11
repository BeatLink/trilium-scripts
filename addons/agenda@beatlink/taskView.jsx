import { useState, useEffect, useRef, FormDropdownList, useTriliumEvent } from "trilium:preact"
import { activateNote, startNote } from "trilium:api"
import { getAgendaSettings } from "agendaSettings.jsx"
import { KanbanView } from "KanbanView.jsx"
import { TableView } from "TableView.jsx"
import { AgendaCalendarView } from "agendaCalendarView.jsx"

const {
    loadData, getAllProfiles, getSortedTaskList,
    getPrefixes, getColors,
    getGroups, getGroupColumns, setGroupForNote,
    getTableView, saveTableView, updateTaskLists
} = require("libAgendaOverview.js")
const { complete, rescheduleByDays } = require("libAgendaTask.js")

const VIEW_MODES = [
    { key: "kanban", label: "Kanban" },
    { key: "table", label: "Table" },
    { key: "calendar", label: "Calendar" }
]

export default function TaskView() {
    const [ids, setIds] = useState(null)
    const [data, setData] = useState(null)
    const [profiles, setProfiles] = useState(null)
    const [profileId, setProfileId] = useState(null)
    const [viewMode, setViewMode] = useState("table")

    const [noteIds, setNoteIds] = useState(null)
    const [titles, setTitles] = useState({})
    const [prefixDict, setPrefixDict] = useState({})
    const [colorDict, setColorDict] = useState({})
    const [groupDict, setGroupDict] = useState({})
    const [tableColumnState, setTableColumnState] = useState(null)

    // Bumped to force a full data reload. The Overview sidebar writes profile
    // edits (searches/filters/sort/prefix/color) into the shared config note;
    // this render note isn't otherwise told about that, so we watch for the
    // config note's content reloading and re-pull everything, keeping the web
    // view live with the sidebar. See useTriliumEvent below.
    const [reloadTick, setReloadTick] = useState(0)

    // Resolve this page's own relations + settings once. The task-view note
    // carries an `icalNote` relation (see manifest) so row actions can refresh
    // the overview lists + ical export afterward, matching agendaTask.jsx.
    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            const icalNoteId = await startNote.getRelationValue("icalNote")
            setIds({ ...settings, icalNoteId })
        })()
    }, [])

    // Keep the currently-displayed task-note ids in a ref so the
    // entitiesReloaded handler (below) can tell whether a change touched a note
    // we're showing without re-subscribing on every list change.
    const noteIdsRef = useRef(noteIds)
    noteIdsRef.current = noteIds

    // Refresh whenever a relevant entity reloads on the frontend — Trilium fires
    // entitiesReloaded with a LoadResults describing exactly which notes and
    // attributes changed. We reload on:
    //   - our own config note reloading (a sidebar profile edit), and
    //   - any task change: an attribute added/changed/removed (task labels drive
    //     search matching, sort, prefix/color), or a displayed note's content or
    //     the note itself reloading.
    // Without the task-change cases, editing a task's dates/rank/etc (via the
    // right-panel widget or directly in Trilium) left this web view stale, since
    // those edits never touch the config note.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (!ids) return

        if (loadResults.isNoteContentReloaded(ids.profileContext.configNoteId)) {
            setReloadTick(t => t + 1)
            return
        }

        // Any attribute change can add or remove a task from the search, or
        // change how a shown task sorts/renders — cheapest correct signal is to
        // reload on any attribute change at all.
        if (loadResults.getAttributeRows().length > 0) {
            setReloadTick(t => t + 1)
            return
        }

        // A shown task's title/content changed with no attribute change.
        const shown = noteIdsRef.current
        if (shown && shown.some(noteId =>
            loadResults.isNoteReloaded(noteId) || loadResults.isNoteContentReloaded(noteId))) {
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

            setTableColumnState(await getTableView(ids.profileContext, profileId))
        })()
    }, [ids, data, profileId])

    // Persist a Table View column-visibility/sort change into the shared config
    // note, keyed by profile. Kept in local state too so the table isn't torn
    // down and rebuilt on its own edit (the config-note reload triggers a
    // reloadTick, which re-pulls this via the effect above anyway).
    async function onTableColumnState(state) {
        setTableColumnState(state)
        await saveTableView(ids.profileContext, profileId, state)
    }

    // A Table View row-action button was clicked. Mutates the task's labels via
    // libAgendaTask, then refreshes the overview lists + ical export (the config
    // note reload then bumps reloadTick, re-pulling the task list here).
    async function onTableAction(noteId, action) {
        // "zen"/"hoist" are built-in Trilium view commands that touch no task
        // label, so they dispatch directly and skip the overview refresh below.
        // Hoist toggles between this note and root, mirroring hoist-note@beatlink.
        if (action === "zen") {
            api.triggerCommand("toggleZenMode")
            return
        }
        if (action === "hoist") {
            api.setHoistedNoteId(
                api.getActiveContext().hoistedNoteId === noteId ? "root" : noteId
            )
            return
        }
        if (action === "complete") {
            await complete(noteId, ids.constants)
        } else if (action === "today") {
            await rescheduleByDays(noteId, ids.constants, 0)
        } else if (action === "tomorrow") {
            await rescheduleByDays(noteId, ids.constants, 1)
        }
        await updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
    }

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

            {viewMode === "table" && (
                <TableView
                    noteIds={noteIds}
                    titles={titles}
                    colorDict={colorDict}
                    constants={ids.constants}
                    columnState={tableColumnState}
                    onColumnState={onTableColumnState}
                    onRowClick={activateNote}
                    onAction={onTableAction}
                />
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
