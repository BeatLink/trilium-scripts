const { loadSettings, saveSettings } = require("libSettingsUI.jsx")

function reshapeVariant(variant) {
    if (!variant) return variant
    const noValue = variant.noValuePrefix ?? variant.noValueColor ?? ""
    if (variant.type === "label") {
        const children = Object.fromEntries(
            Object.values(variant.children || {}).map(entry => [entry.labelValue, entry.display])
        )
        return { name: variant.name, type: "label", label: variant.label, children, noValue }
    }
    return { name: variant.name, type: "dayjs", intervals: variant.intervals || {}, noValue }
}

function reshapeGrouping(grouping) {
    if (!grouping) return grouping
    const noValue = { display: grouping.noValueDisplay || "", color: grouping.noValueColor || "" }
    if (grouping.type === "label" || grouping.type === "recurrence") {
        const children = Object.fromEntries(
            Object.values(grouping.children || {}).map(entry =>
                [entry.labelValue, { display: entry.display, color: entry.color }])
        )
        return { name: grouping.name, type: grouping.type, label: grouping.label, children, noValue }
    }
    return { name: grouping.name, type: "dayjs", intervals: grouping.intervals || {}, noValue }
}

function buildDayjsRule(dateRule) {
    const { operator, moment1, moment2, bracket } = dateRule
    if (operator === "isNull") return ["isNull"]
    if (operator === "isBetween") return [operator, moment1, moment2, null, bracket]
    return [operator, moment1]
}

function reshapeDateRule(dateRule) {
    return {
        name: dateRule.name,
        dateLabel: dateRule.dateLabel,
        useNumberOfDays: dateRule.useNumberOfDays,
        rule: buildDayjsRule(dateRule)
    }
}

// Builds a multisort criteria string like "attr:desc:caseInsensitive;attr2".
function criteriaToString(rows) {
    return (rows || [])
        .filter(row => row.attribute)
        .map(row => [
            row.attribute,
            row.desc ? "desc" : null,
            row.caseInsensitive ? "caseInsensitive" : null
        ].filter(Boolean).join(":"))
        .join(";")
}

function reshapeSort(sort) {
    return { name: sort.name, rule: criteriaToString(sort.criteria) }
}

function groupsForProfile(allGroups, profileId) {
    return Object.fromEntries(
        Object.entries(allGroups)
            .filter(([, group]) => group.profileId === profileId)
            .map(([id, group]) => [id, { name: group.name, children: group.children }])
    )
}

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

// Maps values with an id-keyed object, preserving keys.
function mapEntries(source, mapValue) {
    return Object.fromEntries(
        Object.entries(source || {}).map(([id, value]) => [id, mapValue(value, id)])
    )
}

async function loadData(schemaNoteId, configNoteId) {
    const values = await loadSettings(schemaNoteId, configNoteId)
    const searchGroups = values.searchGroups || {}
    const filterGroups = values.filterGroups || {}

    return {
        dateRules: mapEntries(values.dateRules, reshapeDateRule),
        sorts: mapEntries(values.sorts, reshapeSort),
        prefixes: mapEntries(values.prefixes, reshapeVariant),
        colors: mapEntries(values.colors, reshapeVariant),
        groupings: mapEntries(values.groupings, reshapeGrouping),
        profiles: mapEntries(values.profiles, (profile, id) =>
            reshapeProfile(profile, searchGroups, filterGroups, id))
    }
}

async function saveProfile(profile) {
    const { id, schemaNoteId, configNoteId, ...profileFields } = profile
    const values = await loadSettings(schemaNoteId, configNoteId)

    values.profiles = { ...(values.profiles || {}), [id]: unshapeProfile(profileFields) }
    values.searchGroups = mergeProfileGroups(
        values.searchGroups || {}, id, profileFields.searchGroups?.children || {})
    values.filterGroups = mergeProfileGroups(
        values.filterGroups || {}, id, profileFields.filterGroups?.children || {})

    await saveSettings(schemaNoteId, configNoteId, values)
}

async function getAllProfiles({ schemaNoteId, configNoteId, profileIds }) {
    const data = await loadData(schemaNoteId, configNoteId)
    return profileIds
        .filter(id => data.profiles[id])
        .map(id => ({ id, schemaNoteId, configNoteId, ...data.profiles[id] }))
}

async function getActiveProfile(profileContext) {
    const profiles = await getAllProfiles(profileContext)
    return profiles.find(profile => profile.id === profileContext.activeProfileId)
        || profiles[0]
        || null
}

async function setActiveProfile({ schemaNoteId, configNoteId }, profileId) {
    const values = await loadSettings(schemaNoteId, configNoteId)
    values.activeProfileId = profileId
    await saveSettings(schemaNoteId, configNoteId, values)
}

async function getMatchingProfile(profileContext, browsedNoteId) {
    const { schemaNoteId, configNoteId, profileIds, overviewNoteId, activeProfileId } = profileContext
    if (!overviewNoteId || browsedNoteId != overviewNoteId) return
    const profiles = await getAllProfiles({ schemaNoteId, configNoteId, profileIds })
    return profiles.find(profile => profile.id === activeProfileId) || profiles[0]
}

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
