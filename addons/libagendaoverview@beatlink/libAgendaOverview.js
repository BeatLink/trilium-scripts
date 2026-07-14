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
    if (grouping.type === "label" || grouping.type === "recurrence") {
        const children = Object.fromEntries(
            Object.values(grouping.children || {}).map(entry => [entry.labelValue, { display: entry.display, color: entry.color }])
        )
        return { name: grouping.name, type: grouping.type, label: grouping.label, children, noValue }
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
        viewType: profile.viewType,
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
        viewType: profile.viewType,
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

// Resolves the profile that currently owns the shared overview note: the one
// named by the `activeProfileId` setting, or the first profile if that's
// unset/stale. All task-list operations (populating the overview note,
// calendar/ical export, notifications) act on this single profile.
async function getActiveProfile(profileContext) {
    const profiles = await getAllProfiles(profileContext)
    return profiles.find(p => p.id === profileContext.activeProfileId) || profiles[0] || null
}

// Persists which profile is active. Both the sidebar widget's profile
// dropdown and the settings page write this; the settings page does it
// through its own schema-driven form, so this is the widget's path.
async function setActiveProfile({ schemaNoteId, configNoteId }, profileId) {
    const values = await loadSettings(schemaNoteId, configNoteId)
    values.activeProfileId = profileId
    await saveSettings(schemaNoteId, configNoteId, values)
}

// The overview widget binds only to the single shared overview note (the
// `overviewNoteId` top-level setting). When the user is browsing that note,
// this returns the currently active profile (`activeProfileId`), falling back
// to the first profile if none is set; on any other note it returns nothing
// so the widget doesn't appear.
async function getMatchingProfile(profileContext, browsedNoteId) {
    const { schemaNoteId, configNoteId, profileIds, overviewNoteId, activeProfileId } = profileContext
    if (!overviewNoteId || browsedNoteId != overviewNoteId) return
    const profiles = await getAllProfiles({ schemaNoteId, configNoteId, profileIds })
    return profiles.find(p => p.id === activeProfileId) || profiles[0]
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
// them; otherwise they stay `null` and fall into a generic "Ungrouped" column.
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
        } else if (groupingInfo["type"] == "recurrence") {
            // Bucket by the RRULE frequency token (from `#recurrence`, whose
            // label name the grouping carries in `label`), not the raw rule.
            const rrule = (await api.getNote(note)).getLabelValue(groupingInfo["label"])
            const freq = task.frequencyOf(rrule)
            groupDict[note] = groupingInfo.children?.[freq] ? freq : unmatchedKey
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

// Per-profile collapse state for the overview widget's dropdown sections
// (Sort/Prefix/Color), kept in its own `sectionState` map keyed by profile id
// so it stays durable — the profile round-trips through reshape/unshapeProfile,
// which would drop a field stored on the profile itself. Shape:
// values.sectionState[profileId] = { sorts: bool, prefixes: bool, colors: bool }
async function getSectionState({ schemaNoteId, configNoteId }, profileId) {
    const values = await loadSettings(schemaNoteId, configNoteId)
    return (values.sectionState || {})[profileId] || null
}

async function saveSectionState({ schemaNoteId, configNoteId }, profileId, state) {
    const values = await loadSettings(schemaNoteId, configNoteId)
    values.sectionState = { ...(values.sectionState || {}), [profileId]: state }
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
// view can render them as columns. Names come from the injected `constants`
// (they're user-configurable label names), each paired with its Trilium
// promoted-attribute-definition string and a display alias. Undefined constants
// (an unconfigured label) are skipped.
function promotedAttributesForConstants(constants = {}) {
    const specs = [
        [constants.START_DATE_LABEL, "promoted,single,date", "Start Date"],
        [constants.START_TIME_LABEL, "promoted,single,time", "Start Time"],
        [constants.DUE_DATE_LABEL, "promoted,single,date", "Due Date"],
        [constants.DUE_TIME_LABEL, "promoted,single,time", "Due Time"],
        [constants.DURATION_LABEL, "promoted,single,number", "Duration"],
        [constants.RECURRENCE_LABEL, "promoted,single,text", "Recurrence"]
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
        let allNotes = await getNotesForSearchGroups(data, profile.searchGroups.children)
        let filteredNotes = await getFilteredNotes(data, profile.filterGroups.children, allNotes)
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
        const promotedAttributes = promotedAttributesForConstants(constants)
        await configureOverviewNote(overviewNoteId, viewType, boardGroupBy, statusByNote, boardColumns, promotedAttributes)
        let prefixDict = await getPrefixes(data.dateRules, data.prefixes[profile.prefixes.selected], sortedNotes)
        let colorDict = await getColors(data.dateRules, data.colors[profile.colors.selected], sortedNotes)
        await loadNotes(overviewNoteId, sortedNotes, prefixDict, colorDict)
    }
    await setCalendarEvents(profileContext, constants, icalNoteId)
}

async function getTaskList(profileContext) {
    const data = await loadData(profileContext.schemaNoteId, profileContext.configNoteId)
    const profile = await getActiveProfile(profileContext)
    if (!profile) return []
    let allNotes = await getNotesForSearchGroups(data, profile.searchGroups.children)
    return await getFilteredNotes(data, profile.filterGroups.children, allNotes)
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
    let allNotes = await getNotesForSearchGroups(data, profile.searchGroups.children)
    let filteredNotes = await getFilteredNotes(data, profile.filterGroups.children, allNotes)
    return await sortNoteIds(data.sorts[profile.sorts.selected]?.rule || "", filteredNotes)
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
    updateTaskLists,
    getTaskList,
    getSortedTaskList,
    getGroups,
    getGroupColumns,
    setGroupForNote,
    getSectionState,
    saveSectionState,
    sendNotificationForDueTasks,
    rescheduleAllTasks,
    setCalendarEvents
}
