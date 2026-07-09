const notifications = require("libNotification.js")
const task = require("libAgendaTask.js")
const { generateCalendar } = require("libCalendar.js")
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

// --- Consolidated data note ------------------------------------------------
//
// Every search/filter/sort/prefix/color a profile can use is a named,
// shared "element" living in one of the top-level registries below; a
// profile only ever stores references (elementId + per-usage enabled flag)
// into those registries, never a copy of the definition itself. `dateRules`
// is the same idea one level deeper: the actual `["isBefore","startOfToday"]`-
// style dayjs criteria tuple a dayjs-type filter or a prefix/color interval
// tests against is itself a named, shared element — a filter, a prefix
// interval, and a color interval that all mean "overdue" reference the same
// `dateRules` entry instead of each retyping the same tuple independently.
//
// The built-in registry entries the addon ships (`builtin: true`) live in a
// separate, non-persisted note (builtinElementsNote) that TAM overwrites on
// every update like any other addon note — this is what lets new built-ins
// reach existing installs. The persisted data note (dataNoteId) holds only
// the user's own deltas: added elements, edits to a built-in (keyed by the
// same elementId, shadowing the shipped version), `removedBuiltinIds` for any
// built-in the user deleted, and every profile. `loadData` merges the two;
// `saveData` diffs the caller's edited view back down to just the delta
// before persisting, so an untouched built-in never gets baked into the
// persisted note and blocks future updates.

const CATEGORIES = ["searches", "dateRules", "filters", "sorts", "prefixes", "colors"]

const EMPTY_DATA = {
    searches: {}, filters: {}, dateRules: {}, sorts: {}, prefixes: {}, colors: {},
    removedBuiltinIds: { searches: [], dateRules: [], filters: [], sorts: [], prefixes: [], colors: [] },
    profiles: {}
}

// Older installs' data note held exactly one profile's fields at the
// top level (name/parentNoteId/searchGroups/...), with every search/filter
// rule inlined directly into that one profile and sorts/prefixes/colors each
// holding their own full list of named presets. Detected by the absence of
// `profiles` (new shape's only top-level profile container) alongside the
// presence of `searchGroups` (old shape's own top-level field). Promotes
// every inlined leaf definition into the appropriate shared registry once,
// rewriting the profile itself to hold only references — callers persist
// the result via saveData so this only ever runs once per install.
function migrateLegacyData(raw) {
    if (!raw || raw.profiles || !raw.searchGroups) return raw

    const data = { searches: {}, filters: {}, sorts: {}, prefixes: {}, colors: {}, profiles: {} }

    function migrateLeafGroups(groupsSection, registry, extraFromGroup) {
        const migratedGroups = {}
        for (const [groupId, group] of Object.entries(groupsSection.children || {})) {
            const children = {}
            for (const [itemId, item] of Object.entries(group.children || {})) {
                const elementId = `${groupId}-${itemId}`
                registry[elementId] = {
                    name: item.name,
                    rule: item.rule,
                    ...(extraFromGroup ? extraFromGroup(group) : {})
                }
                children[itemId] = { elementId, enabled: !!item.enabled }
            }
            migratedGroups[groupId] = { name: group.name, expanded: !!group.expanded, children }
        }
        return { expanded: !!groupsSection.expanded, children: migratedGroups }
    }

    const searchGroups = migrateLeafGroups(raw.searchGroups, data.searches)
    const filterGroups = migrateLeafGroups(raw.filterGroups, data.filters, group => ({
        type: group.type,
        datetimeLabel: group.datetimeLabel,
        useNumberOfDays: !!group.useNumberOfDays
    }))

    for (const [key, sort] of Object.entries(raw.sorts?.children || {})) {
        data.sorts[key] = { name: sort.name, rule: sort.rule }
    }
    for (const [key, variant] of Object.entries(raw.prefixes?.children || {})) {
        data.prefixes[key] = { ...variant }
    }
    for (const [key, variant] of Object.entries(raw.colors?.children || {})) {
        data.colors[key] = { ...variant }
    }

    data.profiles.default = {
        name: raw.name || "default",
        parentNoteId: raw.parentNoteId || "",
        searchGroups,
        filterGroups,
        sorts: { selected: raw.sorts?.selected },
        prefixes: { selected: raw.prefixes?.selected },
        colors: { selected: raw.colors?.selected }
    }

    return data
}

// Hoists every inline dayjs criteria tuple (a dayjs-type filter's own
// `rule`, a prefix/color interval's own `rule`) out into the shared
// `dateRules` registry, rewriting each in place to hold a `dateRuleId`
// reference instead — same one-time, self-healing pattern as
// migrateLegacyData (detected by the absence of a `dateRules` key at all),
// and composes with it: an install migrating up from the single-profile
// shape gets both migrations in one pass, since this runs after
// migrateLegacyData has already produced inline-ruled filters/prefixes/colors.
function migrateInlineDateRules(data) {
    if (data.dateRules) return data

    const dateRules = {}
    let counter = 0
    function hoist(rule, name) {
        counter += 1
        const id = `date-rule-${counter}`
        dateRules[id] = { name: name || "Date Rule", rule }
        return id
    }

    for (const filter of Object.values(data.filters || {})) {
        if (filter.type === "dayjs" && filter.rule) {
            filter.dateRuleId = hoist(filter.rule, filter.name)
            delete filter.rule
        }
    }
    for (const variant of [...Object.values(data.prefixes || {}), ...Object.values(data.colors || {})]) {
        if (variant.type !== "dayjs") continue
        for (const interval of Object.values(variant.intervals || {})) {
            if (interval.rule) {
                interval.dateRuleId = hoist(interval.rule, `${variant.name} interval`)
                delete interval.rule
            }
        }
    }

    data.dateRules = dateRules
    return data
}

async function loadBuiltinElements(builtinElementsNoteId) {
    if (!builtinElementsNoteId) return {}
    const note = await api.getNote(builtinElementsNoteId)
    return JSON.parse((await note.getContent()) || "{}")
}

// Splits an edited *effective* (shipped-merged-with-persisted) registry view
// back down into: the delta worth persisting (anything absent from, or
// different than, the shipped defaults — i.e. user additions and edits) and
// the set of shipped built-in ids no longer present (i.e. the user deleted
// them). Used both by saveData on every write and, once, by
// migrateBuiltinSplit to carve up an old install's fully-inlined data.
function diffFromBuiltins(shipped, effective) {
    const persisted = {}
    const removedBuiltinIds = {}
    for (const category of CATEGORIES) {
        persisted[category] = {}
        removedBuiltinIds[category] = []
        const shippedCategory = shipped[category] || {}
        for (const [elementId, element] of Object.entries(effective[category] || {})) {
            const shippedElement = shippedCategory[elementId]
            if (!shippedElement || JSON.stringify(shippedElement) !== JSON.stringify(element)) {
                persisted[category][elementId] = element
            }
        }
        for (const elementId of Object.keys(shippedCategory)) {
            if (!(elementId in (effective[category] || {}))) {
                removedBuiltinIds[category].push(elementId)
            }
        }
    }
    return { persisted, removedBuiltinIds }
}

function mergeRegistries(shipped, persisted, removedBuiltinIds) {
    const merged = {}
    for (const category of CATEGORIES) {
        merged[category] = {}
        const removed = (removedBuiltinIds && removedBuiltinIds[category]) || []
        for (const [elementId, element] of Object.entries(shipped[category] || {})) {
            if (!removed.includes(elementId)) merged[category][elementId] = element
        }
        Object.assign(merged[category], persisted[category] || {})
    }
    return merged
}

// One-time migration for installs from before builtinElementsNote existed:
// their persisted note holds every built-in inlined alongside user data.
// Reuses diffFromBuiltins against the now-shipped defaults to strip anything
// unchanged (it'll come back for free via the merge in loadData), keep any
// user edits/additions as a delta, and record deletions.
function migrateBuiltinSplit(data, shipped) {
    if (data.removedBuiltinIds) return data
    const { persisted, removedBuiltinIds } = diffFromBuiltins(shipped, { ...EMPTY_DATA, ...data })
    return { ...persisted, profiles: data.profiles || {}, removedBuiltinIds }
}

async function loadRawData(dataNoteId) {
    const note = await api.getNote(dataNoteId)
    return JSON.parse((await note.getContent()) || "{}")
}

async function saveRawData(dataNoteId, data){
    await api.runOnBackend((dataNoteId, data) => {
        api.getNote(dataNoteId).setJsonContent(data)
    }, [dataNoteId, data]);
}

async function loadData(dataNoteId, builtinElementsNoteId) {
    const raw = await loadRawData(dataNoteId)
    let migrated = migrateLegacyData(raw)
    migrated = migrateInlineDateRules(migrated)

    const shipped = await loadBuiltinElements(builtinElementsNoteId)
    migrated = migrateBuiltinSplit(migrated, shipped)

    if (migrated !== raw) await saveRawData(dataNoteId, migrated)

    const merged = mergeRegistries(shipped, migrated, migrated.removedBuiltinIds)
    return { ...EMPTY_DATA, ...migrated, ...merged }
}

async function saveData(dataNoteId, builtinElementsNoteId, effectiveData){
    const shipped = await loadBuiltinElements(builtinElementsNoteId)
    const { persisted, removedBuiltinIds } = diffFromBuiltins(shipped, effectiveData)
    await saveRawData(dataNoteId, { ...persisted, profiles: effectiveData.profiles || {}, removedBuiltinIds })
}

async function getAllProfiles({ dataNoteId, builtinElementsNoteId, profileIds }) {
    const data = await loadData(dataNoteId, builtinElementsNoteId)
    return profileIds
        .filter(id => data.profiles[id])
        .map(id => ({ id, dataNoteId, builtinElementsNoteId, ...data.profiles[id] }))
}

async function getMatchingProfile({ dataNoteId, builtinElementsNoteId, profileIds }, overviewNoteId) {
    for (let profile of await getAllProfiles({ dataNoteId, builtinElementsNoteId, profileIds })){
        if (profile["parentNoteId"] == overviewNoteId){
            return profile
        }
    }
}

async function saveProfile(profile){
    const { id, dataNoteId, builtinElementsNoteId, ...profileFields } = profile
    const data = await loadData(dataNoteId, builtinElementsNoteId)
    data.profiles[id] = profileFields
    await saveData(dataNoteId, builtinElementsNoteId, data)
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
                            let noteDate = (await api.getNote(note)).getLabelValue(element.datetimeLabel)
                            if (matchesDayJsCriteria(noteDate, dateRule.rule, element.useNumberOfDays)){
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
            let date = (await api.getNote(note)).getLabelValue(prefixInfo.dateLabel)
            if (date) {
                for (let interval of Object.values(prefixInfo.intervals)) {
                    const dateRule = dateRules[interval.dateRuleId]
                    if (dateRule && matchesDayJsCriteria(date, dateRule.rule, prefixInfo.useNumberOfDays)){
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

async function getColors(dateRules, colorInfo, notesList) {
    let colorDict = {}
    for (let note of notesList){
        if (!colorInfo) {
            colorDict[note] = ""
        } else if (colorInfo.type == "dayjs"){
            let date = (await api.getNote(note)).getLabelValue(colorInfo.dateLabel)
            if (date) {
                for (let interval of Object.values(colorInfo.intervals)) {
                    const dateRule = dateRules[interval.dateRuleId]
                    if (dateRule && matchesDayJsCriteria(date, dateRule.rule, colorInfo.useNumberOfDays)){
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



async function updateTaskLists(profileContext, constants, icalNoteId) {
    const data = await loadData(profileContext.dataNoteId, profileContext.builtinElementsNoteId)
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
    const data = await loadData(profileContext.dataNoteId, profileContext.builtinElementsNoteId)
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
    saveData,
    getMatchingProfile,
    getAllProfiles,
    saveProfile,
    updateTaskLists,
    getTaskList,
    sendNotificationForDueTasks,
    rescheduleAllTasks,
    setCalendarEvents
}
