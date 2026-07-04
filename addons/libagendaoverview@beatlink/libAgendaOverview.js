const notifications = require("libNotification.js")
const task = require("libAgendaTask.js")
const ical = require("ical.min.js")
const multisort = require("libMultisort.js")


function matchesDayJsCriteria(dateString, dateCriteriaList, useNumberOfDays){
    let now = api.dayjs()
    let startOfToday = now.startOf("day")
    let dateVars = {
        "now": now,
        "startOfToday": startOfToday,
        "endOfToday": now.endOf("day"),
        "endOfTomorrow": now.endOf("day").add(1, "day"),
        "endOfThisWeek": useNumberOfDays ? startOfToday.add(7, "day") : now.endOf("week"),
        "endOfThisMonth": useNumberOfDays ? startOfToday.add(30, "day") : now.endOf("month"),
        "endOfThisYear": useNumberOfDays ? startOfToday.add(365, "day") : now.endOf("year"),
    }
    let dateCriteria = [...dateCriteriaList]
    let dateFunction = dateCriteria.shift()
    let dateParameters = dateCriteria
    for (const [index, parameter] of dateParameters.entries()){
        dateParameters[index] = parameter in dateVars ? dateVars[parameter] : dateParameters[index]
    }
    let date = api.dayjs(dateString)
    if (dateFunction === "isNull") {
        return !dateString
    } else {
        return date[dateFunction](...dateParameters) ? true : false
    }
}

// profileNoteIds is supplied by the caller (e.g. resolved from its own
// "profile" relation(s)) rather than assumed by this library, so it stays
// portable across installs
async function getAllProfiles(profileNoteIds) {
    let profiles = []
    for (let noteId of profileNoteIds) {
        let note = await api.getNote(noteId)
        let profile = JSON.parse(await note.getContent())
        profile["noteId"] = note.noteId
        profiles.push(profile)
    }
    return profiles
}

async function getMatchingProfile(profileNoteIds, overviewNoteId) {
    for (let profile of await getAllProfiles(profileNoteIds)){
        if (profile["parentNoteId"] == overviewNoteId){
            return profile
        }
    }
}

async function saveProfile(profile){
    api.runOnBackend((profile) => {
        api.getNote(profile.noteId).setJsonContent(profile)
    }, [profile]);
}

async function deleteChildBranches(parentNoteId){
    api.runOnBackend((parentNoteId) => {
        for (let note of api.getNote(parentNoteId).getChildNotes()){
            api.toggleNoteInParent(false, note.noteId, parentNoteId)
        }
    }, [parentNoteId]);
}

async function getNotesForSearchGroups(searchData) {
    let allNotes = []
    for (const group of Object.values(searchData)){
        for (const search of Object.values(group.children)){
            if (search.enabled){
                let noteIds = (await api.searchForNotes(search.rule)).map(note => note.noteId)
                allNotes = allNotes.concat(noteIds)
            }
        }
    }
    return allNotes
}

async function getFilteredNotes(filterData, notesList){
    let filterGroups = {}
    for (const [groupId, group] of Object.entries(filterData)){
        filterGroups[groupId] = []
        for (const filter of Object.values(group.children)){
            if (filter.enabled){
                if (group.type == "search"){
                    let notes = (await api.searchForNotes(filter.rule)).map(note => note.noteId)
                    filterGroups[groupId] = filterGroups[groupId].concat(notes)
                }
                if (group.type == "dayjs"){
                    for (let note of notesList){
                        let noteDate = (await api.getNote(note)).getLabelValue(group.datetimeLabel)
                        if (matchesDayJsCriteria(noteDate, filter.rule, group.useNumberOfDays)){
                            filterGroups[groupId].push(note)
                        }
                    }
                }
            }
        }
    }
    // Essentially the below checks that every note in the note list is also in all the filter lists
    let finalNotesList = notesList.filter(
        noteId =>  Object.values(filterGroups).every(
            filter => filter.includes(noteId)))
    return finalNotesList
}

// Adapts to libMultisort's note-object-in/note-object-out contract (kept
// as-is since multisort@beatlink already depends on that exact shape),
// while this module works in note ids throughout
async function sortNoteIds(sortString, noteIds) {
    const notes = await Promise.all(noteIds.map(noteId => api.getNote(noteId)))
    const sorted = multisort.sortChildNotes(sortString, notes)
    return sorted.map(note => note.noteId)
}

async function getPrefixes(prefixInfo, notesList) {
    let prefixDict = {}
    for (let note of notesList){
        if (prefixInfo.type == "dayjs"){
            let date = (await api.getNote(note)).getLabelValue(prefixInfo.dateLabel)
            if (date) {
                for (let interval of Object.values(prefixInfo.intervals)) {
                    if (matchesDayJsCriteria(date, interval.rule, prefixInfo.useNumberOfDays)){
                        prefixDict[note] = api.dayjs(date).format(interval.formatString)
                        break
                    }
                }
            } else {
                prefixDict[note] = "No Date Set"
            }
        } else if (prefixInfo["type"] == "label"){
            let noteLabel = (await api.getNote(note)).getLabelValue(prefixInfo["label"])
            prefixDict[note] = prefixInfo.children ? prefixInfo.children[noteLabel] : noteLabel
        } else {
            prefixDict[note] = ""
        }
    }
    return prefixDict
}

async function getColors(colorInfo, notesList) {
    let colorDict = {}
    for (let note of notesList){
        if (colorInfo.type == "dayjs"){
            let date = (await api.getNote(note)).getLabelValue(colorInfo.dateLabel)
            if (date) {
                for (let interval of Object.values(colorInfo.intervals)) {
                    if (matchesDayJsCriteria(date, interval.rule, colorInfo.useNumberOfDays)){
                        colorDict[note] = interval.color
                        break
                    }
                }
            } else {
                colorDict[note] = ""
            }
        } else if (colorInfo["type"] == "label"){
            let noteLabel = (await api.getNote(note)).getLabelValue(colorInfo["label"])
            colorDict[note] = colorInfo.children ? colorInfo.children[noteLabel] : noteLabel
        } else {
            colorDict[note] = ""
        }
    }
    return colorDict
}

async function loadNotes(parentNoteId, notesList, prefixDict, colorDict) {
    api.runOnBackend((parentNoteId, notesList, prefixDict, colorDict) => {
        for (let [index, noteId] of notesList.entries()){
            api.toggleNoteInParent(true, noteId, parentNoteId, "")
            const note = api.getNote(noteId)
            const padLength = String(notesList.length).length;
            note.setLabel("agendaOverviewSort", String(index).padStart(padLength, '0'))
            if (colorDict[noteId]){
                function setColor(note, color){
                    note.setLabel("color", color)
                    for (let child of note.getChildNotes()){
                        setColor(child, color)
                    }
                }
                setColor(note, colorDict[noteId])
            }
        }
        api.sortNotes(parentNoteId, { sortBy: "agendaOverviewSort" })
        for (let note of api.getNote(parentNoteId).getChildNotes()){
            if (!notesList.includes(note.noteId)){
                note.removeLabel("agendaOverviewSort")
                api.toggleNoteInParent(false, note.noteId, parentNoteId, "")
            }
        }
        for (let branch of api.getNote(parentNoteId).getChildBranches()){
            if (branch.noteId in prefixDict){
                branch.prefix = prefixDict[branch.noteId]
                branch.save()
            }
        }
    }, [parentNoteId, notesList, prefixDict, colorDict])
}



async function updateTaskLists(profileNoteIds, constants, icalNoteId) {
    let profiles = await getAllProfiles(profileNoteIds)
    for (let profile of Object.values(profiles)){
        //await deleteChildBranches(profile.parentNoteId)
        let allNotes = await getNotesForSearchGroups(profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(profile.filterGroups.children, allNotes)
        let sortedNotes = await sortNoteIds(profile.sorts.children[profile.sorts.selected].rule, filteredNotes)
        let prefixDict = await getPrefixes(profile.prefixes.children[profile.prefixes.selected], sortedNotes)
        let colorDict = await getColors(profile.colors.children[profile.colors.selected], sortedNotes)
        await loadNotes(profile["parentNoteId"], sortedNotes, prefixDict, colorDict)
        await setCalendarEvents(profileNoteIds, constants, icalNoteId)
    }
}

async function getTaskList(profileNoteIds) {
    let profiles = await getAllProfiles(profileNoteIds)
    for (let profile of Object.values(profiles)){
        let allNotes = await getNotesForSearchGroups(profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(profile.filterGroups.children, allNotes)
        return filteredNotes
    }
}

async function sendNotificationForDueTasks(profileNoteIds, constants){
    const taskList = await getTaskList(profileNoteIds)
    for (const taskId of taskList){
        const task = await api.getNote(taskId)
        const startDate = task.getLabelValue(constants.START_DATETIME_LABEL)
        if (startDate) {
            if (api.dayjs().isSame(startDate, "minute")) {
                notifications.sendNotification(task.title, "", taskId)
            }
        }
    }
}

async function rescheduleAllTasks(profileNoteIds, constants, icalNoteId, days = 0){
    const taskList = await getTaskList(profileNoteIds)
    for (const taskId of taskList){
        task.rescheduleByDays(taskId, constants, days)
    }
    await updateTaskLists(profileNoteIds, constants, icalNoteId)
}

async function setCalendarEvents(profileNoteIds, constants, icalNoteId) {
    const taskList = await getTaskList(profileNoteIds)

    // Generate caldav object from found tasks
    let calendar = new ical.Component(['vcalendar', [], []]);
    calendar.updatePropertyWithValue('prodid', '-//Beatlink/Trilium Calendar Script');
    calendar.updatePropertyWithValue('version', '2.0');
    let now = new ical.Time.now()
    for (let taskId of taskList) {
        let task = await api.getNote(taskId)
        let startDate = task.getLabelValue(constants.START_DATETIME_LABEL)
        let dueDate = task.getLabelValue(constants.DUE_DATETIME_LABEL)
        let recurrence = task.getLabelValue(constants.RECURRENCE_LABEL)
        if (
            (startDate) && (startDate != "")
            && (dueDate) && (dueDate != "")
        ){
            let vevent = new ical.Component("vevent")
            let event = new ical.Event(vevent)
            vevent.updatePropertyWithValue('dtstamp', now);
            event.uid = String(task.noteId)
            event.summary = String(task.title)
            event.startDate = ical.Time.fromJSDate(new Date(startDate))
            event.endDate = ical.Time.fromJSDate(new Date(dueDate))
            if (recurrence) {
                vevent.updatePropertyWithValue("rrule", ical.Recur.fromString(recurrence))
            }
            calendar.addSubcomponent(vevent)
        }
    }
    // Save ical data to file
    let icalString = calendar.toString()
    await api.runOnBackend((icalNoteId, icalString) => {
        const icalNote = api.getNote(icalNoteId)
        icalNote.setContent(icalString, {forceSave: true})
    }, [icalNoteId, icalString])
}


module.exports = {
    getMatchingProfile: getMatchingProfile,
    saveProfile: saveProfile,
    updateTaskLists: updateTaskLists,
    getTaskList: getTaskList,
    sendNotificationForDueTasks,
    rescheduleAllTasks,
    setCalendarEvents
}
