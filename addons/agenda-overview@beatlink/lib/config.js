const { loadSettings, saveSettings } = require("libSettingsUI.jsx")

// The sibling pickers a prefix/colour/grouping/filter group can take its
// vocabulary from instead of a hand-written list, keyed by the `type` its
// entries store. Each one is read out of that addon's own settings note at
// display time, found by its anchor label, and nothing is written back: the
// picker owns the vocabulary, this addon only renders by it.
//
// `read` turns that addon's settings into { kind, name, values } - `kind` being
// "label" or "relation" and `name` the attribute it tags with, which each picker
// decides for itself - or null when there is nothing to render by. Each mirrors
// the format its picker writes rather than shipping that addon's registry
// module, so a `read` is the one place that has to keep up if a picker changes
// shape.
const PICKER_SOURCES = {
    area: {
        title: "Area",
        anchorLabel: "areaConfig",
        // area-picker tags a note with the area's key behind its 1-based
        // registry position, zero-padded ("01-career"); see its
        // areaRegistry.jsx, which owns that format. `index` counts entries that
        // survive the filter, exactly as it does there, or the prefixes here
        // would disagree with what the picker writes.
        defaultAttribute: { kind: "label", name: "area" },
        read(settings) {
            return {
                kind: "label",
                name: "area",
                values: Object.values(settings.areas || {})
                    .filter(area => area && area.key)
                    .map((area, index) => ({
                        labelValue: `${String(index + 1).padStart(2, "0")}-${area.key}`,
                        title: area.title || area.key,
                        color: area.color || ""
                    }))
            }
        }
    },
    priority: {
        title: "Priority",
        anchorLabel: "priorityConfig",
        defaultAttribute: { kind: "label", name: "priority" },
        // priority-widget keeps several named profiles and tags by the active
        // one, whose `label` it lets you rename - so the note label comes out of
        // the profile rather than being fixed. A `selected` pointing at a
        // deleted profile falls back to the first, the same guard its own
        // priorityRegistry.jsx applies. Levels are stored by their bare key
        // ("4-critical"), the rank being part of the key rather than a prefix.
        read(settings) {
            const profiles = settings.profiles || {}
            const profile = profiles[settings.selected] || Object.values(profiles)[0]
            if (!profile) return null
            return {
                kind: "label",
                name: profile.label || "priority",
                values: Object.values(profile.priorities || {})
                    .filter(level => level && level.key)
                    .map(level => ({
                        labelValue: level.key,
                        title: level.title || level.key,
                        color: level.color || ""
                    }))
            }
        }
    },
    template: {
        title: "Template",
        anchorLabel: "templatePickerConfig",
        defaultAttribute: { kind: "relation", name: "template" },
        // template-picker assigns a note's ~template RELATION rather than a
        // label, so its values are keyed by the template note's id - stable
        // across renames, and a valid search property (Trilium's search maps
        // `noteid`). A row whose note was deleted simply never matches; the
        // picker's own reader drops those with a backend lookup, which this
        // skips rather than pay a round-trip per load.
        // A note filed under another note of the SAME template is a part of it -
        // a task under a task is a subtask - so a search for that template skips
        // it, or the overview lists the tree rather than the work. Direct parents
        // only, matching the curated searches this replaces. Nothing equivalent
        // applies to area or priority: those group notes, they do not nest them.
        nestingExclusion(vocabulary, value) {
            return `not(note.parents.relations.${vocabulary.name}.noteId = '${value.labelValue}')`
        },
        read(settings) {
            return {
                kind: "relation",
                name: "template",
                values: Object.values(settings.templates || {})
                    .filter(entry => entry && entry.templateNoteId)
                    .map(entry => ({
                        labelValue: entry.templateNoteId,
                        title: entry.name || "",
                        color: entry.color || ""
                    }))
            }
        }
    }
}

// The attribute half of a resolved variant: what downstream reads a note by.
function attributeOf(vocabulary) {
    return vocabulary.kind === "relation"
        ? { type: "relation", relation: vocabulary.name }
        : { type: "label", label: vocabulary.name }
}

// The attribute token a sort criterion uses for a picker: libmultisort reads a
// `~name` attribute off the relation and anything else off a label.
function sortAttributeOf(vocabulary) {
    return vocabulary.kind === "relation" ? `~${vocabulary.name}` : vocabulary.name
}

// { attribute: { value: ordinal } } for every resolved picker, so a sort follows
// the order configured in the picker rather than the stored value's own. Without
// this a #area sorts alphabetically and a ~template sorts by raw noteId, neither
// of which means anything to a reader.
function sortValueMapsFor(vocabularies) {
    const maps = {}
    for (const vocabulary of Object.values(vocabularies)) {
        const ordinals = {}
        vocabulary.values.forEach((value, index) => { ordinals[value.labelValue] = index })
        maps[sortAttributeOf(vocabulary)] = ordinals
    }
    return maps
}

// The search rule matching one of a picker's values, and the rule matching a
// note carrying none of them. `~!template` is an existence negation and
// `noteId` a searchable property - both per Trilium's own search parser.
function ruleFor(vocabulary, value) {
    return vocabulary.kind === "relation"
        ? `~${vocabulary.name}.noteId = '${value.labelValue}'`
        : `#${vocabulary.name}='${value.labelValue}'`
}

function noValueRuleFor(vocabulary) {
    return vocabulary.kind === "relation"
        ? `~!${vocabulary.name}`
        : `#!${vocabulary.name} OR #${vocabulary.name}=''`
}

// One picker's vocabulary, or null when that addon isn't installed (or holds
// nothing to render by), so an entry pointing at it degrades rather than errors.
async function getPickerVocabulary(sourceId) {
    const source = PICKER_SOURCES[sourceId]
    if (!source) return null

    const anchors = await api.searchForNotes(`#${source.anchorLabel}`)
    if (!anchors.length) return null
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null

    const vocabulary = source.read(await loadSettings(schemaNoteId, configNoteId))
    return vocabulary && vocabulary.values.length ? vocabulary : null
}

// The vocabulary of each named picker that resolves, read once per load. A
// picker that isn't installed is simply absent from the result, which is what
// makes every derived entry behind it disappear with it.
async function getPickerVocabularies(sourceIds) {
    const vocabularies = {}
    for (const sourceId of sourceIds) {
        const vocabulary = await getPickerVocabulary(sourceId)
        if (vocabulary) vocabularies[sourceId] = vocabulary
    }
    return vocabularies
}

// A picker-sourced variant's children, keyed by the value the picker actually
// tags with. Only that form: the key is also a board column's identity, and
// dropping a note on a column writes the key back, so aliasing a second spelling
// would double every column and make half of them write a stale value.
//
// Values the picker has disabled are kept. `enabled` decides whether the picker
// offers a value, not whether notes already carry it, and dropping them here
// would quietly strip the colour or prefix off every note tagged before it was
// retired.
function pickerChildren(vocabulary, valueOf) {
    const children = {}
    for (const value of vocabulary.values) children[value.labelValue] = valueOf(value)
    return children
}

// A picker-sourced filter group's children: one search rule per value plus the
// no-value catch-all, keyed the same way the variants are.
//
// The children are derived but each `enabled` flag is user state, so the stored
// flags are merged over the top - that hybrid is the whole reason this group
// keeps a stored entry at all. A value added in the picker later arrives
// enabled, so it never silently hides the notes tagged with it.
function pickerFilterChildren(vocabulary, title, stored) {
    const children = {}
    for (const value of vocabulary.values) {
        children[value.labelValue] = {
            name: value.title,
            type: "search",
            rule: ruleFor(vocabulary, value),
            enabled: stored[value.labelValue] ? !!stored[value.labelValue].enabled : true
        }
    }
    children.none = {
        name: `No ${title}`,
        type: "search",
        rule: noValueRuleFor(vocabulary),
        enabled: stored.none ? !!stored.none.enabled : true
    }
    return children
}

// Every display element, filter, search and sort the installed pickers stand up
// on their own, keyed `picker-<source>` so they can never collide with an entry
// of your own. Nothing about a picker's vocabulary is shipped in defaults.json:
// install the addon and its entries appear, uninstall it and they leave.
//
// These are read-path only. loadData is the only place they are injected, and
// the save helpers all go through loadSettings instead, so a derived entry can
// never be written back as if it were yours - except a group's `enabled` flags,
// which are yours and are stored under the same id (see mergeProfileGroups).
const DERIVED_PREFIX = "picker-"

function derivedId(sourceId, profileId) {
    return profileId ? `${DERIVED_PREFIX}${sourceId}-${profileId}` : `${DERIVED_PREFIX}${sourceId}`
}

// The variant shells. Each is just a name plus the source `type`, which is what
// reshapeVariant/reshapeGrouping already know how to resolve.
function derivedVariants(vocabularies, kind) {
    const entries = {}
    for (const sourceId of Object.keys(vocabularies)) {
        const { title } = PICKER_SOURCES[sourceId]
        if (kind === "prefixes") {
            entries[derivedId(sourceId)] = { name: title, type: sourceId, noValuePrefix: "" }
        } else if (kind === "colors") {
            entries[derivedId(sourceId)] = { name: title, type: sourceId, noValueColor: "" }
        } else {
            entries[derivedId(sourceId)] = {
                name: `By ${title}`, type: sourceId,
                noValueDisplay: `No ${title}`, noValueColor: ""
            }
        }
    }
    return entries
}

// One sort per picker, ordered by that picker's own list and then by start date -
// the shape every sort that shipped here used to have.
function derivedSorts(vocabularies, startLabel) {
    const entries = {}
    for (const sourceId of Object.keys(vocabularies)) {
        const criteria = [{ source: sourceId, attribute: "", desc: false, caseInsensitive: false }]
        if (startLabel) {
            criteria.push({ source: "none", attribute: startLabel, desc: false, caseInsensitive: false })
        }
        entries[derivedId(sourceId)] = {
            name: `${PICKER_SOURCES[sourceId].title}${startLabel ? " → Start Date" : ""}`,
            criteria
        }
    }
    return entries
}

// One search and one filter group per picker per profile, since each profile
// keeps its own on/off state for them. The stored entry under the same id is
// carried through: it holds those flags and nothing else worth keeping.
function derivedGroups(vocabularies, profileIds, stored) {
    const entries = {}
    for (const sourceId of Object.keys(vocabularies)) {
        for (const profileId of profileIds) {
            const id = derivedId(sourceId, profileId)
            entries[id] = {
                name: PICKER_SOURCES[sourceId].title,
                profileId,
                type: sourceId,
                children: (stored[id] && stored[id].children) || {}
            }
        }
    }
    return entries
}

// A picker-sourced search group's children: one rule per value, every one on
// until you turn it off. A search decides what reaches the overview at all, so
// unlike a filter group there is no no-value catch-all - "notes carrying none of
// these" is not something you would search *for*.
function pickerSearchChildren(source, vocabulary, stored) {
    const children = {}
    for (const value of vocabulary.values) {
        const clauses = [ruleFor(vocabulary, value)]
        if (source.nestingExclusion) clauses.push(source.nestingExclusion(vocabulary, value))
        children[value.labelValue] = {
            name: value.title,
            rule: clauses.join(" AND "),
            enabled: stored[value.labelValue] ? !!stored[value.labelValue].enabled : true
        }
    }
    return children
}

// Resolves one search group for reading, on the same terms as a filter group.
function resolveSearchGroup(group, vocabularies) {
    const source = group && PICKER_SOURCES[group.type]
    if (!source) return group

    const vocabulary = vocabularies[group.type]
    if (!vocabulary) return null
    return { ...group, children: pickerSearchChildren(source, vocabulary, group.children || {}) }
}

// Resolves one filter group for reading. A picker-sourced group with no
// vocabulary behind it is dropped rather than emitted empty: getFilteredNotes
// ANDs the groups and a group that permits nothing filters out every note, so an
// uninstalled picker would blank the overview instead of being ignored.
function resolveFilterGroup(group, vocabularies) {
    const source = group && PICKER_SOURCES[group.type]
    if (!source) return group

    const vocabulary = vocabularies[group.type]
    if (!vocabulary) return null
    return { ...group, children: pickerFilterChildren(vocabulary, source.title, group.children || {}) }
}

// A picker-sourced variant resolves to an ordinary label variant, so everything
// downstream stays unaware of where the vocabulary came from. `pickerValueOf`
// picks the field this registry displays - the value's title for prefixes, its
// colour for colors.
function reshapeVariant(variant, vocabularies = {}, pickerValueOf = value => value.title) {
    if (!variant) return variant
    const noValue = variant.noValuePrefix ?? variant.noValueColor ?? ""
    const source = PICKER_SOURCES[variant.type]
    if (source) {
        const vocabulary = vocabularies[variant.type]
        return {
            name: variant.name,
            ...attributeOf(vocabulary || source.defaultAttribute),
            children: vocabulary ? pickerChildren(vocabulary, pickerValueOf) : {},
            noValue
        }
    }
    if (variant.type === "label") {
        const children = Object.fromEntries(
            Object.values(variant.children || {}).map(entry => [entry.labelValue, entry.display])
        )
        return { name: variant.name, type: "label", label: variant.label, children, noValue }
    }
    return { name: variant.name, type: "dayjs", intervals: variant.intervals || {}, noValue }
}

function reshapeGrouping(grouping, vocabularies = {}) {
    if (!grouping) return grouping
    const noValue = { display: grouping.noValueDisplay || "", color: grouping.noValueColor || "" }
    const source = PICKER_SOURCES[grouping.type]
    if (source) {
        const vocabulary = vocabularies[grouping.type]
        return {
            name: grouping.name,
            ...attributeOf(vocabulary || source.defaultAttribute),
            children: vocabulary
                ? pickerChildren(vocabulary, value => ({ display: value.title, color: value.color }))
                : {},
            noValue
        }
    }
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

function reshapeSort(sort, vocabularies = {}) {
    const criteria = (sort.criteria || []).map(row => {
        if (!row.source || row.source === "none") return row
        const vocabulary = vocabularies[row.source]
        // Sourced from a picker that isn't installed: no attribute to sort by, so
        // the criterion drops out and the ones after it still apply.
        if (!vocabulary) return { ...row, attribute: "" }
        return { ...row, attribute: sortAttributeOf(vocabulary) }
    })
    return { name: sort.name, rule: criteriaToString(criteria) }
}

function groupsForProfile(allGroups, profileId) {
    return Object.fromEntries(
        Object.entries(allGroups)
            .filter(([, group]) => group.profileId === profileId)
            .map(([id, group]) => [id, { name: group.name, type: group.type, children: group.children }])
    )
}

function mergeProfileGroups(allGroups, profileId, ownGroups) {
    const merged = {}
    for (const [id, group] of Object.entries(allGroups)) {
        if (group.profileId !== profileId) merged[id] = group
    }
    for (const [id, group] of Object.entries(ownGroups)) {
        // A picker-sourced group's children are rebuilt on every read, so only
        // the flags the user actually owns are written back - persisting the
        // derived names and rules would leave a stale copy of a vocabulary that
        // lives somewhere else.
        const children = PICKER_SOURCES[group.type]
            ? mapEntries(group.children, child => ({ enabled: !!child.enabled }))
            : group.children
        merged[id] = { name: group.name, profileId, type: group.type, children }
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

    // Every installed picker is read, not just the ones an entry of your own
    // points at, because the derived entries below are the main way they are used.
    const vocabularies = await getPickerVocabularies(Object.keys(PICKER_SOURCES))
    const profileIds = Object.keys(values.profiles || {})

    const searchGroups = {}
    for (const [id, group] of Object.entries({
        ...(values.searchGroups || {}),
        ...derivedGroups(vocabularies, profileIds, values.searchGroups || {})
    })) {
        const resolved = resolveSearchGroup(group, vocabularies)
        if (resolved) searchGroups[id] = resolved
    }

    const filterGroups = {}
    for (const [id, group] of Object.entries({
        ...(values.filterGroups || {}),
        ...derivedGroups(vocabularies, profileIds, values.filterGroups || {})
    })) {
        const resolved = resolveFilterGroup(group, vocabularies)
        if (resolved) filterGroups[id] = resolved
    }

    const sorts = { ...(values.sorts || {}), ...derivedSorts(vocabularies, values.startDatetimeLabel) }
    const prefixes = { ...(values.prefixes || {}), ...derivedVariants(vocabularies, "prefixes") }
    const colors = { ...(values.colors || {}), ...derivedVariants(vocabularies, "colors") }
    const groupings = { ...(values.groupings || {}), ...derivedVariants(vocabularies, "groupings") }

    return {
        dateRules: mapEntries(values.dateRules, reshapeDateRule),
        sorts: mapEntries(sorts, sort => reshapeSort(sort, vocabularies)),
        sortValueMaps: sortValueMapsFor(vocabularies),
        prefixes: mapEntries(prefixes, variant =>
            reshapeVariant(variant, vocabularies, value => value.title)),
        colors: mapEntries(colors, variant =>
            reshapeVariant(variant, vocabularies, value => value.color)),
        groupings: mapEntries(groupings, grouping => reshapeGrouping(grouping, vocabularies)),
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
