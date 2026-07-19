const notifications = require("libNotification.js")
const { generateCalendar } = require("libCalendar.js")
const query = require("libAgendaQuery.js")

// Everything from the config and task layers is reached through libAgendaQuery,
// which re-exports it. libAgendaOverview requires only libAgendaQuery (plus the
// notification and calendar helpers) so each widget bundles config/task once.
const {
    loadData, saveProfile, getAllProfiles, getActiveProfile, setActiveProfile,
    getMatchingProfile, getSectionState, saveSectionState,
    getNotesForSearchGroups, getFilteredNotes, sortNoteIds,
    getPrefixes, getColors, getGroups, getGroupColumns, setGroupForNote,
    getTaskList, getSortedTaskList,
    refreshDisplayLabels, rescheduleByDays
} = query

// Materializes the sorted task list as children of the overview note: attaches
// each note, stamps a sort key, applies per-note colors, sets branch prefixes,
// and detaches notes no longer in the list.
// The backend call is awaited by callers: updateTaskLists refreshes the
// frontend note cache afterwards, which would race a fire-and-forget write.
function loadNotes(parentNoteId, notesList, prefixDict, colorDict) {
    return api.runOnBackend((parentNoteId, notesList, prefixDict, colorDict) => {
        const sortKeyWidth = String(notesList.length).length
        for (const [index, noteId] of notesList.entries()) {
            api.toggleNoteInParent(true, noteId, parentNoteId, "")
            const note = api.getNote(noteId)
            note.setLabel("agendaOverviewSort", String(index).padStart(sortKeyWidth, '0'))

            if (colorDict[noteId]) {
                function setColorRecursively(note, color) {
                    note.setLabel("color", color)
                    for (const child of note.getChildNotes()) {
                        setColorRecursively(child, color)
                    }
                }
                setColorRecursively(note, colorDict[noteId])
            }
        }

        api.sortNotes(parentNoteId, { sortBy: "agendaOverviewSort" })

        for (const note of api.getNote(parentNoteId).getChildNotes()) {
            if (!notesList.includes(note.noteId)) {
                note.removeLabel("agendaOverviewSort")
                api.toggleNoteInParent(false, note.noteId, parentNoteId, "")
            }
        }

        for (const branch of api.getNote(parentNoteId).getChildBranches()) {
            if (branch.noteId in prefixDict) {
                branch.prefix = prefixDict[branch.noteId]
                branch.save()
            }
        }
    }, [parentNoteId, notesList, prefixDict, colorDict])
}

// Configures the overview note's view (list/board), promoted attributes, board
// grouping, per-note status, and board columns.
//
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

        const promotedSignature = promotedAttributes.map(attr => `${attr.name}=${attr.definition}`).join("|")
        if (note.getLabelValue("agendaPromotedAttributes") !== promotedSignature) {
            const wantedDefinitions = new Set(promotedAttributes.map(attr => `label:${attr.name}`))
            for (const label of note.getOwnedAttributes("label")) {
                if (label.name.startsWith("label:") && !wantedDefinitions.has(label.name)) {
                    note.removeLabel(label.name)
                }
            }
            for (const attr of promotedAttributes) {
                const definitionName = `label:${attr.name}`
                if (note.getLabelValue(definitionName) !== attr.definition) {
                    note.setLabel(definitionName, attr.definition)
                }
            }
            note.setLabel("agendaPromotedAttributes", promotedSignature)
        }

        if (boardGroupBy) {
            if (note.getLabelValue("board:groupBy") !== boardGroupBy) note.setLabel("board:groupBy", boardGroupBy)
        } else if (note.hasLabel("board:groupBy")) {
            note.removeLabel("board:groupBy")
        }

        const columnsSignature = boardColumns.join(" ")
        const columnsChanged = viewType === "board" && note.getLabelValue("agendaBoardColumns") !== columnsSignature

        // Unmount the board before restamping statuses/columns (see header comment).
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
            const boardAttachment = note.getAttachmentByTitle("board.json")
            if (boardAttachment) boardAttachment.markAsDeleted()
            note.setLabel("agendaBoardColumns", columnsSignature)
        }

        if (note.getLabelValue("viewType") !== viewType) {
            note.setLabel("viewType", viewType)
        }
    }, [overviewNoteId, viewType, boardGroupBy, statusByNote, boardColumns, promotedAttributes])
}

// Promoted attribute definitions shown on the overview's cards/rows.
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

// Computes each note's board status (its group's display name) and the ordered
// list of column display names.
async function computeStatuses(dateRules, groupingInfo, noteIds) {
    const groups = await getGroups(dateRules, groupingInfo, noteIds)
    const columns = getGroupColumns(groupingInfo)
    const displayByKey = Object.fromEntries(columns.map(column => [column.key, column.display]))

    const statusByNote = {}
    for (const noteId of noteIds) {
        const key = groups[noteId]
        statusByNote[noteId] = (key != null && displayByKey[key]) ? displayByKey[key] : ""
    }
    return { statusByNote, columns: columns.map(column => column.display) }
}

async function updateTaskLists(profileContext, constants, icalNoteId) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    const profile = await getActiveProfile(profileContext)
    if (!profile) return

    const overviewNoteId = profileContext.overviewNoteId
    if (overviewNoteId) {
        const searchedNotes = await getNotesForSearchGroups(profile.searchGroups.children)
        const filteredNotes = await getFilteredNotes(data.dateRules, profile.filterGroups.children, searchedNotes)
        const sortRule = data.sorts[profile.sorts.selected]?.rule || ""
        const sortedNotes = await sortNoteIds(sortRule, filteredNotes)

        const viewType = profile.viewType || "list"
        const grouping = data.groupings[profile.groupings.selected]
        const boardGroupBy = boardGroupByForProfile(viewType, grouping)

        let statusByNote = {}
        let boardColumns = []
        if (boardGroupBy === "status") {
            ({ statusByNote, columns: boardColumns } = await computeStatuses(data.dateRules, grouping, sortedNotes))
        }

        for (const noteId of sortedNotes) {
            await refreshDisplayLabels(noteId, constants)
        }

        const promotedAttributes = promotedAttributesForConstants(constants)
        await configureOverviewNote(overviewNoteId, viewType, boardGroupBy, statusByNote, boardColumns, promotedAttributes)

        const prefixDict = await getPrefixes(data.dateRules, data.prefixes[profile.prefixes.selected], sortedNotes)
        const colorDict = await getColors(data.dateRules, data.colors[profile.colors.selected], sortedNotes)
        await loadNotes(overviewNoteId, sortedNotes, prefixDict, colorDict)

        // All the mutation above happens on the backend, so the frontend note
        // cache still holds the pre-change tree and the view renders stale.
        // Wait for the backend -> frontend sync, then refresh the overview note
        // and every task whose labels/branches we just rewrote.
        await api.waitUntilSynced()
        await api.reloadNotes([overviewNoteId, ...sortedNotes])
    }

    await setCalendarEvents(profileContext, constants, icalNoteId)
}

async function sendNotificationForDueTasks(profileContext, constants) {
    const taskIds = await getTaskList(profileContext)
    for (const taskId of taskIds) {
        const taskNote = await api.getNote(taskId)
        const startDatetime = taskNote.getLabelValue(constants.START_DATETIME_LABEL)
        if (startDatetime && api.dayjs().isSame(startDatetime, "minute")) {
            notifications.sendNotification(taskNote.title, "", taskId)
        }
    }
}

async function rescheduleAllTasks(profileContext, constants, icalNoteId, days = 0) {
    const taskIds = await getTaskList(profileContext)
    for (const taskId of taskIds) {
        rescheduleByDays(taskId, constants, days)
    }
    await updateTaskLists(profileContext, constants, icalNoteId)
}

async function setCalendarEvents(profileContext, constants, icalNoteId) {
    const taskIds = await getTaskList(profileContext)
    const notes = await Promise.all(taskIds.map(taskId => api.getNote(taskId)))
    const icalString = generateCalendar(notes, {
        startDateLabel: constants.START_DATETIME_LABEL,
        dueDateLabel: constants.DUE_DATETIME_LABEL,
        recurrenceLabel: constants.RECURRENCE_LABEL
    })
    await api.runOnBackend((icalNoteId, icalString) => {
        api.getNote(icalNoteId).setContent(icalString, { forceSave: true })
    }, [icalNoteId, icalString])
}

// Appends a task reference to the My Day note (once), optionally as a todo item.
async function addTaskToAgendaNow(nowNoteId, taskNoteId, renderAsTodo) {
    api.runOnBackend((nowNoteId, taskNoteId, renderAsTodo) => {
        const taskNote = api.getNote(taskNoteId)
        const taskLink = `<a class="reference-link" href="#root/${taskNoteId}">${taskNote.title}</a>`

        const nowNote = api.getNote(nowNoteId)
        const nowNoteContent = nowNote.getContent()
        if (nowNoteContent.includes(taskLink)) return

        const todoListItem =
            `<ul class="todo-list"><li data-list-item-id="${api.randomString(32)}">` +
            `<label class="todo-list__label"><input type="checkbox" disabled="disabled">` +
            `<span class="todo-list__label__description">${taskLink}</span></label></li></ul>`
        const entry = renderAsTodo ? todoListItem : `<p>${taskLink}</p>`

        nowNote.setContent(nowNoteContent.concat(entry))
        nowNote.save()
    }, [nowNoteId, taskNoteId, renderAsTodo])
}

// Files every task that is due this minute onto the My Day note.
async function addDueTasksToAgendaNow(profileContext, constants, nowNoteId) {
    const taskIds = await getTaskList(profileContext)
    for (const taskId of taskIds) {
        const taskNote = await api.getNote(taskId)
        const startDatetime = taskNote.getLabelValue(constants.START_DATETIME_LABEL)
        const isDueNow = startDatetime && api.dayjs().isSame(startDatetime, "minute")
        if (isDueNow) {
            await addTaskToAgendaNow(nowNoteId, taskId, true)
        }
    }
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
    setCalendarEvents,
    addTaskToAgendaNow,
    addDueTasksToAgendaNow
}
