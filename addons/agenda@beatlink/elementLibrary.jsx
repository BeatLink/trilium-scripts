import { useState, useEffect, FormTextBox, FormCheckbox, FormDropdownList } from "trilium:preact"
import { startNote } from "trilium:api"
import { KeyedList, LabelValueMapEditor } from "profileEditorGroups.jsx"
import { DayjsRulePicker } from "dayjsRulePicker.jsx"
import { ColorPicker } from "ColorPicker.jsx"
import { ElementSelect, firstElementId } from "elementPicker.jsx"

const { loadData, saveData } = require("libAgendaOverview.js")
const { parseSortCriteria } = require("libMultisort.js")

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
    return { name: "New Date Rule", rule: ["isNull"] }
}

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
                { label: "Rule", render: (element, update) => (
                    <DayjsRulePicker value={element.rule} onChange={rule => update({ ...element, rule })} />
                ) }
            ]}
        />
    )
}

// Filters --------------------------------------------------------------------
// Unlike a search element (always a plain query string), a filter element
// carries its own type/datetimeLabel/useNumberOfDays — a shared filter has
// to be self-describing since it's no longer scoped inside a profile-local
// group that used to hold that context. A dayjs-type filter references a
// Date Rule element rather than embedding its own criteria tuple.

const filterTypeOptions = [
    { key: "search", title: "Search Query" },
    { key: "dayjs", title: "Date Comparison" }
]

function newFilter() {
    return { name: "New Filter", type: "search", rule: "" }
}

function FilterDetails({ element, dateRules, onChange }) {
    return element.type === "dayjs" ? (
        <div className="pe-field-row">
            <FormTextBox
                currentValue={element.datetimeLabel || ""}
                onChange={v => onChange({ ...element, datetimeLabel: v })}
            />
            <FormCheckbox
                label="Use Number of Days"
                currentValue={!!element.useNumberOfDays}
                onChange={v => onChange({ ...element, useNumberOfDays: v })}
            />
            <ElementSelect
                category="dateRules"
                registry={{ dateRules }}
                value={element.dateRuleId}
                onChange={dateRuleId => onChange({ ...element, dateRuleId })}
            />
        </div>
    ) : (
        <FormTextBox currentValue={element.rule} onChange={v => onChange({ ...element, rule: v })} />
    )
}

function FiltersTab({ filters, dateRules, onChange }) {
    function setType(element, update, newType) {
        if (newType === element.type) return
        update({
            ...element,
            type: newType,
            ...(newType === "dayjs"
                ? { datetimeLabel: element.datetimeLabel || "", useNumberOfDays: !!element.useNumberOfDays, dateRuleId: firstElementId({ dateRules }, "dateRules") }
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
                { label: "Details", render: (element, update) => (
                    <FilterDetails element={element} dateRules={dateRules} onChange={update} />
                ) }
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
// its own criteria tuple, same as a dayjs-type filter.

const variantTypeOptions = [
    { key: "label", title: "By Label Value" },
    { key: "dayjs", title: "By Date" }
]

function newVariant(namePrefix) {
    return { name: `New ${namePrefix}`, type: "label", label: "", children: {} }
}

function VariantDetails({ variant, dateRules, onChange, valueField, defaultValue, ValueEditor, IntervalValueEditor }) {
    function newInterval() {
        return { dateRuleId: firstElementId({ dateRules }, "dateRules"), [valueField]: defaultValue }
    }

    return variant.type === "label" ? (
        <div className="pe-field-row">
            <FormTextBox
                currentValue={variant.label || ""}
                onChange={v => onChange({ ...variant, label: v })}
            />
            <LabelValueMapEditor
                entries={variant.children || {}}
                onChange={children => onChange({ ...variant, children })}
                defaultValue={defaultValue}
                renderValue={(value, update) => <ValueEditor value={value} onChange={update} />}
            />
        </div>
    ) : (
        <div className="pe-field-row">
            <FormTextBox
                currentValue={variant.dateLabel || ""}
                onChange={v => onChange({ ...variant, dateLabel: v })}
            />
            <FormCheckbox
                label="Use Number of Days"
                currentValue={!!variant.useNumberOfDays}
                onChange={v => onChange({ ...variant, useNumberOfDays: v })}
            />
            <KeyedList
                items={variant.intervals || {}}
                onChange={intervals => onChange({ ...variant, intervals })}
                newItemFactory={newInterval}
                addLabel="Add Interval"
                columns={[
                    { label: "Date Rule", render: (interval, update) => (
                        <ElementSelect
                            category="dateRules"
                            registry={{ dateRules }}
                            value={interval.dateRuleId}
                            onChange={dateRuleId => update({ ...interval, dateRuleId })}
                        />
                    ) },
                    { label: "Value", render: (interval, update) => (
                        <IntervalValueEditor
                            value={interval[valueField]}
                            onChange={v => update({ ...interval, [valueField]: v })}
                        />
                    ) }
                ]}
            />
        </div>
    )
}

function PrefixTextEditor({ value, onChange }) {
    return <FormTextBox currentValue={value || ""} onChange={onChange} />
}

function ColorValueEditor({ value, onChange }) {
    return <ColorPicker currentValue={value} onChange={onChange} />
}

function variantColumns({ dateRules, valueField, defaultValue, ValueEditor, IntervalValueEditor }) {
    function setType(variant, update, newType) {
        if (newType === variant.type) return
        update({
            ...variant,
            type: newType,
            ...(newType === "label"
                ? { label: "", children: {} }
                : { dateLabel: "", useNumberOfDays: false, intervals: {} })
        })
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
        { label: "Details", render: (variant, update) => (
            <VariantDetails
                variant={variant}
                dateRules={dateRules}
                onChange={update}
                valueField={valueField}
                defaultValue={defaultValue}
                ValueEditor={ValueEditor}
                IntervalValueEditor={IntervalValueEditor}
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

// Page -------------------------------------------------------------------------
// The library's own six kinds of element (Searches/Date Rules/Filters/Sorts/
// Prefixes/Colors) are the top-level tabs — each is its own page, shown one
// at a time, rather than every category stacked and expanded together. The
// *items within* a category (each individual search, filter, etc.) still
// render as a plain KeyedList, not a further layer of tabs.
const CATEGORIES = [
    { key: "searches", label: "Searches" },
    { key: "filters", label: "Filters" },
    { key: "sorts", label: "Sorts" },
    { key: "prefixes", label: "Prefixes" },
    { key: "colors", label: "Colors" },
    { key: "dateRules", label: "Date Rules" }
]

export default function ElementLibrary() {
    const [dataNoteId, setDataNoteId] = useState(null)
    const [builtinElementsNoteId, setBuiltinElementsNoteId] = useState(null)
    const [data, setData] = useState(null)
    const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].key)

    useEffect(() => {
        (async () => {
            const settingsNoteId = await startNote.getRelationValue("settingsNote")
            const settingsNote = await api.getNote(settingsNoteId)
            const id = settingsNote.getRelationValue("AddonData:profile")
            const builtinId = settingsNote.getRelationValue("builtinElementsNote")
            setDataNoteId(id)
            setBuiltinElementsNoteId(builtinId)
            setData(await loadData(id, builtinId))
        })()
    }, [])

    function update(category, value) {
        const newData = { ...data, [category]: value }
        setData(newData)
        saveData(dataNoteId, builtinElementsNoteId, newData)
    }

    if (!data) return <div>Loading...</div>

    return (
        <div className="profile-editor">
            <h2>Agenda Element Library</h2>
            <p>
                Every search, filter, date rule, sort, prefix, and color a profile can use lives
                here — edit one to change it everywhere it's referenced. Profiles only ever pick
                from this list; if nothing here fits, add a new element instead of editing a
                profile directly.
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
                    {activeCategory === "searches" && (
                        <SearchesTab searches={data.searches} onChange={v => update("searches", v)} />
                    )}
                    {activeCategory === "dateRules" && (
                        <DateRulesTab dateRules={data.dateRules} onChange={v => update("dateRules", v)} />
                    )}
                    {activeCategory === "filters" && (
                        <FiltersTab
                            filters={data.filters}
                            dateRules={data.dateRules}
                            onChange={v => update("filters", v)}
                        />
                    )}
                    {activeCategory === "sorts" && (
                        <SortsTab sorts={data.sorts} onChange={v => update("sorts", v)} />
                    )}
                    {activeCategory === "prefixes" && (
                        <PrefixesTab
                            prefixes={data.prefixes}
                            dateRules={data.dateRules}
                            onChange={v => update("prefixes", v)}
                        />
                    )}
                    {activeCategory === "colors" && (
                        <ColorsTab
                            colors={data.colors}
                            dateRules={data.dateRules}
                            onChange={v => update("colors", v)}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
