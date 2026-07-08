import { useState, useEffect, FormTextBox, FormCheckbox, FormDropdownList } from "trilium:preact"
import { startNote } from "trilium:api"
import { Collapsible } from "Collapsible.jsx"
import { KeyedList, LabelValueMapEditor } from "profileEditorGroups.jsx"
import { DayjsRulePicker } from "dayjsRulePicker.jsx"
import { ColorPicker } from "ColorPicker.jsx"

const { loadData, saveData } = require("libAgendaOverview.js")
const { parseSortCriteria } = require("libMultisort.js")

// Searches -----------------------------------------------------------------

function newSearch() {
    return { name: "New Search", rule: "" }
}

function SearchElementRow({ element, onChange }) {
    return (
        <div className="pe-group">
            <div>
                <FormTextBox currentValue={element.name} onChange={v => onChange({ ...element, name: v })} />
                <FormTextBox currentValue={element.rule} onChange={v => onChange({ ...element, rule: v })} />
            </div>
        </div>
    )
}

function SearchesTab({ searches, onChange }) {
    return (
        <KeyedList
            items={searches}
            onChange={onChange}
            newItemFactory={newSearch}
            addLabel="Add Search"
            renderItem={(key, element, update) => <SearchElementRow element={element} onChange={update} />}
        />
    )
}

// Filters --------------------------------------------------------------------
// Unlike a search element (always a plain query string), a filter element
// carries its own type/datetimeLabel/useNumberOfDays — a shared filter has
// to be self-describing since it's no longer scoped inside a profile-local
// group that used to hold that context.

const filterTypeOptions = [
    { key: "search", title: "Search Query" },
    { key: "dayjs", title: "Date Comparison" }
]

function newFilter() {
    return { name: "New Filter", type: "search", rule: "" }
}

function FilterElementRow({ element, onChange }) {
    function setType(newType) {
        if (newType === element.type) return
        onChange({
            ...element,
            type: newType,
            ...(newType === "dayjs"
                ? { datetimeLabel: element.datetimeLabel || "", useNumberOfDays: !!element.useNumberOfDays, rule: ["isNull"] }
                : { rule: "" })
        })
    }

    return (
        <div className="pe-group">
            <div>
                <FormTextBox currentValue={element.name} onChange={v => onChange({ ...element, name: v })} />
                <FormDropdownList
                    values={filterTypeOptions}
                    currentValue={element.type}
                    onChange={setType}
                    keyProperty="key" titleProperty="title"
                />
                {element.type === "dayjs" ? (
                    <>
                        <FormTextBox
                            currentValue={element.datetimeLabel || ""}
                            onChange={v => onChange({ ...element, datetimeLabel: v })}
                        />
                        <FormCheckbox
                            label="Use Number of Days"
                            currentValue={!!element.useNumberOfDays}
                            onChange={v => onChange({ ...element, useNumberOfDays: v })}
                        />
                        <DayjsRulePicker value={element.rule} onChange={rule => onChange({ ...element, rule })} />
                    </>
                ) : (
                    <FormTextBox currentValue={element.rule} onChange={v => onChange({ ...element, rule: v })} />
                )}
            </div>
        </div>
    )
}

function FiltersTab({ filters, onChange }) {
    return (
        <KeyedList
            items={filters}
            onChange={onChange}
            newItemFactory={newFilter}
            addLabel="Add Filter"
            renderItem={(key, element, update) => <FilterElementRow element={element} onChange={update} />}
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
            renderItem={(key, row, update) => (
                <div className="pe-field-row">
                    <FormTextBox currentValue={row.attribute} onChange={v => update({ ...row, attribute: v })} />
                    <FormCheckbox label="Descending" currentValue={row.desc} onChange={v => update({ ...row, desc: v })} />
                    <FormCheckbox
                        label="Case Insensitive"
                        currentValue={row.caseInsensitive}
                        onChange={v => update({ ...row, caseInsensitive: v })}
                    />
                </div>
            )}
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
            renderItem={(key, sort, update) => (
                <div className="pe-group">
                    <div>
                        <FormTextBox currentValue={sort.name} onChange={v => update({ ...sort, name: v })} />
                        <CriteriaEditor rule={sort.rule} onChange={rule => update({ ...sort, rule })} />
                    </div>
                </div>
            )}
        />
    )
}

// Prefixes / Colors ------------------------------------------------------------
// Structurally identical (a label-value map or a dayjs-interval list); only
// the value editor (plain text vs. ColorPicker) and default value differ.

const variantTypeOptions = [
    { key: "label", title: "By Label Value" },
    { key: "dayjs", title: "By Date" }
]

function newVariant(namePrefix) {
    return { name: `New ${namePrefix}`, type: "label", label: "", children: {} }
}

function VariantEditor({ variant, onChange, valueField, defaultValue, ValueEditor, IntervalValueEditor }) {
    function setType(newType) {
        if (newType === variant.type) return
        onChange({
            ...variant,
            type: newType,
            ...(newType === "label"
                ? { label: "", children: {} }
                : { dateLabel: "", useNumberOfDays: false, intervals: {} })
        })
    }

    function newInterval() {
        return { rule: ["isNull"], [valueField]: defaultValue }
    }

    return (
        <div className="pe-group">
            <div>
                <FormTextBox currentValue={variant.name} onChange={v => onChange({ ...variant, name: v })} />
                <FormDropdownList
                    values={variantTypeOptions}
                    currentValue={variant.type}
                    onChange={setType}
                    keyProperty="key" titleProperty="title"
                />
                {variant.type === "label" && (
                    <>
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
                    </>
                )}
                {variant.type === "dayjs" && (
                    <>
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
                            renderItem={(key, interval, update) => (
                                <div className="pe-field-row">
                                    <DayjsRulePicker value={interval.rule} onChange={rule => update({ ...interval, rule })} />
                                    <IntervalValueEditor
                                        value={interval[valueField]}
                                        onChange={v => update({ ...interval, [valueField]: v })}
                                    />
                                </div>
                            )}
                        />
                    </>
                )}
            </div>
        </div>
    )
}

function PrefixTextEditor({ value, onChange }) {
    return <FormTextBox currentValue={value || ""} onChange={onChange} />
}

function ColorValueEditor({ value, onChange }) {
    return <ColorPicker currentValue={value} onChange={onChange} />
}

function PrefixesTab({ prefixes, onChange }) {
    return (
        <KeyedList
            items={prefixes}
            onChange={onChange}
            newItemFactory={() => newVariant("Prefix")}
            addLabel="Add Prefix"
            renderItem={(key, variant, update) => (
                <VariantEditor
                    variant={variant}
                    onChange={update}
                    valueField="formatString"
                    defaultValue=""
                    ValueEditor={PrefixTextEditor}
                    IntervalValueEditor={PrefixTextEditor}
                />
            )}
        />
    )
}

function ColorsTab({ colors, onChange }) {
    return (
        <KeyedList
            items={colors}
            onChange={onChange}
            newItemFactory={() => newVariant("Color")}
            addLabel="Add Color"
            renderItem={(key, variant, update) => (
                <VariantEditor
                    variant={variant}
                    onChange={update}
                    valueField="color"
                    defaultValue="gray"
                    ValueEditor={ColorValueEditor}
                    IntervalValueEditor={ColorValueEditor}
                />
            )}
        />
    )
}

// Page -------------------------------------------------------------------------

function Section({ label, children }) {
    const [expanded, setExpanded] = useState(true)
    return (
        <Collapsible
            label={label}
            expanded={expanded}
            onToggle={e => setExpanded(e.currentTarget.open)}
            className="pe-section"
        >
            {children}
        </Collapsible>
    )
}

export default function ElementLibrary() {
    const [dataNoteId, setDataNoteId] = useState(null)
    const [data, setData] = useState(null)

    useEffect(() => {
        (async () => {
            const settingsNoteId = await startNote.getRelationValue("settingsNote")
            const settingsNote = await api.getNote(settingsNoteId)
            const id = settingsNote.getRelationValue("AddonData:profile")
            setDataNoteId(id)
            setData(await loadData(id))
        })()
    }, [])

    function update(category, value) {
        const newData = { ...data, [category]: value }
        setData(newData)
        saveData(dataNoteId, newData)
    }

    if (!data) return <div>Loading...</div>

    return (
        <div className="profile-editor">
            <h2>Agenda Element Library</h2>
            <p>
                Every search, filter, sort, prefix, and color a profile can use lives here —
                edit one to change it everywhere it's referenced. Profiles only ever pick from
                this list; if nothing here fits, add a new element instead of editing a profile
                directly.
            </p>

            <Section label="Searches">
                <SearchesTab searches={data.searches} onChange={v => update("searches", v)} />
            </Section>

            <Section label="Filters">
                <FiltersTab filters={data.filters} onChange={v => update("filters", v)} />
            </Section>

            <Section label="Sorts">
                <SortsTab sorts={data.sorts} onChange={v => update("sorts", v)} />
            </Section>

            <Section label="Prefixes">
                <PrefixesTab prefixes={data.prefixes} onChange={v => update("prefixes", v)} />
            </Section>

            <Section label="Colors">
                <ColorsTab colors={data.colors} onChange={v => update("colors", v)} />
            </Section>
        </div>
    )
}
