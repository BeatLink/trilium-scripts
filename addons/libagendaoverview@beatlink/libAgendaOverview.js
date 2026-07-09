const notifications = require("libNotification.js")
const task = require("libAgendaTask.js")
const { generateCalendar } = require("libCalendar.js")
const multisort = require("libMultisort.js")
const { loadSettings, saveSettings } = require("libSettingsUI.jsx")


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

// --- Schema-driven settings adapter -----------------------------------------
//
// Every search/filter/sort/prefix/color/date-rule/profile this addon uses is
// declared as a `registry` field in agenda@beatlink's own schema.json (see
// libsettings@beatlink's README for the `registry`/`reference`/`showWhen`
// mechanics), edited directly via `SettingsForm` — this module never edits
// that data itself, only reads/reshapes it for the matching/sorting/prefix/
// color logic below, and writes back through the one `saveProfile` path a
// widget (rather than the schema-driven editor) needs for in-place edits.
//
// The schema stores a few things in a more decomposed shape than the actual
// matching logic wants, since the schema's job is to be editable (dropdowns,
// checkboxes) rather than to be the exact shape `matchesDayJsCriteria`/
// libmultisort expect. `loadData` reshapes on the way in, `saveProfile`
// reshapes on the way out; everything below `loadData` works in exactly the
// same shapes it always has, unaware any of this migrated off a bespoke
// data note onto libsettings.

// A Date Rule's `rule` tuple (`[operator, ...args]`, what `matchesDayJsCriteria`
// actually consumes) is decomposed in the schema into `operator`/`moment1`/
// `moment2`/`bracket` fields (so it can be edited as plain dropdowns) —
// this reassembles it, the inverse of the old `splitRule` UI helper.
function buildDayjsRule(dateRule) {
    const { operator, moment1, moment2, bracket } = dateRule
    if (operator === "isNull") return ["isNull"]
    if (operator === "isBetween") return [operator, moment1, moment2, null, bracket]
    return [operator, moment1]
}

// A Sort's `rule` (the libmultisort DSL string, `attribute[:desc][:caseInsensitive]`
// joined by `;`) is decomposed in the schema into a `criteria` list (so it can
// be edited as plain rows) — this reassembles it, the inverse of the old
// `parseSortCriteria` UI helper.
function criteriaToString(rows) {
    return (rows || [])
        .filter(r => r.attribute)
        .map(r => [r.attribute, r.desc ? "desc" : null, r.caseInsensitive ? "caseInsensitive" : null]
            .filter(Boolean).join(":"))
        .join(";")
}

// A label-value prefix/color variant's `children` is a `registry` in the
// schema (itemSchema `labelValue`+`display`, since a `registry`'s key is
// opaque bookkeeping, never the meaningful label value itself) rather than a
// flat `{labelValue: display}` map — this reassembles the flat map
// `getPrefixes`/`getColors` actually index into.
function reshapeVariant(variant) {
    if (!variant) return variant
    if (variant.type === "label") {
        const children = Object.fromEntries(
            Object.values(variant.children || {}).map(entry => [entry.labelValue, entry.display])
        )
        return { name: variant.name, type: "label", label: variant.label, children }
    }
    return { name: variant.name, type: "dayjs", intervals: variant.intervals || {} }
}

// A profile's `sortSelected`/`prefixSelected`/`colorSelected` (plain
// `reference` fields in the schema) become the `{selected: ...}` shape
// `updateTaskLists`/`getTaskList` read; `searchGroups`/`filterGroups` (each a
// `registry` of groups, itemSchema `name`+nested `children` registry of
// usages) become the `{children: ...}` shape `getNotesForSearchGroups`/
// `getFilteredNotes` already iterate.
function reshapeProfile(profile) {
    return {
        name: profile.name,
        parentNoteId: profile.parentNoteId,
        searchGroups: { children: profile.searchGroups || {} },
        filterGroups: { children: profile.filterGroups || {} },
        sorts: { selected: profile.sortSelected },
        prefixes: { selected: profile.prefixSelected },
        colors: { selected: profile.colorSelected }
    }
}

// The inverse of `reshapeProfile`, for `saveProfile` writing an edited
// (legacy-shaped) profile back into the schema's decomposed shape.
function unshapeProfile(profile) {
    return {
        name: profile.name,
        parentNoteId: profile.parentNoteId,
        sortSelected: profile.sorts?.selected,
        prefixSelected: profile.prefixes?.selected,
        colorSelected: profile.colors?.selected,
        searchGroups: profile.searchGroups?.children || {},
        filterGroups: profile.filterGroups?.children || {}
    }
}

async function loadData(schemaNoteId, configNoteId) {
    const values = await loadSettings(schemaNoteId, configNoteId)

    const dateRules = Object.fromEntries(
        Object.entries(values.dateRules || {}).map(([id, dateRule]) => [id, {
            name: dateRule.name,
            dateLabel: dateRule.dateLabel,
            useNumberOfDays: dateRule.useNumberOfDays,
            rule: buildDayjsRule(dateRule)
        }])
    )

    const sorts = Object.fromEntries(
        Object.entries(values.sorts || {}).map(([id, sort]) => [id, {
            name: sort.name,
            rule: criteriaToString(sort.criteria)
        }])
    )

    const prefixes = Object.fromEntries(Object.entries(values.prefixes || {}).map(([id, v]) => [id, reshapeVariant(v)]))
    const colors = Object.fromEntries(Object.entries(values.colors || {}).map(([id, v]) => [id, reshapeVariant(v)]))
    const profiles = Object.fromEntries(Object.entries(values.profiles || {}).map(([id, p]) => [id, reshapeProfile(p)]))

    return {
        searches: values.searches || {},
        filters: values.filters || {},
        dateRules, sorts, prefixes, colors, profiles
    }
}

async function saveProfile(profile) {
    const { id, schemaNoteId, configNoteId, ...profileFields } = profile
    const values = await loadSettings(schemaNoteId, configNoteId)
    values.profiles = { ...(values.profiles || {}), [id]: unshapeProfile(profileFields) }
    await saveSettings(schemaNoteId, configNoteId, values)
}

async function getAllProfiles({ schemaNoteId, configNoteId, profileIds }) {
    const data = await loadData(schemaNoteId, configNoteId)
    return profileIds
        .filter(id => data.profiles[id])
        .map(id => ({ id, schemaNoteId, configNoteId, ...data.profiles[id] }))
}

async function getMatchingProfile({ schemaNoteId, configNoteId, profileIds }, overviewNoteId) {
    for (let profile of await getAllProfiles({ schemaNoteId, configNoteId, profileIds })){
        if (profile["parentNoteId"] == overviewNoteId){
            return profile
        }
    }
}

async function deleteChildBranches(parentNoteId){
    api.runOnBackend((parentNoteId) => {
        for (let note of api.getNote(parentNoteId).getChildNotes()){
            api.toggleNoteInParent(false, note.noteId, parentNoteId)
        }
    }, [parentNoteId]);
}

async function getNotesForSearchGroups(data, searchGroupsChildren) {
    let allNotes = []
    for (const group of Object.values(searchGroupsChildren)){
        for (const usage of Object.values(group.children)){
            const element = data.searches[usage.elementId]
            if (usage.enabled && element){
                let noteIds = (await api.searchForNotes(element.rule)).map(note => note.noteId)
                allNotes = allNotes.concat(noteIds)
            }
        }
    }
    return allNotes
}

async function getFilteredNotes(data, filterGroupsChildren, notesList){
    let filterGroups = {}
    for (const [groupId, group] of Object.entries(filterGroupsChildren)){
        filterGroups[groupId] = []
        for (const usage of Object.values(group.children)){
            const element = data.filters[usage.elementId]
            if (usage.enabled && element){
                if (element.type == "search"){
                    let notes = (await api.searchForNotes(element.rule)).map(note => note.noteId)
                    filterGroups[groupId] = filterGroups[groupId].concat(notes)
                }
                if (element.type == "dayjs"){
                    const dateRule = data.dateRules[element.dateRuleId]
                    if (dateRule) {
                        for (let note of notesList){
                            let noteDate = (await api.getNote(note)).getLabelValue(dateRule.dateLabel)
                            if (matchesDayJsCriteria(noteDate, dateRule.rule, dateRule.useNumberOfDays)){
                                filterGroups[groupId].push(note)
                            }
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

async function getPrefixes(dateRules, prefixInfo, notesList) {
    let prefixDict = {}
    for (let note of notesList){
        if (!prefixInfo) {
            prefixDict[note] = ""
        } else if (prefixInfo.type == "dayjs"){
            const noteObj = await api.getNote(note)
            for (let interval of Object.values(prefixInfo.intervals)) {
                const dateRule = dateRules[interval.dateRuleId]
                if (!dateRule) continue
                const date = noteObj.getLabelValue(dateRule.dateLabel)
                if (date && matchesDayJsCriteria(date, dateRule.rule, dateRule.useNumberOfDays)){
                    prefixDict[note] = api.dayjs(date).format(interval.formatString)
                    break
                }
            }
            if (!(note in prefixDict)) prefixDict[note] = "No Date Set"
        } else if (prefixInfo["type"] == "label"){
            let noteLabel = (await api.getNote(note)).getLabelValue(prefixInfo["label"])
            prefixDict[note] = prefixInfo.children ? prefixInfo.children[noteLabel] : noteLabel
        } else {
            prefixDict[note] = ""
        }
    }
    return prefixDict
}

async function getColors(dateRules, colorInfo, notesList) {
    let colorDict = {}
    for (let note of notesList){
        if (!colorInfo) {
            colorDict[note] = ""
        } else if (colorInfo.type == "dayjs"){
            const noteObj = await api.getNote(note)
            for (let interval of Object.values(colorInfo.intervals)) {
                const dateRule = dateRules[interval.dateRuleId]
                if (!dateRule) continue
                const date = noteObj.getLabelValue(dateRule.dateLabel)
                if (date && matchesDayJsCriteria(date, dateRule.rule, dateRule.useNumberOfDays)){
                    colorDict[note] = interval.color
                    break
                }
            }
            if (!(note in colorDict)) colorDict[note] = ""
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



async function updateTaskLists(profileContext, constants, icalNoteId) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    let profiles = await getAllProfiles(profileContext)
    for (let profile of Object.values(profiles)){
        //await deleteChildBranches(profile.parentNoteId)
        let allNotes = await getNotesForSearchGroups(data, profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(data, profile.filterGroups.children, allNotes)
        let sortedNotes = await sortNoteIds(data.sorts[profile.sorts.selected]?.rule || "", filteredNotes)
        let prefixDict = await getPrefixes(data.dateRules, data.prefixes[profile.prefixes.selected], sortedNotes)
        let colorDict = await getColors(data.dateRules, data.colors[profile.colors.selected], sortedNotes)
        await loadNotes(profile["parentNoteId"], sortedNotes, prefixDict, colorDict)
        await setCalendarEvents(profileContext, constants, icalNoteId)
    }
}

async function getTaskList(profileContext) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    let profiles = await getAllProfiles(profileContext)
    for (let profile of Object.values(profiles)){
        let allNotes = await getNotesForSearchGroups(data, profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(data, profile.filterGroups.children, allNotes)
        return filteredNotes
    }
    return []
}

async function sendNotificationForDueTasks(profileContext, constants){
    const taskList = await getTaskList(profileContext)
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

async function rescheduleAllTasks(profileContext, constants, icalNoteId, days = 0){
    const taskList = await getTaskList(profileContext)
    for (const taskId of taskList){
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
        icalNote.setContent(icalString, {forceSave: true})
    }, [icalNoteId, icalString])
}


module.exports = {
    loadData,
    getMatchingProfile,
    getAllProfiles,
    saveProfile,
    updateTaskLists,
    getTaskList,
    sendNotificationForDueTasks,
    rescheduleAllTasks,
    setCalendarEvents
}
