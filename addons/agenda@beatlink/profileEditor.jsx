import { useState, useEffect, FormTextBox, FormCheckbox, FormDropdownList, NoteAutocomplete, Button } from "trilium:preact"
import { startNote } from "trilium:api"
import { getAgendaSettings } from "agendaSettings.jsx"
import { SearchGroupsEditor } from "profileEditorSearchGroups.jsx"
import { FilterGroupsEditor } from "profileEditorFilterGroups.jsx"
import { SortsEditor } from "profileEditorSorts.jsx"
import { PrefixesEditor } from "profileEditorPrefixes.jsx"
import { ColorsEditor } from "profileEditorColors.jsx"
import { KeyedList, LabelValueMapEditor } from "profileEditorGroups.jsx"
import { ColorPicker } from "ColorPicker.jsx"
import { ElementSelect, firstElementId } from "elementPicker.jsx"
import { SettingsForm } from "libSettingsUI.jsx"

const { loadData, saveData, saveProfile, updateTaskLists } = require("libAgendaOverview.js")
const { parseSortCriteria } = require("libMultisort.js")
const { operatorOptions, momentOptions, bracketOptions, defaultForOperator, splitRule } = require("dayjsRule.js")

// Element Library tabs -------------------------------------------------------
// Every search, filter, date rule, sort, prefix, and color a profile can use
// lives here. Profiles only ever reference an element from here by id, so
// editing one updates every profile using it; each edit below autosaves
// immediately (unlike the Profile tab, which saves explicitly).

// Searches -----------------------------------------------------------------

function newSearch() {
    return { name: "New Search", rule: "" }
}

function SearchesTab({ searches, onChange }) {
    return (
        <KeyedList
            items={searches}
            onChange={onChange}
            newItemFactory={newSearch}
            addLabel="Add Search"
            columns={[
                { label: "Name", render: (element, update) => (
                    <FormTextBox currentValue={element.name} onChange={v => update({ ...element, name: v })} />
                ) },
                { label: "Search Rule", render: (element, update) => (
                    <FormTextBox currentValue={element.rule} onChange={v => update({ ...element, rule: v })} />
                ) }
            ]}
        />
    )
}

// Date Rules -------------------------------------------------------------------
// The actual `["isBefore","startOfToday"]`-style dayjs criteria tuple a
// dayjs-type filter or a prefix/color interval tests against — pulled out
// as its own shared element so "overdue" (or any other named comparison)
// only ever gets defined once, then referenced by every filter/prefix/color
// that means the same thing, rather than each retyping the same tuple.

function newDateRule() {
    return { name: "New Date Rule", rule: ["isNull"], dateLabel: "", useNumberOfDays: false }
}

// One column per field of the `[operator, ...args]` tuple rather than a
// single cell holding a compound picker — a row's irrelevant columns (e.g.
// Moment 2/Bracket when the operator isn't isBetween) just render blank.
function DateRulesTab({ dateRules, onChange }) {
    return (
        <KeyedList
            items={dateRules}
            onChange={onChange}
            newItemFactory={newDateRule}
            addLabel="Add Date Rule"
            columns={[
                { label: "Name", render: (element, update) => (
                    <FormTextBox currentValue={element.name} onChange={v => update({ ...element, name: v })} />
                ) },
                { label: "Date Label", render: (element, update) => (
                    <FormTextBox
                        currentValue={element.dateLabel || ""}
                        onChange={v => update({ ...element, dateLabel: v })}
                    />
                ) },
                { label: "Use Number of Days", render: (element, update) => (
                    <FormCheckbox
                        currentValue={!!element.useNumberOfDays}
                        onChange={v => update({ ...element, useNumberOfDays: v })}
                    />
                ) },
                { label: "Operator", render: (element, update) => {
                    const { operator } = splitRule(element.rule)
                    return (
                        <FormDropdownList
                            values={operatorOptions}
                            currentValue={operator}
                            onChange={newOp => update({ ...element, rule: defaultForOperator(newOp) })}
                            keyProperty="key" titleProperty="title"
                        />
                    )
                } },
                { label: "Moment 1", render: (element, update) => {
                    const { operator, args } = splitRule(element.rule)
                    if (operator === "isNull") return null
                    return (
                        <FormDropdownList
                            values={momentOptions}
                            currentValue={args[0]}
                            onChange={m => update({ ...element, rule: operator === "isBetween" ? [operator, m, args[1], null, args[3]] : [operator, m] })}
                            keyProperty="key" titleProperty="title"
                        />
                    )
                } },
                { label: "Moment 2", render: (element, update) => {
                    const { operator, args } = splitRule(element.rule)
                    if (operator !== "isBetween") return null
                    return (
                        <FormDropdownList
                            values={momentOptions}
                            currentValue={args[1]}
                            onChange={m => update({ ...element, rule: [operator, args[0], m, null, args[3]] })}
                            keyProperty="key" titleProperty="title"
                        />
                    )
                } },
                { label: "Bracket", render: (element, update) => {
                    const { operator, args } = splitRule(element.rule)
                    if (operator !== "isBetween") return null
                    return (
                        <FormDropdownList
                            values={bracketOptions}
                            currentValue={args[3]}
                            onChange={b => update({ ...element, rule: [operator, args[0], args[1], null, b] })}
                            keyProperty="key" titleProperty="title"
                        />
                    )
                } }
            ]}
        />
    )
}

// Filters --------------------------------------------------------------------
// Unlike a search element (always a plain query string), a filter element
// carries its own type — a shared filter has to be self-describing since
// it's no longer scoped inside a profile-local group that used to hold that
// context. A dayjs-type filter references a Date Rule element rather than
// embedding its own criteria tuple; the label to test and whether to use
// whole-day granularity live on that Date Rule, not on the filter, since
// they describe the comparison itself rather than any one use of it.

const filterTypeOptions = [
    { key: "search", title: "Search Query" },
    { key: "dayjs", title: "Date Comparison" }
]

function newFilter() {
    return { name: "New Filter", type: "search", rule: "" }
}

// One column per field rather than a single "Details" cell that swaps its
// whole contents by type — a row's columns for the other type just render
// blank (Search Rule for a dayjs-type row, or Date Rule for a search-type
// row).
function FiltersTab({ filters, dateRules, onChange }) {
    function setType(element, update, newType) {
        if (newType === element.type) return
        update({
            ...element,
            type: newType,
            ...(newType === "dayjs"
                ? { dateRuleId: firstElementId({ dateRules }, "dateRules") }
                : { rule: "" })
        })
    }

    return (
        <KeyedList
            items={filters}
            onChange={onChange}
            newItemFactory={newFilter}
            addLabel="Add Filter"
            columns={[
                { label: "Name", render: (element, update) => (
                    <FormTextBox currentValue={element.name} onChange={v => update({ ...element, name: v })} />
                ) },
                { label: "Type", render: (element, update) => (
                    <FormDropdownList
                        values={filterTypeOptions}
                        currentValue={element.type}
                        onChange={newType => setType(element, update, newType)}
                        keyProperty="key" titleProperty="title"
                    />
                ) },
                { label: "Search Rule", render: (element, update) => element.type === "search" ? (
                    <FormTextBox currentValue={element.rule} onChange={v => update({ ...element, rule: v })} />
                ) : null },
                { label: "Date Rule", render: (element, update) => element.type === "dayjs" ? (
                    <ElementSelect
                        category="dateRules"
                        registry={{ dateRules }}
                        value={element.dateRuleId}
                        onChange={dateRuleId => update({ ...element, dateRuleId })}
                    />
                ) : null }
            ]}
        />
    )
}

// Sorts ----------------------------------------------------------------------

function criteriaToString(rows) {
    return rows
        .filter(r => r.attribute)
        .map(r => [r.attribute, r.desc ? "desc" : null, r.caseInsensitive ? "caseInsensitive" : null]
            .filter(Boolean).join(":"))
        .join(";")
}

function newSort() {
    return { name: "New Sort", rule: "" }
}

function newCriterion() {
    return { attribute: "", desc: false, caseInsensitive: false }
}

function rowsToItems(rows) {
    return Object.fromEntries(rows.map((row, i) => [`c-${i}`, row]))
}

function CriteriaEditor({ rule, onChange }) {
    const items = rowsToItems(parseSortCriteria(rule || ""))

    function handleChange(newItems) {
        onChange(criteriaToString(Object.values(newItems)))
    }

    return (
        <KeyedList
            items={items}
            onChange={handleChange}
            newItemFactory={newCriterion}
            addLabel="Add Criterion"
            columns={[
                { label: "Attribute", render: (row, update) => (
                    <FormTextBox currentValue={row.attribute} onChange={v => update({ ...row, attribute: v })} />
                ) },
                { label: "Descending", render: (row, update) => (
                    <FormCheckbox currentValue={row.desc} onChange={v => update({ ...row, desc: v })} />
                ) },
                { label: "Case Insensitive", render: (row, update) => (
                    <FormCheckbox currentValue={row.caseInsensitive} onChange={v => update({ ...row, caseInsensitive: v })} />
                ) }
            ]}
        />
    )
}

function SortsTab({ sorts, onChange }) {
    return (
        <KeyedList
            items={sorts}
            onChange={onChange}
            newItemFactory={newSort}
            addLabel="Add Sort"
            columns={[
                { label: "Name", render: (sort, update) => (
                    <FormTextBox currentValue={sort.name} onChange={v => update({ ...sort, name: v })} />
                ) },
                { label: "Criteria", render: (sort, update) => (
                    <CriteriaEditor rule={sort.rule} onChange={rule => update({ ...sort, rule })} />
                ) }
            ]}
        />
    )
}

// Prefixes / Colors ------------------------------------------------------------
// Structurally identical (a label-value map or a dayjs-interval list); only
// the value editor (plain text vs. ColorPicker) and default value differ.
// Each dayjs interval references a Date Rule element rather than embedding
// its own criteria tuple, same as a dayjs-type filter — the label to test
// and whether to use whole-day granularity live on that Date Rule, not on
// the variant, since different intervals in the same variant can reference
// Date Rules with different labels.

const variantTypeOptions = [
    { key: "label", title: "By Label Value" },
    { key: "dayjs", title: "By Date" }
]

function newVariant(namePrefix) {
    return { name: `New ${namePrefix}`, type: "label", label: "", children: {} }
}

function PrefixTextEditor({ value, onChange }) {
    return <FormTextBox currentValue={value || ""} onChange={onChange} />
}

function ColorValueEditor({ value, onChange }) {
    return <ColorPicker currentValue={value} onChange={onChange} />
}

// One column per scalar field rather than a single "Details" cell that swaps
// its whole contents by type. The one field that can't flatten into a fixed
// column — the label-value map (label type) or interval list (dayjs type),
// each of variable length — stays as its own nested-list column.
function variantColumns({ dateRules, valueField, defaultValue, ValueEditor, IntervalValueEditor }) {
    function setType(variant, update, newType) {
        if (newType === variant.type) return
        update({
            ...variant,
            type: newType,
            ...(newType === "label"
                ? { label: "", children: {} }
                : { intervals: {} })
        })
    }

    function newInterval() {
        return { dateRuleId: firstElementId({ dateRules }, "dateRules"), [valueField]: defaultValue }
    }

    return [
        { label: "Name", render: (variant, update) => (
            <FormTextBox currentValue={variant.name} onChange={v => update({ ...variant, name: v })} />
        ) },
        { label: "Type", render: (variant, update) => (
            <FormDropdownList
                values={variantTypeOptions}
                currentValue={variant.type}
                onChange={newType => setType(variant, update, newType)}
                keyProperty="key" titleProperty="title"
            />
        ) },
        { label: "Label", render: (variant, update) => variant.type === "label" ? (
            <FormTextBox
                currentValue={variant.label || ""}
                onChange={v => update({ ...variant, label: v })}
            />
        ) : null },
        { label: "Values", render: (variant, update) => variant.type === "label" ? (
            <LabelValueMapEditor
                entries={variant.children || {}}
                onChange={children => update({ ...variant, children })}
                defaultValue={defaultValue}
                renderValue={(value, onChangeValue) => <ValueEditor value={value} onChange={onChangeValue} />}
            />
        ) : (
            <KeyedList
                items={variant.intervals || {}}
                onChange={intervals => update({ ...variant, intervals })}
                newItemFactory={newInterval}
                addLabel="Add Interval"
                columns={[
                    { label: "Date Rule", render: (interval, updateInterval) => (
                        <ElementSelect
                            category="dateRules"
                            registry={{ dateRules }}
                            value={interval.dateRuleId}
                            onChange={dateRuleId => updateInterval({ ...interval, dateRuleId })}
                        />
                    ) },
                    { label: "Value", render: (interval, updateInterval) => (
                        <IntervalValueEditor
                            value={interval[valueField]}
                            onChange={v => updateInterval({ ...interval, [valueField]: v })}
                        />
                    ) }
                ]}
            />
        ) }
    ]
}

function PrefixesTab({ prefixes, dateRules, onChange }) {
    return (
        <KeyedList
            items={prefixes}
            onChange={onChange}
            newItemFactory={() => newVariant("Prefix")}
            addLabel="Add Prefix"
            columns={variantColumns({
                dateRules,
                valueField: "formatString",
                defaultValue: "",
                ValueEditor: PrefixTextEditor,
                IntervalValueEditor: PrefixTextEditor
            })}
        />
    )
}

function ColorsTab({ colors, dateRules, onChange }) {
    return (
        <KeyedList
            items={colors}
            onChange={onChange}
            newItemFactory={() => newVariant("Color")}
            addLabel="Add Color"
            columns={variantColumns({
                dateRules,
                valueField: "color",
                defaultValue: "gray",
                ValueEditor: ColorValueEditor,
                IntervalValueEditor: ColorValueEditor
            })}
        />
    )
}

// Profile tab ------------------------------------------------------------------

function ProfileTab({ profile, registry, onChange, onOpenTab, saveStatus, onSave }) {
    const saveLabel = saveStatus === "saving" ? "Saving…"
        : saveStatus === "saved" ? "Saved!"
        : saveStatus === "failed" ? "Save failed"
        : "Save"

    return (
        <div>
            <div className="pe-field-row">
                <label>Name</label>
                <FormTextBox currentValue={profile.name} onChange={v => onChange({ name: v })} />
            </div>
            <div className="pe-field-row">
                <label>File Tasks Under</label>
                <NoteAutocomplete noteId={profile.parentNoteId} noteIdChanged={v => onChange({ parentNoteId: v })} />
            </div>

            <SearchGroupsEditor
                searchGroups={profile.searchGroups}
                registry={registry}
                onChange={searchGroups => onChange({ searchGroups })}
                onOpenLibrary={() => onOpenTab("searches")}
            />
            <FilterGroupsEditor
                filterGroups={profile.filterGroups}
                registry={registry}
                onChange={filterGroups => onChange({ filterGroups })}
                onOpenLibrary={() => onOpenTab("filters")}
            />
            <SortsEditor
                sorts={profile.sorts}
                registry={registry}
                onChange={sorts => onChange({ sorts })}
                onOpenLibrary={() => onOpenTab("sorts")}
            />
            <PrefixesEditor
                prefixes={profile.prefixes}
                registry={registry}
                onChange={prefixes => onChange({ prefixes })}
                onOpenLibrary={() => onOpenTab("prefixes")}
            />
            <ColorsEditor
                colors={profile.colors}
                registry={registry}
                onChange={colors => onChange({ colors })}
                onOpenLibrary={() => onOpenTab("colors")}
            />

            <div className="pe-actions">
                <Button
                    icon={saveStatus === "saved" ? "bx-check" : "bx-save"}
                    text={saveLabel}
                    onClick={onSave}
                />
            </div>
        </div>
    )
}

// Page -------------------------------------------------------------------------
// Settings (the schema.json/config.json label-name vocabulary) comes first,
// Profile is the day-to-day editing surface, and the library's own six kinds
// of element (Searches/Date Rules/Filters/Sorts/Prefixes/Colors) sit alongside
// both as flat tabs — each is its own page, shown one at a time, rather than
// nested under a further "Element Library" tab. The *items within* a category
// (each individual search, filter, etc.) still render as a plain KeyedList,
// not a further layer of tabs. Settings itself is just `SettingsForm` dropped
// in as-is (self-contained: loads/saves schema.json+config.json, owns its own
// Save button) — the only tab of the seven that isn't defined in this file.
const CATEGORIES = [
    { key: "settings", label: "Settings" },
    { key: "profile", label: "Profile" },
    { key: "searches", label: "Searches" },
    { key: "filters", label: "Filters" },
    { key: "sorts", label: "Sorts" },
    { key: "prefixes", label: "Prefixes" },
    { key: "colors", label: "Colors" },
    { key: "dateRules", label: "Date Rules" }
]

export default function ProfileEditor() {
    const [ids, setIds] = useState(null)
    const [data, setData] = useState(null)
    const [profile, setProfile] = useState(null)
    const [saveStatus, setSaveStatus] = useState(null)
    const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].key)

    useEffect(() => {
        (async () => {
            const { constants, profileContext, schemaNoteId, configNoteId } = await getAgendaSettings()
            const icalNoteId = await startNote.getRelationValue("icalNote")
            const profileId = profileContext.profileIds[0]
            const loaded = await loadData(profileContext.dataNoteId, profileContext.builtinElementsNoteId)
            setIds({ constants, profileContext, profileId, icalNoteId, schemaNoteId, configNoteId })
            setData(loaded)
            setProfile({
                id: profileId,
                dataNoteId: profileContext.dataNoteId,
                builtinElementsNoteId: profileContext.builtinElementsNoteId,
                ...loaded.profiles[profileId]
            })
        })()
    }, [])

    function updateProfile(patch) {
        setProfile({ ...profile, ...patch })
    }

    function updateElements(category, value) {
        const newData = { ...data, [category]: value }
        setData(newData)
        saveData(ids.profileContext.dataNoteId, ids.profileContext.builtinElementsNoteId, newData)
    }

    async function handleSave() {
        setSaveStatus("saving")
        try {
            await saveProfile(profile)
            await updateTaskLists(ids.profileContext, ids.constants, ids.icalNoteId)
            setData(await loadData(ids.profileContext.dataNoteId, ids.profileContext.builtinElementsNoteId))
            setSaveStatus("saved")
        } catch (err) {
            setSaveStatus("failed")
            console.error(err)
        } finally {
            setTimeout(() => setSaveStatus(null), 1500)
        }
    }

    if (!data || !profile || !ids) return <div>Loading...</div>

    return (
        <div className="profile-editor">
            <h2>Agenda Editor</h2>
            <p>
                Override the label-name vocabulary this addon reads/writes on the Settings tab.
                Build the active profile's search/filter groups and pick its sort/prefix/color on
                the Profile tab. Every search, filter, date rule, sort, prefix, and color a profile
                can use is defined on the other tabs — edit one there to change it everywhere it's
                referenced. A profile only ever picks from that list; if nothing fits, add a new
                element instead of editing the profile directly.
            </p>

            <div className="pe-tabbed">
                <div className="pe-tabbed-tabs">
                    {CATEGORIES.map(cat => (
                        <button
                            type="button"
                            key={cat.key}
                            className={`pe-tab${cat.key === activeCategory ? " pe-tab-active" : ""}`}
                            onClick={() => setActiveCategory(cat.key)}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>
                <div className="pe-tabbed-panel-body">
                    {activeCategory === "settings" && (
                        <SettingsForm schemaNoteId={ids.schemaNoteId} configNoteId={ids.configNoteId} />
                    )}
                    {activeCategory === "profile" && (
                        <ProfileTab
                            profile={profile}
                            registry={data}
                            onChange={updateProfile}
                            onOpenTab={setActiveCategory}
                            saveStatus={saveStatus}
                            onSave={handleSave}
                        />
                    )}
                    {activeCategory === "searches" && (
                        <SearchesTab searches={data.searches} onChange={v => updateElements("searches", v)} />
                    )}
                    {activeCategory === "dateRules" && (
                        <DateRulesTab dateRules={data.dateRules} onChange={v => updateElements("dateRules", v)} />
                    )}
                    {activeCategory === "filters" && (
                        <FiltersTab
                            filters={data.filters}
                            dateRules={data.dateRules}
                            onChange={v => updateElements("filters", v)}
                        />
                    )}
                    {activeCategory === "sorts" && (
                        <SortsTab sorts={data.sorts} onChange={v => updateElements("sorts", v)} />
                    )}
                    {activeCategory === "prefixes" && (
                        <PrefixesTab
                            prefixes={data.prefixes}
                            dateRules={data.dateRules}
                            onChange={v => updateElements("prefixes", v)}
                        />
                    )}
                    {activeCategory === "colors" && (
                        <ColorsTab
                            colors={data.colors}
                            dateRules={data.dateRules}
                            onChange={v => updateElements("colors", v)}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
