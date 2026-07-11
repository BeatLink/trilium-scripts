const notifications = require("libNotification.js")
const task = require("libAgendaTask.js")
const { generateCalendar } = require("libCalendar.js")
const multisort = require("libMultisort.js")
const { loadSettings, saveSettings } = require("libSettingsUI.jsx")


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
    // `noValuePrefix`/`noValueColor` (optional, "" = off) is the bucket for
    // notes whose label is missing/unmatched or whose date matched no interval;
    // carried through both shapes so getPrefixes/getColors can fall back to it.
    const noValue = variant.noValuePrefix ?? variant.noValueColor ?? ""
    if (variant.type === "label") {
        const children = Object.fromEntries(
            Object.values(variant.children || {}).map(entry => [entry.labelValue, entry.display])
        )
        return { name: variant.name, type: "label", label: variant.label, children, noValue }
    }
    return { name: variant.name, type: "dayjs", intervals: variant.intervals || {}, noValue }
}

// A grouping variant is shaped like a prefix/color variant, but each
// child/interval carries both `display` and `color` (a kanban column needs
// both at once, unlike prefixes/colors which are edited as two separate
// registries) — reassembled the same way, just keeping the extra field and,
// for the dayjs case, keeping each interval keyed by its own registry id
// (that key doubles as the column's group key, same as a label variant's
// `labelValue`).
function reshapeGrouping(grouping) {
    if (!grouping) return grouping
    // Optional named/colored bucket for notes matching no column ("" name = off,
    // fall back to KanbanView's generic "Ungrouped"). Kept on both shapes so
    // getGroupColumns can emit it as a real column and getGroups can target it.
    const noValue = { display: grouping.noValueDisplay || "", color: grouping.noValueColor || "" }
    if (grouping.type === "label") {
        const children = Object.fromEntries(
            Object.values(grouping.children || {}).map(entry => [entry.labelValue, { display: entry.display, color: entry.color }])
        )
        return { name: grouping.name, type: "label", label: grouping.label, children, noValue }
    }
    return { name: grouping.name, type: "dayjs", intervals: grouping.intervals || {}, noValue }
}

// `searchGroups`/`filterGroups` are their own top-level registries in the
// schema (shown on the Searches/Filters tabs respectively) — not nested
// inside `profiles`, so a group stays reachable from its own tab. Each
// group's `children` fully embeds its own searches/filters (name/rule/
// enabled, or name/type/rule-or-dateRuleId/enabled) directly, rather than
// referencing a separate shared `searches`/`filters` registry — nothing in
// this addon needs one search/filter shared across more than one group, so
// there's no indirection to keep in sync. Each group entry also carries a
// `profileId` (`reference` → `profiles`) saying which profile it belongs to.
// `groupsForProfile` filters down to just one
// profile's own groups and reshapes each into the `{groupId: {name,
// children}}` shape `getNotesForSearchGroups`/`getFilteredNotes` already
// iterate — dropping `profileId` itself, since it's already implied by which
// profile asked.
function groupsForProfile(allGroups, profileId) {
    return Object.fromEntries(
        Object.entries(allGroups)
            .filter(([, group]) => group.profileId === profileId)
            .map(([id, group]) => [id, { name: group.name, children: group.children }])
    )
}

// The inverse of `groupsForProfile`, for `saveProfile` writing an edited
// profile's own groups back into a shared top-level registry: every other
// profile's groups pass through untouched, this profile's own groups are
// replaced wholesale (added/edited/removed) with `profileId` re-attached.
function mergeProfileGroups(allGroups, profileId, ownGroups) {
    const merged = {}
    for (const [id, group] of Object.entries(allGroups)) {
        if (group.profileId !== profileId) merged[id] = group
    }
    for (const [id, group] of Object.entries(ownGroups)) {
        merged[id] = { name: group.name, profileId, children: group.children }
    }
    return merged
}

// A profile's `sortSelected`/`prefixSelected`/`colorSelected` (plain
// `reference` fields in the schema) become the `{selected: ...}` shape
// `updateTaskLists`/`getTaskList` read; its own search/filter groups (found
// via `groupsForProfile`) become the `{children: ...}` shape
// `getNotesForSearchGroups`/`getFilteredNotes` already iterate.
function reshapeProfile(profile, searchGroups, filterGroups, profileId) {
    return {
        name: profile.name,
        parentNoteId: profile.parentNoteId,
        viewNoteId: profile.viewNoteId,
        fileMode: profile.fileMode,
        searchGroups: { children: groupsForProfile(searchGroups, profileId) },
        filterGroups: { children: groupsForProfile(filterGroups, profileId) },
        sorts: { selected: profile.sortSelected },
        prefixes: { selected: profile.prefixSelected },
        colors: { selected: profile.colorSelected },
        groupings: { selected: profile.groupingSelected }
    }
}

// The inverse of `reshapeProfile`'s identity fields, for `saveProfile`
// writing an edited (legacy-shaped) profile back into the schema's
// decomposed shape — its groups are handled separately, via
// `mergeProfileGroups`, since they now live in a different top-level
// registry than the profile itself.
function unshapeProfile(profile) {
    return {
        name: profile.name,
        parentNoteId: profile.parentNoteId,
        viewNoteId: profile.viewNoteId,
        fileMode: profile.fileMode,
        sortSelected: profile.sorts?.selected,
        prefixSelected: profile.prefixes?.selected,
        colorSelected: profile.colors?.selected,
        groupingSelected: profile.groupings?.selected
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
    const groupings = Object.fromEntries(Object.entries(values.groupings || {}).map(([id, v]) => [id, reshapeGrouping(v)]))
    const profiles = Object.fromEntries(
        Object.entries(values.profiles || {}).map(([id, p]) => [
            id, reshapeProfile(p, values.searchGroups || {}, values.filterGroups || {}, id)
        ])
    )

    return {
        dateRules, sorts, prefixes, colors, groupings, profiles
    }
}

async function saveProfile(profile) {
    const { id, schemaNoteId, configNoteId, ...profileFields } = profile
    const values = await loadSettings(schemaNoteId, configNoteId)
    values.profiles = { ...(values.profiles || {}), [id]: unshapeProfile(profileFields) }
    values.searchGroups = mergeProfileGroups(values.searchGroups || {}, id, profileFields.searchGroups?.children || {})
    values.filterGroups = mergeProfileGroups(values.filterGroups || {}, id, profileFields.filterGroups?.children || {})
    await saveSettings(schemaNoteId, configNoteId, values)
}

async function getAllProfiles({ schemaNoteId, configNoteId, profileIds }) {
    const data = await loadData(schemaNoteId, configNoteId)
    return profileIds
        .filter(id => data.profiles[id])
        .map(id => ({ id, schemaNoteId, configNoteId, ...data.profiles[id] }))
}

// The overview widget binds to whichever note the user is browsing. A
// reparent profile claims its `parentNoteId` (the note its tasks are filed
// under); a virtual profile claims its `viewNoteId` (the render note that
// hosts its Task View). Either identifies the profile that "owns" the note.
async function getMatchingProfile({ schemaNoteId, configNoteId, profileIds }, overviewNoteId) {
    for (let profile of await getAllProfiles({ schemaNoteId, configNoteId, profileIds })) {
        const claimedNoteId = profile.fileMode === "virtual" ? profile.viewNoteId : profile.parentNoteId
        if (claimedNoteId && claimedNoteId == overviewNoteId) {
            return profile
        }
    }
}

async function deleteChildBranches(parentNoteId) {
    api.runOnBackend((parentNoteId) => {
        for (let note of api.getNote(parentNoteId).getChildNotes()) {
            api.toggleNoteInParent(false, note.noteId, parentNoteId)
        }
    }, [parentNoteId])
}

async function getNotesForSearchGroups(data, searchGroupsChildren) {
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

async function getFilteredNotes(data, filterGroupsChildren, notesList) {
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
                    const dateRule = data.dateRules[usage.dateRuleId]
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

async function getPrefixes(dateRules, prefixInfo, notesList) {
    let prefixDict = {}
    for (let note of notesList) {
        if (!prefixInfo) {
            prefixDict[note] = ""
        } else if (prefixInfo.type == "dayjs") {
            const noteObj = await api.getNote(note)
            for (let interval of Object.values(prefixInfo.intervals)) {
                const dateRule = dateRules[interval.dateRuleId]
                if (!dateRule) continue
                const date = noteObj.getLabelValue(dateRule.dateLabel)
                if (date && matchesDayJsCriteria(date, dateRule.rule, dateRule.useNumberOfDays)) {
                    prefixDict[note] = api.dayjs(date).format(interval.formatString)
                    break
                }
            }
            if (!(note in prefixDict)) prefixDict[note] = prefixInfo.noValue || ""
        } else if (prefixInfo["type"] == "label") {
            let noteLabel = (await api.getNote(note)).getLabelValue(prefixInfo["label"])
            let mapped = prefixInfo.children ? prefixInfo.children[noteLabel] : noteLabel
            prefixDict[note] = mapped ?? (prefixInfo.noValue || "")
        } else {
            prefixDict[note] = ""
        }
    }
    return prefixDict
}

async function getColors(dateRules, colorInfo, notesList) {
    let colorDict = {}
    for (let note of notesList) {
        if (!colorInfo) {
            colorDict[note] = ""
        } else if (colorInfo.type == "dayjs") {
            const noteObj = await api.getNote(note)
            for (let interval of Object.values(colorInfo.intervals)) {
                const dateRule = dateRules[interval.dateRuleId]
                if (!dateRule) continue
                const date = noteObj.getLabelValue(dateRule.dateLabel)
                if (date && matchesDayJsCriteria(date, dateRule.rule, dateRule.useNumberOfDays)) {
                    colorDict[note] = interval.color
                    break
                }
            }
            if (!(note in colorDict)) colorDict[note] = colorInfo.noValue || ""
        } else if (colorInfo["type"] == "label") {
            let noteLabel = (await api.getNote(note)).getLabelValue(colorInfo["label"])
            let mapped = colorInfo.children ? colorInfo.children[noteLabel] : noteLabel
            colorDict[note] = mapped ?? (colorInfo.noValue || "")
        } else {
            colorDict[note] = ""
        }
    }
    return colorDict
}

// Same matching logic as getPrefixes/getColors, but returns the group KEY
// (label value, or dayjs interval's own registry id) instead of a resolved
// display string — the caller looks the key up in getGroupColumns' output
// for display, and passes it back into setGroupForNote on drop.
// When a grouping defines a no-value bucket (noValue.display set), unmatched
// notes are keyed to NO_VALUE_KEY so getGroupColumns' matching column catches
// them; otherwise they stay `null` and fall into KanbanView's generic
// "Ungrouped" column.
const NO_VALUE_KEY = "__novalue__"

async function getGroups(dateRules, groupingInfo, notesList) {
    let groupDict = {}
    const unmatchedKey = groupingInfo?.noValue?.display ? NO_VALUE_KEY : null
    for (let note of notesList) {
        if (!groupingInfo) {
            groupDict[note] = null
        } else if (groupingInfo.type == "dayjs") {
            const noteObj = await api.getNote(note)
            for (let [intervalId, interval] of Object.entries(groupingInfo.intervals)) {
                const dateRule = dateRules[interval.dateRuleId]
                if (!dateRule) continue
                const date = noteObj.getLabelValue(dateRule.dateLabel)
                if (date && matchesDayJsCriteria(date, dateRule.rule, dateRule.useNumberOfDays)) {
                    groupDict[note] = intervalId
                    break
                }
            }
            if (!(note in groupDict)) groupDict[note] = unmatchedKey
        } else if (groupingInfo["type"] == "label") {
            let noteLabel = (await api.getNote(note)).getLabelValue(groupingInfo["label"])
            groupDict[note] = (noteLabel && groupingInfo.children?.[noteLabel]) ? noteLabel : unmatchedKey
        } else {
            groupDict[note] = null
        }
    }
    return groupDict
}

// Ordered column definitions for a kanban board's headers, independent of
// any particular note list — registry insertion order, same convention
// prefixes/colors already rely on.
function getGroupColumns(groupingInfo) {
    if (!groupingInfo) return []
    let columns
    if (groupingInfo.type === "label") {
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

// Per-profile Table View state (which columns are shown + the sort order) is
// stored in its own `tableViews` map in the config note, keyed by profile id,
// rather than as a field on the profile itself — the profile editor's autosave
// round-trips profiles through reshape/unshapeProfile, which would drop an
// unrecognised field, so keeping this separate keeps it durable. Shape:
//   values.tableViews[profileId] = { visible: {field: bool}, sort: [{column, dir}] }
async function getTableView({ schemaNoteId, configNoteId }, profileId) {
    const values = await loadSettings(schemaNoteId, configNoteId)
    return (values.tableViews || {})[profileId] || null
}

async function saveTableView({ schemaNoteId, configNoteId }, profileId, state) {
    const values = await loadSettings(schemaNoteId, configNoteId)
    values.tableViews = { ...(values.tableViews || {}), [profileId]: state }
    await saveSettings(schemaNoteId, configNoteId, values)
}

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



// Turns a virtual profile's user-chosen `viewNoteId` into a live Task View:
// makes that note a `render` note and points its `~renderNote` relation at
// the addon's shipped task-view code note (`taskViewNoteId`), so opening the
// note renders taskView.jsx. Find-or-set — safe to call every update; only
// touches the note when its type/relation is not already what we want.
async function configureViewNote(viewNoteId, taskViewNoteId) {
    if (!viewNoteId || !taskViewNoteId) return
    await api.runOnBackend((viewNoteId, taskViewNoteId) => {
        const note = api.getNote(viewNoteId)
        if (!note) return
        if (note.type !== "render" || note.mime !== "text/html") {
            note.type = "render"
            note.mime = "text/html"
            note.save()
        }
        if (note.getRelationValue("renderNote") !== taskViewNoteId) {
            note.setRelation("renderNote", taskViewNoteId)
        }
    }, [viewNoteId, taskViewNoteId])
}

async function updateTaskLists(profileContext, constants, icalNoteId, taskViewNoteId) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    let profiles = await getAllProfiles(profileContext)
    for (let profile of Object.values(profiles)) {
        //await deleteChildBranches(profile.parentNoteId)
        let allNotes = await getNotesForSearchGroups(data, profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(data, profile.filterGroups.children, allNotes)
        let sortedNotes = await sortNoteIds(data.sorts[profile.sorts.selected]?.rule || "", filteredNotes)
        if (profile.fileMode === "virtual") {
            await configureViewNote(profile.viewNoteId, taskViewNoteId)
        } else {
            let prefixDict = await getPrefixes(data.dateRules, data.prefixes[profile.prefixes.selected], sortedNotes)
            let colorDict = await getColors(data.dateRules, data.colors[profile.colors.selected], sortedNotes)
            await loadNotes(profile["parentNoteId"], sortedNotes, prefixDict, colorDict)
        }
        await setCalendarEvents(profileContext, constants, icalNoteId)
    }
}

async function getTaskList(profileContext) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    let profiles = await getAllProfiles(profileContext)
    for (let profile of Object.values(profiles)) {
        let allNotes = await getNotesForSearchGroups(data, profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(data, profile.filterGroups.children, allNotes)
        return filteredNotes
    }
    return []
}

// Like getTaskList, but sorted (getTaskList is intentionally left
// untouched — its existing callers don't need order, and this keeps their
// behavior/blast-radius unchanged). `profileId` lets a caller with more
// than one profile (e.g. a view page with a profile switcher) pick a
// specific one instead of always taking the first match.
async function getSortedTaskList(profileContext, profileId = null) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    let profiles = await getAllProfiles(profileContext)
    for (let profile of Object.values(profiles)) {
        if (profileId && profile.id !== profileId) continue
        let allNotes = await getNotesForSearchGroups(data, profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(data, profile.filterGroups.children, allNotes)
        return await sortNoteIds(data.sorts[profile.sorts.selected]?.rule || "", filteredNotes)
    }
    return []
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
    saveProfile,
    updateTaskLists,
    configureViewNote,
    getTaskList,
    getSortedTaskList,
    getGroups,
    getPrefixes,
    getColors,
    getGroupColumns,
    setGroupForNote,
    getTableView,
    saveTableView,
    sendNotificationForDueTasks,
    rescheduleAllTasks,
    setCalendarEvents
}
