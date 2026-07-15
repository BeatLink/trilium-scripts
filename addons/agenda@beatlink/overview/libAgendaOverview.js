const notifications = require("libNotification.js")
const task = require("libAgendaTask.js")
const { generateCalendar } = require("libCalendar.js")
const config = require("libAgendaConfig.js")
const query = require("libAgendaQuery.js")

const {
    loadData, saveProfile, getAllProfiles, getActiveProfile, setActiveProfile,
    getMatchingProfile, getSectionState, saveSectionState
} = config
const {
    getNotesForSearchGroups, getFilteredNotes, sortNoteIds,
    getPrefixes, getColors, getGroups, getGroupColumns, setGroupForNote,
    getTaskList, getSortedTaskList
} = query

async function loadNotes(parentNoteId, notesList, prefixDict, colorDict) {
    api.runOnBackend((parentNoteId, notesList, prefixDict, colorDict) => {
        for (let [index, noteId] of notesList.entries()) {
            api.toggleNoteInParent(true, noteId, parentNoteId, "")
            const note = api.getNote(noteId)
            const padLength = String(notesList.length).length
            note.setLabel("agendaOverviewSort", String(index).padStart(padLength, '0'))
            if (colorDict[noteId]) {
                function setColor(note, color) {
                    note.setLabel("color", color)
                    for (let child of note.getChildNotes()) {
                        setColor(child, color)
                    }
                }
                setColor(note, colorDict[noteId])
            }
        }
        api.sortNotes(parentNoteId, { sortBy: "agendaOverviewSort" })
        for (let note of api.getNote(parentNoteId).getChildNotes()) {
            if (!notesList.includes(note.noteId)) {
                note.removeLabel("agendaOverviewSort")
                api.toggleNoteInParent(false, note.noteId, parentNoteId, "")
            }
        }
        for (let branch of api.getNote(parentNoteId).getChildBranches()) {
            if (branch.noteId in prefixDict) {
                branch.prefix = prefixDict[branch.noteId]
                branch.save()
            }
        }
    }, [parentNoteId, notesList, prefixDict, colorDict])
}



// Makes the shared overview note a Trilium collection: sets its type to `book`
// and its `#viewType` label to the active profile's chosen view. For a board,
// `boardGroupBy` is `"status"` (the single helper label every grouping projects
// onto), `statusByNote` maps each filed task to its `#status` value ("" clears
// it), and `boardColumns` is the ordered column display list (a change
// signature).
//
// The board keeps its column list in an in-memory `viewConfig` (a `board.json`
// attachment) that `getBoardData` (board/data.ts) preserves unconditionally, so
// changing a task's `#status` while the board is MOUNTED makes it re-persist the
// old columns, merging them with the new (verified live). The reliable sequence,
// all in one backend batch:
//   1. flip `#viewType` to `list` — UNMOUNTS the board, so nothing reacts to
//      the status changes below,
//   2. stamp the new `#status` values,
//   3. DELETE `board.json` so the board rebuilds columns from those values,
//   4. flip `#viewType` back to `board` — remounts fresh.
// Steps 1/3/4 run only when the column set changed (tracked by the
// `#agendaBoardColumns` signature) so routine refreshes don't flip/flicker; the
// status stamp (step 2) always runs. Trilium orders the rebuilt columns by
// discovery among the present `#status` values (empty columns don't appear).
async function configureOverviewNote(overviewNoteId, viewType, boardGroupBy = "", statusByNote = {}, boardColumns = [], promotedAttributes = []) {
    if (!overviewNoteId || !viewType) return
    await api.runOnBackend((overviewNoteId, viewType, boardGroupBy, statusByNote, boardColumns, promotedAttributes) => {
        const note = api.getNote(overviewNoteId)
        if (!note) return
        if (note.type !== "book") {
            note.type = "book"
            note.save()
        }

        // Promote the task attributes so the table/grid collection view can show
        // them as columns. Each entry is a `#label:<name>` definition whose value
        // is the Trilium promoted-attribute-definition grammar (e.g.
        // `promoted,single,date,alias=Due`). Definitions we set that are no longer
        // wanted get removed so a renamed/removed label doesn't leave a stale
        // column; a signature label keeps routine refreshes from re-stamping.
        const promotedSignature = promotedAttributes.map(a => `${a.name}=${a.definition}`).join("|")
        if (note.getLabelValue("agendaPromotedAttributes") !== promotedSignature) {
            const wanted = new Set(promotedAttributes.map(a => `label:${a.name}`))
            for (const label of note.getOwnedAttributes("label")) {
                if (label.name.startsWith("label:") && !wanted.has(label.name)) {
                    note.removeLabel(label.name)
                }
            }
            for (const attr of promotedAttributes) {
                const defName = `label:${attr.name}`
                if (note.getLabelValue(defName) !== attr.definition) note.setLabel(defName, attr.definition)
            }
            note.setLabel("agendaPromotedAttributes", promotedSignature)
        }

        if (boardGroupBy) {
            if (note.getLabelValue("board:groupBy") !== boardGroupBy) note.setLabel("board:groupBy", boardGroupBy)
        } else if (note.hasLabel("board:groupBy")) {
            note.removeLabel("board:groupBy")
        }

        // Column set changed since we last configured the board? Tracked in a
        // signature label so we only flip/remount when it genuinely differs.
        const signature = boardColumns.join(" ")
        const columnsChanged = viewType === "board" && note.getLabelValue("agendaBoardColumns") !== signature

        // 1. Unmount before restamping so the mounted board can't re-persist.
        if (columnsChanged && note.getLabelValue("viewType") !== "list") {
            note.setLabel("viewType", "list")
        }

        // 2. Stamp #status (always; a task can change bucket without the column
        //    set changing, e.g. its priority label was edited).
        for (const [noteId, status] of Object.entries(statusByNote)) {
            const child = api.getNote(noteId)
            if (!child) continue
            if (status) {
                if (child.getLabelValue("status") !== status) child.setLabel("status", status)
            } else if (child.hasLabel("status")) {
                child.removeLabel("status")
            }
        }

        // 3. Drop board.json so the remount rebuilds columns from the new values.
        if (columnsChanged) {
            const att = note.getAttachmentByTitle("board.json")
            if (att) att.markAsDeleted()
            note.setLabel("agendaBoardColumns", signature)
        }

        // 4. Restore the target viewType (remounts the board when it was flipped).
        if (note.getLabelValue("viewType") !== viewType) {
            note.setLabel("viewType", viewType)
        }
    }, [overviewNoteId, viewType, boardGroupBy, statusByNote, boardColumns, promotedAttributes])
}

// The task attributes to promote on the overview note so a table/grid collection
// view can render them as columns. Two sources:
//   - user-configurable label names from `constants` (start/due are promoted as
//     the COMBINED `#...DateTime` labels, one `datetime` column each, not the
//     four split date/time labels which exist only for calendar internals),
//   - fixed-name task labels the agenda always uses (`priority`/`area`/`type`).
// Duration and recurrence are promoted via the human-readable display labels
// (`#durationDisplay`/`#recurrenceDisplay`, stamped by libAgendaTask's
// `updateDependentAttributes`), because Trilium renders a promoted attribute's
// RAW value with no formatter — the stored `#duration` (ISO `PT1H30M`) and
// `#recurrence` (raw RRULE) would otherwise show as machine strings.
// Undefined constants (an unconfigured label) are skipped.
function promotedAttributesForConstants(constants = {}) {
    const specs = [
        [constants.START_DATETIME_LABEL, "promoted,single,datetime", "Start"],
        [constants.DUE_DATETIME_LABEL, "promoted,single,datetime", "Due"],
        ["durationDisplay", "promoted,single,text", "Duration"],
        ["recurrenceDisplay", "promoted,single,text", "Recurrence"],
        ["priority", "promoted,single,text", "Priority"],
        ["area", "promoted,single,text", "Area"],
        ["type", "promoted,single,text", "Type"]
    ]
    return specs
        .filter(([name]) => name)
        .map(([name, definition, alias]) => ({ name, definition: `${definition},alias=${alias}` }))
}

// Every board grouping is projected onto the single `#status` helper label
// (computed by computeStatuses, stamped by configureOverviewNote), so the board
// always groups on `status` regardless of the grouping's type (label/dayjs/recurrence) —
// which also means `#board:groupBy` stays constant across grouping switches.
// Returns "" only when the view isn't `board` or no grouping is selected, so
// the board falls back to its default columns.
function boardGroupByForProfile(viewType, grouping) {
    if (viewType !== "board" || !grouping) return ""
    return "status"
}

// Every board grouping — regardless of type — is projected onto ONE helper
// label, `#status`, which the board always groups on (`#board:groupBy=status`).
// This computes each filed task's bucket for the active grouping (via getGroups,
// which already handles label, dayjs-interval, and recurrence-frequency
// grouping) and resolves it to the bucket's DISPLAY name, so the board's column
// headers read nicely. Returns `{ statusByNote, columns }` — the per-note
// `#status` values to stamp ("" = clear), and the ordered column display list.
// It does NOT stamp here: the stamping has to happen inside configureOverviewNote's
// batch, after the board is unmounted, or an open board re-persists stale columns.
async function computeStatuses(dateRules, groupingInfo, noteIds) {
    const groups = await getGroups(dateRules, groupingInfo, noteIds)
    const columns = getGroupColumns(groupingInfo)
    const displayByKey = Object.fromEntries(columns.map(c => [c.key, c.display]))
    const statusByNote = {}
    for (const noteId of noteIds) {
        const key = groups[noteId]
        statusByNote[noteId] = (key != null && displayByKey[key]) ? displayByKey[key] : ""
    }
    return { statusByNote, columns: columns.map(c => c.display) }
}

// Files the active profile's matching tasks into the single shared overview
// note and refreshes the calendar/ical export. Only the active profile is
// processed — switching the active profile re-populates the shared note with
// that profile's tasks (loadNotes removes children that no longer match).
async function updateTaskLists(profileContext, constants, icalNoteId) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    const profile = await getActiveProfile(profileContext)
    if (!profile) return
    const overviewNoteId = profileContext.overviewNoteId
    if (overviewNoteId) {
        let allNotes = await getNotesForSearchGroups(profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(data.dateRules, profile.filterGroups.children, allNotes)
        let sortedNotes = await sortNoteIds(data.sorts[profile.sorts.selected]?.rule || "", filteredNotes)
        const viewType = profile.viewType || "list"
        const grouping = data.groupings[profile.groupings.selected]
        const boardGroupBy = boardGroupByForProfile(viewType, grouping)
        // For a board, project the active grouping onto each task's `#status`
        // (the field the board groups on) and derive the ordered column list.
        // The actual stamping happens inside configureOverviewNote (it must run
        // while the board is unmounted); here we only compute the values.
        let statusByNote = {}, boardColumns = []
        if (boardGroupBy === "status") {
            ({ statusByNote, columns: boardColumns } = await computeStatuses(data.dateRules, grouping, sortedNotes))
        }
        // Backfill the human-readable display labels (#durationDisplay /
        // #recurrenceDisplay) on every filed task so the table/grid columns
        // aren't blank for tasks never edited through the picker. No-op writes
        // are skipped inside refreshDisplayLabels, so routine refreshes are cheap.
        for (const noteId of sortedNotes) {
            await task.refreshDisplayLabels(noteId, constants)
        }
        const promotedAttributes = promotedAttributesForConstants(constants)
        await configureOverviewNote(overviewNoteId, viewType, boardGroupBy, statusByNote, boardColumns, promotedAttributes)
        let prefixDict = await getPrefixes(data.dateRules, data.prefixes[profile.prefixes.selected], sortedNotes)
        let colorDict = await getColors(data.dateRules, data.colors[profile.colors.selected], sortedNotes)
        await loadNotes(overviewNoteId, sortedNotes, prefixDict, colorDict)
    }
    await setCalendarEvents(profileContext, constants, icalNoteId)
}

async function sendNotificationForDueTasks(profileContext, constants) {
    const taskList = await getTaskList(profileContext)
    for (const taskId of taskList) {
        const task = await api.getNote(taskId)
        const startDate = task.getLabelValue(constants.START_DATETIME_LABEL)
        if (startDate) {
            if (api.dayjs().isSame(startDate, "minute")) {
                notifications.sendNotification(task.title, "", taskId)
            }
        }
    }
}

async function rescheduleAllTasks(profileContext, constants, icalNoteId, days = 0) {
    const taskList = await getTaskList(profileContext)
    for (const taskId of taskList) {
        task.rescheduleByDays(taskId, constants, days)
    }
    await updateTaskLists(profileContext, constants, icalNoteId)
}

async function setCalendarEvents(profileContext, constants, icalNoteId) {
    const taskList = await getTaskList(profileContext)
    const notes = await Promise.all(taskList.map(taskId => api.getNote(taskId)))
    const icalString = generateCalendar(notes, {
        startDateLabel: constants.START_DATETIME_LABEL,
        dueDateLabel: constants.DUE_DATETIME_LABEL,
        recurrenceLabel: constants.RECURRENCE_LABEL
    })
    await api.runOnBackend((icalNoteId, icalString) => {
        const icalNote = api.getNote(icalNoteId)
        icalNote.setContent(icalString, { forceSave: true })
    }, [icalNoteId, icalString])
}


module.exports = {
    // Re-exported config/query helpers the overview widget imports from here
    loadData,
    getMatchingProfile,
    getAllProfiles,
    getActiveProfile,
    setActiveProfile,
    saveProfile,
    getTaskList,
    getSortedTaskList,
    getGroups,
    getGroupColumns,
    setGroupForNote,
    getSectionState,
    saveSectionState,
    // Overview-owned orchestration
    updateTaskLists,
    sendNotificationForDueTasks,
    rescheduleAllTasks,
    setCalendarEvents
}
