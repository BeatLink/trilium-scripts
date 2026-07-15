const task = require("libAgendaTask.js")
const multisort = require("libMultisort.js")
const config = require("libAgendaConfig.js")
const { loadData, getActiveProfile, getAllProfiles } = config

const NO_VALUE_KEY = "__novalue__"

// Evaluates a dayjs date rule (e.g. ["isBefore", "endOfToday"]) against a date
// string. Named moments in the rule are resolved relative to now.
function matchesDayJsCriteria(dateString, dateCriteriaList, useNumberOfDays) {
    const now = api.dayjs()
    const startOfToday = now.startOf("day")
    const namedMoments = {
        now,
        startOfToday,
        endOfToday: now.endOf("day"),
        endOfTomorrow: now.endOf("day").add(1, "day"),
        endOfThisWeek: useNumberOfDays ? startOfToday.add(7, "day") : now.endOf("week"),
        endOfThisMonth: useNumberOfDays ? startOfToday.add(30, "day") : now.endOf("month"),
        endOfThisYear: useNumberOfDays ? startOfToday.add(365, "day") : now.endOf("year"),
    }

    const [dayjsMethod, ...rawParameters] = dateCriteriaList
    const parameters = rawParameters.map(parameter =>
        parameter in namedMoments ? namedMoments[parameter] : parameter)

    if (dayjsMethod === "isNull") return !dateString
    return Boolean(api.dayjs(dateString)[dayjsMethod](...parameters))
}

// Collects note ids from every enabled search rule across all search groups.
async function getNotesForSearchGroups(searchGroupsChildren) {
    const noteIds = []
    for (const group of Object.values(searchGroupsChildren)) {
        for (const usage of Object.values(group.children)) {
            if (usage.enabled && usage.rule) {
                const matches = await api.searchForNotes(usage.rule)
                noteIds.push(...matches.map(note => note.noteId))
            }
        }
    }
    return noteIds
}

// Resolves an enabled filter usage to the set of note ids it permits.
async function noteIdsMatchingFilter(usage, dateRules, candidateNoteIds) {
    if (usage.type === "search" && usage.rule) {
        const matches = await api.searchForNotes(usage.rule)
        return matches.map(note => note.noteId)
    }
    if (usage.type === "dayjs") {
        const dateRule = dateRules[usage.dateRuleId]
        if (!dateRule) return []
        const passing = []
        for (const noteId of candidateNoteIds) {
            const noteDate = (await api.getNote(noteId)).getLabelValue(dateRule.dateLabel)
            if (matchesDayJsCriteria(noteDate, dateRule.rule, dateRule.useNumberOfDays)) {
                passing.push(noteId)
            }
        }
        return passing
    }
    return []
}

// Keeps only notes that pass every filter group (each group is an AND).
async function getFilteredNotes(dateRules, filterGroupsChildren, notesList) {
    const allowedByGroup = {}
    for (const [groupId, group] of Object.entries(filterGroupsChildren)) {
        allowedByGroup[groupId] = []
        for (const usage of Object.values(group.children)) {
            if (!usage.enabled) continue
            const matches = await noteIdsMatchingFilter(usage, dateRules, notesList)
            allowedByGroup[groupId].push(...matches)
        }
    }
    return notesList.filter(noteId =>
        Object.values(allowedByGroup).every(allowed => allowed.includes(noteId)))
}

async function sortNoteIds(sortString, noteIds) {
    const notes = await Promise.all(noteIds.map(noteId => api.getNote(noteId)))
    const sorted = multisort.sortChildNotes(sortString, notes)
    return sorted.map(note => note.noteId)
}

// Classifies a single note against grouping/prefix/color "info" config and
// returns a descriptor the caller can turn into its own value. Returns null
// when the note does not match, letting callers apply their own fallback.
async function classifyNote(noteId, info, dateRules) {
    if (info.type === "dayjs") {
        const note = await api.getNote(noteId)
        for (const [intervalId, interval] of Object.entries(info.intervals || {})) {
            const dateRule = dateRules[interval.dateRuleId]
            if (!dateRule) continue
            const date = note.getLabelValue(dateRule.dateLabel)
            if (date && matchesDayJsCriteria(date, dateRule.rule, dateRule.useNumberOfDays)) {
                return { kind: "dayjs", intervalId, interval, date }
            }
        }
        return null
    }
    if (info.type === "label") {
        const labelValue = (await api.getNote(noteId)).getLabelValue(info.label)
        return { kind: "label", labelValue }
    }
    if (info.type === "recurrence") {
        const recurrence = (await api.getNote(noteId)).getLabelValue(info.label)
        return { kind: "recurrence", frequency: task.frequencyOf(recurrence) }
    }
    return null
}

// Builds a { noteId -> value } map by classifying each note and passing its
// descriptor (or null) to toValue.
async function mapNotes(noteIds, info, dateRules, toValue) {
    const result = {}
    for (const noteId of noteIds) {
        const match = info ? await classifyNote(noteId, info, dateRules) : null
        result[noteId] = toValue(match)
    }
    return result
}

async function getPrefixes(dateRules, prefixInfo, notesList) {
    const noValue = prefixInfo ? (prefixInfo.noValue || "") : ""
    return mapNotes(notesList, prefixInfo, dateRules, (match) => {
        if (!match) return noValue
        if (match.kind === "dayjs") return api.dayjs(match.date).format(match.interval.formatString)
        // label and recurrence matches both fall back to the label-value lookup;
        // recurrence has no labelValue, so it resolves to noValue.
        const mapped = prefixInfo.children ? prefixInfo.children[match.labelValue] : match.labelValue
        return mapped ?? noValue
    })
}

async function getColors(dateRules, colorInfo, notesList) {
    const noValue = colorInfo ? (colorInfo.noValue || "") : ""
    return mapNotes(notesList, colorInfo, dateRules, (match) => {
        if (!match) return noValue
        if (match.kind === "dayjs") return match.interval.color
        const mapped = colorInfo.children ? colorInfo.children[match.labelValue] : match.labelValue
        return mapped ?? noValue
    })
}

async function getGroups(dateRules, groupingInfo, notesList) {
    const unmatchedKey = groupingInfo?.noValue?.display ? NO_VALUE_KEY : null
    const hasChild = (key) => Boolean(groupingInfo.children?.[key])
    return mapNotes(notesList, groupingInfo, dateRules, (match) => {
        if (!match) return unmatchedKey
        if (match.kind === "dayjs") return match.intervalId
        if (match.kind === "recurrence") return hasChild(match.frequency) ? match.frequency : unmatchedKey
        return (match.labelValue && hasChild(match.labelValue)) ? match.labelValue : unmatchedKey
    })
}

function getGroupColumns(groupingInfo) {
    if (!groupingInfo) return []

    let columns
    if (groupingInfo.type === "label" || groupingInfo.type === "recurrence") {
        columns = Object.entries(groupingInfo.children || {})
            .map(([key, child]) => ({ key, display: child.display, color: child.color }))
    } else if (groupingInfo.type === "dayjs") {
        columns = Object.entries(groupingInfo.intervals || {})
            .map(([key, interval]) => ({ key, display: interval.display, color: interval.color }))
    } else {
        return []
    }

    if (groupingInfo.noValue?.display) {
        columns.push({
            key: NO_VALUE_KEY,
            display: groupingInfo.noValue.display,
            color: groupingInfo.noValue.color || null,
            droppable: false
        })
    }
    return columns
}

async function setGroupForNote(groupingInfo, noteId, targetGroupKey) {
    if (!groupingInfo || groupingInfo.type !== "label") return
    await api.runOnBackend((noteId, label, value) => {
        api.getNote(noteId).setLabel(label, value)
    }, [noteId, groupingInfo.label, targetGroupKey])
}

async function getTaskList(profileContext) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    const profile = await getActiveProfile(profileContext)
    if (!profile) return []
    const searchedNotes = await getNotesForSearchGroups(profile.searchGroups.children)
    return getFilteredNotes(data.dateRules, profile.filterGroups.children, searchedNotes)
}

async function getSortedTaskList(profileContext, profileId = null) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)

    let profile
    if (profileId) {
        const profiles = await getAllProfiles(profileContext)
        profile = profiles.find(candidate => candidate.id === profileId)
    } else {
        profile = await getActiveProfile(profileContext)
    }
    if (!profile) return []

    const searchedNotes = await getNotesForSearchGroups(profile.searchGroups.children)
    const filteredNotes = await getFilteredNotes(data.dateRules, profile.filterGroups.children, searchedNotes)
    const sortRule = data.sorts[profile.sorts.selected]?.rule || ""
    return sortNoteIds(sortRule, filteredNotes)
}

module.exports = {
    NO_VALUE_KEY,
    matchesDayJsCriteria,
    getNotesForSearchGroups,
    getFilteredNotes,
    sortNoteIds,
    getPrefixes,
    getColors,
    getGroups,
    getGroupColumns,
    setGroupForNote,
    getTaskList,
    getSortedTaskList,
    // Re-exported so libAgendaOverview reaches config/task through this single
    // module instead of requiring libAgendaConfig and libAgendaTask directly,
    // which would bundle them twice (once here, once there) in each widget.
    loadData: config.loadData,
    saveProfile: config.saveProfile,
    getAllProfiles: config.getAllProfiles,
    getActiveProfile: config.getActiveProfile,
    setActiveProfile: config.setActiveProfile,
    getMatchingProfile: config.getMatchingProfile,
    getSectionState: config.getSectionState,
    saveSectionState: config.saveSectionState,
    refreshDisplayLabels: task.refreshDisplayLabels,
    rescheduleByDays: task.rescheduleByDays
}
