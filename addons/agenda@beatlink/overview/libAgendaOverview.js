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

async function updateTaskLists(profileContext, constants, icalNoteId) {
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

    // Load-bearing order: flip viewType to list (unmount) -> stamp #status ->
    // delete board.json -> flip viewType back. A mounted board re-persists stale
    // columns otherwise. Do not reorder.
    async function configureOverviewNote(overviewNoteId, viewType, boardGroupBy = "", statusByNote = {}, boardColumns = [], promotedAttributes = []) {
        if (!overviewNoteId || !viewType) return
        await api.runOnBackend((overviewNoteId, viewType, boardGroupBy, statusByNote, boardColumns, promotedAttributes) => {
            const note = api.getNote(overviewNoteId)
            if (!note) return
            if (note.type !== "book") {
                note.type = "book"
                note.save()
            }

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

            const signature = boardColumns.join(" ")
            const columnsChanged = viewType === "board" && note.getLabelValue("agendaBoardColumns") !== signature

            if (columnsChanged && note.getLabelValue("viewType") !== "list") {
                note.setLabel("viewType", "list")
            }

            for (const [noteId, status] of Object.entries(statusByNote)) {
                const child = api.getNote(noteId)
                if (!child) continue
                if (status) {
                    if (child.getLabelValue("status") !== status) child.setLabel("status", status)
                } else if (child.hasLabel("status")) {
                    child.removeLabel("status")
                }
            }

            if (columnsChanged) {
                const att = note.getAttachmentByTitle("board.json")
                if (att) att.markAsDeleted()
                note.setLabel("agendaBoardColumns", signature)
            }

            if (note.getLabelValue("viewType") !== viewType) {
                note.setLabel("viewType", viewType)
            }
        }, [overviewNoteId, viewType, boardGroupBy, statusByNote, boardColumns, promotedAttributes])
    }

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

    function boardGroupByForProfile(viewType, grouping) {
        if (viewType !== "board" || !grouping) return ""
        return "status"
    }

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
        let statusByNote = {}, boardColumns = []
        if (boardGroupBy === "status") {
            ({ statusByNote, columns: boardColumns } = await computeStatuses(data.dateRules, grouping, sortedNotes))
        }
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
    updateTaskLists,
    sendNotificationForDueTasks,
    rescheduleAllTasks,
    setCalendarEvents
}
