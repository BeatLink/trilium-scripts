import {
    RightPanelWidget,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
    useEffect,
    useState,
    FormDropdownList,
    FormTextBox,
    Button
} from "trilium:preact";

import { RecurrencePicker } from "recurrencePicker.jsx"

const {
    complete,
    rescheduleByOption,
    updateDependentAttributes,
    clearMyDayFlagIfNotToday
} = require("libAgendaTask.js")
const { getAgendaTaskSettings } = require("agendaTaskSettings.js")

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

function DatesDurationPicker({ constants, onAfterChange }) {
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [startDatetime, setStartDatetime] = useNoteLabel(note, constants.START_DATETIME_LABEL)
    const [dueDatetime, setDueDatetime] = useNoteLabel(note, constants.DUE_DATETIME_LABEL)
    const [duration, setDuration] = useNoteLabel(note, constants.DURATION_LABEL)

    async function afterChange() {
        await updateDependentAttributes(noteId, constants)
        // Editing the dates by hand can move a task off today just as
        // rescheduling does, so the My Day flag is re-evaluated here too.
        await clearMyDayFlagIfNotToday(noteId, constants)
        await onAfterChange()
    }

    return (
        <div>
            <div>
                <label>Start Date</label>
                <FormTextBox
                    type="datetime-local" placeholder="not set"
                    currentValue={startDatetime}
                    onChange={value => {
                        setStartDatetime(value)
                        afterChange()
                    }}
                />
            </div>
            <div>
                <label>Due Date</label>
                <FormTextBox
                    type="datetime-local" placeholder="not set"
                    currentValue={dueDatetime}
                    onChange={value => {
                        setDueDatetime(value)
                        afterChange()
                    }}
                />
            </div>
            <div>
                <label>Duration</label>
                <FormDropdownList
                    values={durationOptions}
                    currentValue={duration ?? ""}
                    onChange={value => {
                        setDuration(value)
                        afterChange()
                    }}
                    keyProperty="key" titleProperty="name"
                    class="dropdown-component form-control"
                />
            </div>
        </div>
    )
}

// Adapter binding RecurrencePicker to a note's own recurrence label, for the
// Task pane's own "Recurrence" section.
function NoteRecurrencePicker({ constants, onAfterChange }){
    const { note } = useActiveNoteContext();
    const [recurrence, setRecurrence] = useNoteLabel(note, constants.RECURRENCE_LABEL)

    return (
        <RecurrencePicker
            recurrence={recurrence}
            onChange={value => {
                setRecurrence(value)
                onAfterChange()
            }}
        />
    )
}

function MainWidget(){
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [agendaTaskWidget] = useNoteLabel(note, "agendaTaskWidget")
    const [ids, setIds] = useState(null)

    useEffect(() => {
        (async () => {
            const settings = await getAgendaTaskSettings()
            if (!settings) return
            const { constants, rescheduleOptions } = settings
            setIds({ constants, rescheduleOptions })
        })()
    }, [])

    if (!ids) return null
    const isActionable = agendaTaskWidget === ''
    if (!isActionable) return null

    // Broadcast only; the overview widget subscribes and re-files. Do not
    // import libAgendaOverview here (keeps this decoupled from Overview).
    function afterChange() {
        api.triggerEvent("agenda:tasksChanged")
    }

    const actions = [
        {
            key: "complete",
            icon: "bx bx-check",
            text: "Complete Task",
            onClick: async () => { await complete(noteId, ids.constants); await afterChange() }
        }
    ]

    return (
        <RightPanelWidget title="Task">
            <div className="agenda-widget">
                <details open>
                    <summary>Dates and Duration</summary>
                    <DatesDurationPicker constants={ids.constants} onAfterChange={afterChange}/>
                </details>
                <details open>
                    <summary>Recurrence</summary>
                    <NoteRecurrencePicker constants={ids.constants} onAfterChange={afterChange}/>
                </details>
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
                                    await rescheduleByOption(noteId, ids.constants, option)
                                    await afterChange()
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
