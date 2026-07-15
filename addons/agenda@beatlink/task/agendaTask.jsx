import {
    RightPanelWidget,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
    useMemo,
    useEffect,
    useState,
    FormDropdownList
} from "trilium:preact";

import { FormDatetime } from "FormDatetime.jsx"
import { FormToggleButton } from "FormToggleButton.jsx"
import { FormNumber } from "FormNumber.jsx"
import { ActionBar } from "ActionBar.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { complete, rescheduleByDays, updateDependentAttributes } = require("libAgendaTask.js")
const { RRuleToObj, ObjToRRule } = require("libRecurrence.js")
const { publish } = require("libIpc.js")

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
        await onAfterChange()
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

const intervalOptions = [
    { key: "MINUTELY", name: "Minute" },
    { key: "HOURLY", name: "Hour" },
    { key: "DAILY", name: "Day" },
    { key: "WEEKLY", name: "Week" },
    { key: "MONTHLY", name: "Month" },
    { key: "YEARLY", name: "Year" }
]

const weekdayOptions = [
    { key: "SU", name: "Sunday" },
    { key: "MO", name: "Monday" },
    { key: "TU", name: "Tuesday" },
    { key: "WE", name: "Wednesday" },
    { key: "TH", name: "Thursday" },
    { key: "FR", name: "Friday" },
    { key: "SA", name: "Saturday" }
]

const monthOrdinalOptions = [
    { key: "1", name: "First" },
    { key: "2", name: "Second" },
    { key: "3", name: "Third" },
    { key: "4", name: "Fourth" },
    { key: "5", name: "Fifth" },
    { key: "-1", name: "Last" }
]

const monthModeOptions = [
    { key: "day", name: "Day of Month" },
    { key: "weekday", name: "Weekday" }
]

const stopOptions = [
    { key: "never", name: "Never" },
    { key: "number", name: "After Count" },
    { key: "date", name: "After Date" }
]

const timeIntervals = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]

function RecurrencePicker({ constants, onAfterChange }){
    const { note } = useActiveNoteContext();
    const [recurrence, setRecurrence] = useNoteLabel(note, constants.RECURRENCE_LABEL)

    const recurrenceObj = useMemo(
        () => RRuleToObj(recurrence),
        [recurrence]
    )

    function updateRecurrence(newRecurrence) {
        setRecurrence(ObjToRRule(newRecurrence))
        onAfterChange()
    }

    return (
        <div className="recurrence-picker">
            <div>
                <label>Enabled</label>
                <div>
                    <FormToggleButton
                        label="Task Repeats"
                        currentValue={recurrenceObj.enabled}
                        onChange={value => {
                            updateRecurrence({ ...recurrenceObj, enabled: value })
                        }}
                    />
                </div>
            </div>
            {recurrenceObj.enabled && (
                <div className="interval-picker">
                    <label>Interval</label>
                    <div>
                        <FormNumber
                            min="1" step="1" value={recurrenceObj.intervalCount}
                            onChange={value => {
                                updateRecurrence({ ...recurrenceObj, intervalCount: value })
                            }}
                        />
                        <FormDropdownList
                            id="recurrenceIntervalInput"
                            values={intervalOptions}
                            currentValue={recurrenceObj.interval}
                            onChange={value => {
                                updateRecurrence({ ...recurrenceObj, interval: value })
                            }}
                            keyProperty="key" titleProperty="name"
                        />
                    </div>
                </div>
            )}

            {recurrenceObj.enabled && timeIntervals.includes(recurrenceObj.interval) && (
                <div className="time-picker">
                    <label>At Time</label>
                    <div>
                        <FormNumber
                            min="0" max="23" step="1" placeholder="Hour"
                            value={recurrenceObj.time.hour}
                            onChange={value => {
                                updateRecurrence({
                                    ...recurrenceObj,
                                    time: { ...recurrenceObj.time, hour: value }
                                })
                            }}
                        />
                        <FormNumber
                            min="0" max="59" step="1" placeholder="Minute"
                            value={recurrenceObj.time.minute}
                            onChange={value => {
                                updateRecurrence({
                                    ...recurrenceObj,
                                    time: { ...recurrenceObj.time, minute: value }
                                })
                            }}
                        />
                    </div>
                </div>
            )}

            {recurrenceObj.enabled && recurrenceObj.interval === "WEEKLY" && (
                <div className="weekdays-picker">
                    <label>Weekdays</label>
                    <div>
                        {weekdayOptions.map(({key, name}) => (
                            <FormToggleButton
                                key={key}
                                label={name.substring(0, 1)}
                                currentValue={recurrenceObj.weeks[key]}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        weeks: { ...recurrenceObj.weeks, [key]: value }
                                    })
                                }}
                            />
                        ))}
                    </div>
                </div>
            )}
            {recurrenceObj.enabled && recurrenceObj.interval === "MONTHLY" && (
                <div className="month-picker">
                    <label>On</label>
                    <div>
                        <FormDropdownList
                            values={monthModeOptions}
                            currentValue={recurrenceObj.month.mode}
                            onChange={value => {
                                const month = { ...recurrenceObj.month, mode: value }
                                if (value === "day" && month.day === "") month.day = "1"
                                if (value === "weekday" && month.weekday === "") month.weekday = "MO"
                                updateRecurrence({ ...recurrenceObj, month })
                            }}
                            keyProperty="key" titleProperty="name"
                        />
                        {recurrenceObj.month.mode === "day" && (
                            <FormNumber
                                min="1" max="31" step="1" placeholder="Day"
                                value={recurrenceObj.month.day}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        month: { ...recurrenceObj.month, day: value }
                                    })
                                }}
                            />
                        )}
                        {recurrenceObj.month.mode === "weekday" && (
                            <FormDropdownList
                                values={monthOrdinalOptions}
                                currentValue={recurrenceObj.month.ordinal}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        month: { ...recurrenceObj.month, ordinal: value }
                                    })
                                }}
                                keyProperty="key" titleProperty="name"
                            />
                        )}
                        {recurrenceObj.month.mode === "weekday" && (
                            <FormDropdownList
                                values={weekdayOptions}
                                currentValue={recurrenceObj.month.weekday}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        month: { ...recurrenceObj.month, weekday: value }
                                    })
                                }}
                                keyProperty="key" titleProperty="name"
                            />
                        )}
                    </div>
                </div>
            )}

            {recurrenceObj.enabled && (
                <div className="stop-picker">
                    <label>Stop Repeat</label>
                    <div>
                        <FormDropdownList
                            values={stopOptions}
                            currentValue={recurrenceObj.stop.type}
                            onChange={value => {
                                updateRecurrence({
                                    ...recurrenceObj,
                                    stop: { ...recurrenceObj.stop, type: value }
                                })
                            }}
                            keyProperty="key" titleProperty="name"
                        />
                        {recurrenceObj.stop.type === "number" && (
                            <FormNumber
                                min="1" step="1" value={recurrenceObj.stop.count}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        stop: { ...recurrenceObj.stop, count: value }
                                    })
                                }}
                            />
                        )}
                        {recurrenceObj.stop.type === "date" && (
                            <FormDatetime
                                value={recurrenceObj.stop.date}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        stop: { ...recurrenceObj.stop, date: value }
                                    })
                                }}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

function MainWidget(){
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [agendaTaskWidget] = useNoteLabel(note, "agendaTaskWidget")
    const [ids, setIds] = useState(null)

    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            if (!settings) return
            const { constants } = settings
            setIds({ constants })
        })()
    }, [])

    if (agendaTaskWidget !== '') {return null;}
    if (!ids) return null

    // Broadcast only; the overview widget subscribes and re-files. Do not
    // import libAgendaOverview here (keeps this decoupled from Overview).
    function afterChange() {
        publish("agenda:tasksChanged")
    }

    const actions = [
        {
            key: "complete",
            icon: "bx bx-check",
            text: "Complete Task",
            onClick: async () => { await complete(noteId, ids.constants); await afterChange() }
        },
        {
            key: "today",
            icon: "bx bx-rocket",
            text: "Start Today",
            onClick: async () => { await rescheduleByDays(noteId, ids.constants, 0); await afterChange() }
        },
        {
            key: "tomorrow",
            icon: "bx bx-rocket",
            text: "Start Tomorrow",
            onClick: async () => { await rescheduleByDays(noteId, ids.constants, 1); await afterChange() }
        },
        {
            key: "zen",
            icon: "bx bx-expand",
            text: "Zen Mode",
            onClick: () => api.triggerCommand("toggleZenMode")
        },
        {
            key: "hoist",
            icon: "bx bx-move-vertical",
            text: "Hoist Note",
            onClick: () => {
                api.setHoistedNoteId(
                    api.getActiveContext().hoistedNoteId === noteId ? "root" : noteId
                )
            }
        }
    ]

    return (
        <RightPanelWidget title="Task">
            <div className="agenda-widget">
                <div>
                    <label>Dates and Duration</label>
                    <DatesDurationPicker constants={ids.constants} onAfterChange={afterChange}/>
                </div>
                <div>
                    <label>Recurrence</label>
                    <RecurrencePicker constants={ids.constants} onAfterChange={afterChange}/>
                </div>
                <div>
                    <label>Actions</label>
                    <ActionBar actions={actions}/>
                </div>
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 4,
    render: MainWidget
})
