import {
    FormDropdownList,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
} from "trilium:preact";
import { FormDatetime } from "FormDatetime.jsx"

const { updateDependentAttributes } = require("libAgendaTask.js")
const { updateTaskLists } = require("libAgendaOverview.js")

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


export function DatesDurationPicker({ constants, ids }) {
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [startDatetime, setStartDatetime] = useNoteLabel(note, constants.START_DATETIME_LABEL)
    const [dueDatetime, setDueDatetime] = useNoteLabel(note, constants.DUE_DATETIME_LABEL)
    const [duration, setDuration] = useNoteLabel(note, constants.DURATION_LABEL)

    async function afterChange() {
        await updateDependentAttributes(noteId, constants)
        await updateTaskLists(ids.profileNoteIds, constants, ids.icalNoteId)
    }

    return (
        <div>
            <div>
                <label>Start Date</label>
                <FormDatetime
                    value={startDatetime}
                    onChange={value => {
                        setStartDatetime(value)
                        afterChange()
                    }}
                />
            </div>
            <div>
                <label>Due Date</label>
                <FormDatetime
                    value={dueDatetime}
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
