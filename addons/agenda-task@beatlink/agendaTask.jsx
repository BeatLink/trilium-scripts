import {
    RightPanelWidget,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
    useTriliumEvent,
    useEffect,
    useState,
    FormDropdownList,
    FormTextBox,
    Button,
    useId
} from "trilium:preact";
import { getNotes } from "trilium:api"

import { RecurrencePicker } from "recurrencePicker.jsx"
import { useSelectedNoteIds } from "treeSelection.jsx"

const {
    complete,
    rescheduleByOption,
    setTaskLabel,
    updateDependentAttributes,
    clearMyDayFlagIfNotToday,
    humanizeRecurrence
} = require("libAgendaTask.js")
const { getAgendaTaskSettings } = require("agendaTaskSettings.js")

// Stands in for a field whose targets disagree, the way the Area and Template
// pickers' own "— Mixed —" entry does.
const MIXED = "mixed"
const MIXED_TEXT = "— Mixed —"

// Each edited field, against the settings constant naming the label behind it.
const FIELD_LABELS = {
    startDatetime: "START_DATETIME_LABEL",
    dueDatetime: "DUE_DATETIME_LABEL",
    duration: "DURATION_LABEL",
    recurrence: "RECURRENCE_LABEL"
}

const durationOptions = [
    { key: "", name: "None"},
    { key: "PT5M", name: "5 Minutes"},
    { key: "PT10M", name: "10 Minutes"},
    { key: "PT15M", name: "15 Minutes"},
    { key: "PT20M", name: "20 Minutes"},
    { key: "PT30M", name: "30 Minutes"},
    { key: "PT45M", name: "45 Minutes"},
    { key: "PT1H", name: "1 Hour"},
    { key: "PT1H30M", name: "1 Hour 30 Minutes"},
    { key: "PT2H", name: "2 Hours"},
    { key: "PT3H", name: "3 Hours"},
    { key: "PT4H", name: "4 Hours"},
    { key: "PT6H", name: "6 Hours"},
    { key: "PT7H", name: "7 Hours"},
    { key: "PT8H", name: "8 Hours"},
    { key: "PT9H", name: "9 Hours"},
    { key: "PT12H", name: "12 Hours"},
    { key: "PT24H", name: "24 Hours"}
]

// The value every target agrees on, or MIXED when they disagree.
function sharedValue(notes, label) {
    const values = new Set(notes.map(note => note.getLabelValue(label) ?? ""))
    return values.size > 1 ? MIXED : ([...values][0] ?? "")
}

function DatesDurationPicker({ values, onChange }) {
    const mixedDuration = values.duration === MIXED

    return (
        <div>
            <div>
                <label>Start Date{values.startDatetime === MIXED ? ` ${MIXED_TEXT}` : ""}</label>
                <FormTextBox
                    type="datetime-local" placeholder="not set"
                    currentValue={values.startDatetime === MIXED ? "" : values.startDatetime}
                    onChange={value => onChange("startDatetime", value)}
                />
            </div>
            <div>
                <label>Due Date{values.dueDatetime === MIXED ? ` ${MIXED_TEXT}` : ""}</label>
                <FormTextBox
                    type="datetime-local" placeholder="not set"
                    currentValue={values.dueDatetime === MIXED ? "" : values.dueDatetime}
                    onChange={value => onChange("dueDatetime", value)}
                />
            </div>
            <div>
                <label>Duration</label>
                <FormDropdownList
                    values={mixedDuration
                        ? [...durationOptions, { key: MIXED, name: MIXED_TEXT }]
                        : durationOptions}
                    currentValue={values.duration}
                    onChange={value => {
                        if (value === MIXED) return
                        onChange("duration", value)
                    }}
                    keyProperty="key" titleProperty="name"
                    class="dropdown-component form-control"
                />
            </div>
        </div>
    )
}

// The Task pane's "Recurrence" section: the editor lives in a popover behind a
// button that reads the rule back in plain English.
function NoteRecurrencePicker({ recurrence, onChange }){
    const isMixed = recurrence === MIXED
    const popoverId = useId()

    return (
        <div className="recurrence-section">
            <label>Recurrence</label>
            <div>
                <button
                    type="button"
                    className="btn btn-secondary recurrence-summary"
                    popovertarget={popoverId}
                >
                    <span className="bx bx-repeat" />
                    {isMixed ? MIXED_TEXT : (humanizeRecurrence(recurrence) || "Does not repeat")}
                </button>
            </div>
            <div id={popoverId} popover="auto" className="recurrence-popover">
                <RecurrencePicker
                    recurrence={isMixed ? "" : recurrence}
                    onChange={onChange}
                />
            </div>
        </div>
    )
}

function MainWidget(){
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [agendaTaskWidget] = useNoteLabel(note, "agendaTaskWidget")
    const selectedNoteIds = useSelectedNoteIds()
    const [ids, setIds] = useState(null)
    const [targets, setTargets] = useState([])
    const [values, setValues] = useState(null)
    const [reload, setReload] = useState(0)

    useEffect(() => {
        (async () => {
            const settings = await getAgendaTaskSettings()
            if (!settings) return
            const { constants, rescheduleOptions } = settings
            setIds({ constants, rescheduleOptions })
        })()
    }, [])

    // The fields no longer read their notes through useNoteLabel, so anything
    // else writing to a target's labels has to reach them this way.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (!targets.length) return
        const targetIds = new Set(targets)
        if (loadResults.getAttributeRows().some(attr => targetIds.has(attr.noteId))) {
            setReload(count => count + 1)
        }
    })

    useEffect(() => {
        (async () => {
            if (!ids) return
            // A tree selection retargets the widget at every selected task,
            // matching how the Area and Template pickers treat it; with nothing
            // selected it stays on the active note. Notes that aren't tasks are
            // dropped, so a mixed selection only writes to the tasks in it.
            const candidates = selectedNoteIds.length ? selectedNoteIds : (noteId ? [noteId] : [])
            const notes = (await getNotes(candidates, true))
                .filter(note => note.getLabelValue("agendaTaskWidget") === "")

            setTargets(notes.map(note => note.noteId))
            setValues(notes.length ? {
                startDatetime: sharedValue(notes, ids.constants.START_DATETIME_LABEL),
                dueDatetime: sharedValue(notes, ids.constants.DUE_DATETIME_LABEL),
                duration: sharedValue(notes, ids.constants.DURATION_LABEL),
                recurrence: sharedValue(notes, ids.constants.RECURRENCE_LABEL)
            } : null)
        })()
    }, [noteId, selectedNoteIds, agendaTaskWidget, ids, reload])

    if (!ids || !targets.length || !values) return null

    // Broadcast only; the overview widget subscribes and re-files. Do not
    // import libAgendaOverview here (keeps this decoupled from Overview).
    function afterChange() {
        setReload(count => count + 1)
        api.triggerEvent("agenda:tasksChanged")
    }

    // The optimistic setValues keeps the inputs steady until the write has
    // travelled to the backend and back.
    async function changeDate(field, value) {
        setValues(current => ({ ...current, [field]: value }))
        await setTaskLabel(targets, ids.constants[FIELD_LABELS[field]], value)
        for (const target of targets) {
            await updateDependentAttributes(target, ids.constants)
            // Editing the dates by hand can move a task off today just as
            // rescheduling does, so the My Day flag is re-evaluated here too.
            await clearMyDayFlagIfNotToday(target, ids.constants)
        }
        afterChange()
    }

    async function changeRecurrence(value) {
        setValues(current => ({ ...current, recurrence: value }))
        await setTaskLabel(targets, ids.constants[FIELD_LABELS.recurrence], value)
        // The My Day flag is left alone here, unlike on a date edit: the start
        // date hasn't moved, so a task on today belongs there still.
        for (const target of targets) await updateDependentAttributes(target, ids.constants)
        afterChange()
    }

    const actions = [
        {
            key: "complete",
            icon: "bx bx-check",
            text: "Complete Task",
            onClick: async () => {
                for (const target of targets) await complete(target, ids.constants)
                afterChange()
            }
        }
    ]

    const title = selectedNoteIds.length
        ? `Task (${targets.length} note${targets.length === 1 ? "" : "s"})`
        : "Task"

    return (
        <RightPanelWidget title={title}>
            <div className="agenda-widget agenda-task-widget">
                <details open>
                    <summary>Dates and Duration</summary>
                    <DatesDurationPicker values={values} onChange={changeDate}/>
                </details>
                <NoteRecurrencePicker recurrence={values.recurrence} onChange={changeRecurrence}/>
                <details open>
                    <summary>Actions</summary>
                    <div>
                        {actions.map(({ key, icon, text, onClick }) => (
                            <Button key={key} icon={icon} text={text} onClick={onClick} />
                        ))}
                        {ids.rescheduleOptions.map(option => (
                            <Button
                                key={option.id}
                                icon="bx bx-calendar"
                                text={option.name}
                                onClick={async () => {
                                    for (const target of targets) {
                                        await rescheduleByOption(target, ids.constants, option)
                                    }
                                    afterChange()
                                }}
                            />
                        ))}
                    </div>
                </details>
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 4,
    render: MainWidget
})
