const task = require("libAgendaTask.js")
const multisort = require("libMultisort.js")
const { loadData, getActiveProfile, getAllProfiles } = require("libAgendaConfig.js")

function matchesDayJsCriteria(dateString, dateCriteriaList, useNumberOfDays) {
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
    for (const [index, parameter] of dateParameters.entries()) {
        dateParameters[index] = parameter in dateVars ? dateVars[parameter] : dateParameters[index]
    }
    let date = api.dayjs(dateString)
    if (dateFunction === "isNull") {
        return !dateString
    } else {
        return date[dateFunction](...dateParameters) ? true : false
    }
}

async function getNotesForSearchGroups(searchGroupsChildren) {
    let allNotes = []
    for (const group of Object.values(searchGroupsChildren)) {
        for (const usage of Object.values(group.children)) {
            if (usage.enabled && usage.rule) {
                let noteIds = (await api.searchForNotes(usage.rule)).map(note => note.noteId)
                allNotes = allNotes.concat(noteIds)
            }
        }
    }
    return allNotes
}

async function getFilteredNotes(dateRules, filterGroupsChildren, notesList) {
    let filterGroups = {}
    for (const [groupId, group] of Object.entries(filterGroupsChildren)) {
        filterGroups[groupId] = []
        for (const usage of Object.values(group.children)) {
            if (usage.enabled) {
                if (usage.type == "search" && usage.rule) {
                    let notes = (await api.searchForNotes(usage.rule)).map(note => note.noteId)
                    filterGroups[groupId] = filterGroups[groupId].concat(notes)
                }
                if (usage.type == "dayjs") {
                    const dateRule = dateRules[usage.dateRuleId]
                    if (dateRule) {
                        for (let note of notesList) {
                            let noteDate = (await api.getNote(note)).getLabelValue(dateRule.dateLabel)
                            if (matchesDayJsCriteria(noteDate, dateRule.rule, dateRule.useNumberOfDays)) {
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
        noteId => Object.values(filterGroups).every(
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

// One matcher for prefixes, colors, and groupings — they share the same
// dayjs-interval / label / recurrence-frequency matching skeleton and differ
// only in what a matched bucket resolves to. `resolve(match)` picks that:
//   - dayjs match: resolve({ interval, intervalId, date })
//   - label match: resolve({ noteLabel })  (also called for a MISSING label so
//     the caller can decide whether to map it or fall back)
//   - recurrence match: resolve({ freq })
// `unmatched` is the value used when nothing matched. Returns `{noteId: value}`.
async function matchNotes(dateRules, info, notesList, resolve, unmatched) {
    const result = {}
    for (const note of notesList) {
        if (!info) {
            result[note] = unmatched
            continue
        }
        if (info.type == "dayjs") {
            const noteObj = await api.getNote(note)
            let matched = false
            for (const [intervalId, interval] of Object.entries(info.intervals || {})) {
                const dateRule = dateRules[interval.dateRuleId]
                if (!dateRule) continue
                const date = noteObj.getLabelValue(dateRule.dateLabel)
                if (date && matchesDayJsCriteria(date, dateRule.rule, dateRule.useNumberOfDays)) {
                    result[note] = resolve({ interval, intervalId, date })
                    matched = true
                    break
                }
            }
            if (!matched) result[note] = unmatched
        } else if (info.type == "label") {
            const noteLabel = (await api.getNote(note)).getLabelValue(info.label)
            result[note] = resolve({ noteLabel })
        } else if (info.type == "recurrence") {
            // Bucket by the RRULE frequency token (from the label the grouping
            // carries in `label`), not the raw rule.
            const rrule = (await api.getNote(note)).getLabelValue(info.label)
            result[note] = resolve({ freq: task.frequencyOf(rrule) })
        } else {
            result[note] = unmatched
        }
    }
    return result
}

async function getPrefixes(dateRules, prefixInfo, notesList) {
    return matchNotes(dateRules, prefixInfo, notesList, (m) => {
        if ("date" in m) return api.dayjs(m.date).format(m.interval.formatString)
        // label
        const mapped = prefixInfo.children ? prefixInfo.children[m.noteLabel] : m.noteLabel
        return mapped ?? (prefixInfo.noValue || "")
    }, prefixInfo ? (prefixInfo.noValue || "") : "")
}

async function getColors(dateRules, colorInfo, notesList) {
    return matchNotes(dateRules, colorInfo, notesList, (m) => {
        if ("date" in m) return m.interval.color
        const mapped = colorInfo.children ? colorInfo.children[m.noteLabel] : m.noteLabel
        return mapped ?? (colorInfo.noValue || "")
    }, colorInfo ? (colorInfo.noValue || "") : "")
}

// Same matching logic as getPrefixes/getColors, but returns the group KEY
// (label value, or dayjs interval's own registry id) instead of a resolved
// display string — the caller looks the key up in getGroupColumns' output
// for display, and passes it back into setGroupForNote on drop.
// When a grouping defines a no-value bucket (noValue.display set), unmatched
// notes are keyed to NO_VALUE_KEY so getGroupColumns' matching column catches
// them; otherwise they stay `null` and fall into a generic "Ungrouped" column.
const NO_VALUE_KEY = "__novalue__"

async function getGroups(dateRules, groupingInfo, notesList) {
    const unmatchedKey = groupingInfo?.noValue?.display ? NO_VALUE_KEY : null
    return matchNotes(dateRules, groupingInfo, notesList, (m) => {
        if ("intervalId" in m) return m.intervalId
        if ("freq" in m) return groupingInfo.children?.[m.freq] ? m.freq : unmatchedKey
        // label
        return (m.noteLabel && groupingInfo.children?.[m.noteLabel]) ? m.noteLabel : unmatchedKey
    }, unmatchedKey)
}

// Ordered column definitions for a kanban board's headers, independent of
// any particular note list — registry insertion order, same convention
// prefixes/colors already rely on.
function getGroupColumns(groupingInfo) {
    if (!groupingInfo) return []
    let columns
    if (groupingInfo.type === "label" || groupingInfo.type === "recurrence") {
        columns = Object.entries(groupingInfo.children || {}).map(([key, v]) => ({ key, display: v.display, color: v.color }))
    } else if (groupingInfo.type === "dayjs") {
        columns = Object.entries(groupingInfo.intervals || {}).map(([key, interval]) => ({ key, display: interval.display, color: interval.color }))
    } else {
        return []
    }
    // Explicit no-value bucket column (read-only: droppable=false so a drag
    // can't write the sentinel key as a label). Matches getGroups' NO_VALUE_KEY.
    if (groupingInfo.noValue?.display) {
        columns.push({ key: NO_VALUE_KEY, display: groupingInfo.noValue.display, color: groupingInfo.noValue.color || null, droppable: false })
    }
    return columns
}

// The write side of a kanban drag-drop: only meaningful for type:"label"
// groupings, since dropping a card writes the underlying note label
// directly (e.g. #priority) so every other view (prefix/color/search/
// filter) reading that same label stays in sync. type:"dayjs" groupings are
// read-only for kanban purposes (a column is a date window, not a settable
// value) — callers must disable drag entirely for those, not rely on this
// silently no-op-ing.
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
    let allNotes = await getNotesForSearchGroups(profile.searchGroups.children)
    return await getFilteredNotes(data.dateRules, profile.filterGroups.children, allNotes)
}

// Like getTaskList, but sorted. `profileId` lets a caller with its own
// profile switcher (e.g. the Task View page) pick a specific profile; when
// omitted it falls back to the active profile, matching getTaskList.
async function getSortedTaskList(profileContext, profileId = null) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    let profile
    if (profileId) {
        const profiles = await getAllProfiles(profileContext)
        profile = profiles.find(p => p.id === profileId)
    } else {
        profile = await getActiveProfile(profileContext)
    }
    if (!profile) return []
    let allNotes = await getNotesForSearchGroups(profile.searchGroups.children)
    let filteredNotes = await getFilteredNotes(data.dateRules, profile.filterGroups.children, allNotes)
    return await sortNoteIds(data.sorts[profile.sorts.selected]?.rule || "", filteredNotes)
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
    getSortedTaskList
}
