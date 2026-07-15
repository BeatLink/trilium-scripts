const { loadSettings, saveSettings } = require("libSettingsUI.jsx")

// --- Schema-driven settings adapter -----------------------------------------
//
// Every search/filter/sort/prefix/color/date-rule/profile this addon uses is
// declared as a `registry` field in agenda@beatlink's own schema.json (see
// libsettings@beatlink's README for the `registry`/`reference`/`showWhen`
// mechanics), edited directly via `SettingsForm` — this module never edits
// that data itself, only reads/reshapes it for the matching/sorting/prefix/
// color logic elsewhere, and writes back through the one `saveProfile` path a
// widget (rather than the schema-driven editor) needs for in-place edits.
//
// The schema stores a few things in a more decomposed shape than the actual
// matching logic wants, since the schema's job is to be editable (dropdowns,
// checkboxes) rather than to be the exact shape `matchesDayJsCriteria`/
// libmultisort expect. `loadData` reshapes on the way in, `saveProfile`
// reshapes on the way out; everything downstream of `loadData` works in
// exactly the same shapes it always has, unaware any of this migrated off a
// bespoke data note onto libsettings.

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

module.exports = {
    loadData,
    saveProfile,
    getAllProfiles,
    getActiveProfile,
    setActiveProfile,
    getMatchingProfile,
    getSectionState,
    saveSectionState
}
