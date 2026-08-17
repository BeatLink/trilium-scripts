import { FormDropdownList, FormTextBox, useMemo } from "trilium:preact"
import { FormToggleButton } from "FormToggleButton.jsx"

const { RRuleToObj, ObjToRRule } = require("libAgendaTask.js")

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

const monthOfYearOptions = [
    { key: "1", name: "January" },
    { key: "2", name: "February" },
    { key: "3", name: "March" },
    { key: "4", name: "April" },
    { key: "5", name: "May" },
    { key: "6", name: "June" },
    { key: "7", name: "July" },
    { key: "8", name: "August" },
    { key: "9", name: "September" },
    { key: "10", name: "October" },
    { key: "11", name: "November" },
    { key: "12", name: "December" }
]

const stopOptions = [
    { key: "never", name: "Never" },
    { key: "number", name: "After Count" },
    { key: "date", name: "After Date" }
]

const timeIntervals = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]

// The recurrence object stores hour/minute as strings; a time input speaks "HH:mm".
function timeToInput({ hour, minute }) {
    if (hour === "" || hour == null) return ""
    return `${String(hour).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}`
}

function inputToTime(value) {
    if (!value) return { hour: "", minute: "" }
    const [hour, minute] = value.split(":")
    return { hour: String(Number(hour)), minute: String(Number(minute)) }
}

// Pure value/onChange recurrence editor (an rrule string in, an rrule string
// out) so it can be reused both on a note's own recurrence label (the Task
// pane's own "Recurrence" section) and on a plain config value (agenda's
// Reschedule Options settings panel).
export function RecurrencePicker({ recurrence, onChange }){
    const recurrenceObj = useMemo(
        () => RRuleToObj(recurrence),
        [recurrence]
    )

    function updateRecurrence(newRecurrence) {
        onChange(ObjToRRule(newRecurrence))
    }

    return (
        <div className="recurrence-picker">
            <div>
                <label>Enabled</label>
                <div className="enabled-picker">
                    <FormToggleButton
                        label="Enabled"
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
                        <FormTextBox
                            type="number"
                            min="1" step="1" currentValue={recurrenceObj.intervalCount}
                            onChange={value => {
                                updateRecurrence({
                                    ...recurrenceObj,
                                    intervalCount: Number(value)
                                })
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
                        <FormTextBox
                            type="time" placeholder="not set"
                            currentValue={timeToInput(recurrenceObj.time)}
                            onChange={value => {
                                updateRecurrence({
                                    ...recurrenceObj,
                                    time: inputToTime(value)
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
            {recurrenceObj.enabled && (recurrenceObj.interval === "MONTHLY" || recurrenceObj.interval === "YEARLY") && (
                <div className="month-picker">
                    <label>On</label>
                    <div>
                        {recurrenceObj.interval === "YEARLY" && (
                            <FormDropdownList
                                values={monthOfYearOptions}
                                currentValue={recurrenceObj.month.month}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        month: { ...recurrenceObj.month, month: value }
                                    })
                                }}
                                keyProperty="key" titleProperty="name"
                            />
                        )}
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
                            <FormTextBox
                                type="number"
                                min="1" max="31" step="1" placeholder="Day"
                                currentValue={recurrenceObj.month.day}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        month: {
                                            ...recurrenceObj.month,
                                            day: Number(value)
                                        }
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
                            <FormTextBox
                                type="number"
                                min="1" step="1" currentValue={recurrenceObj.stop.count}
                                onChange={value => {
                                    updateRecurrence({
                                        ...recurrenceObj,
                                        stop: {
                                            ...recurrenceObj.stop,
                                            count: Number(value)
                                        }
                                    })
                                }}
                            />
                        )}
                        {recurrenceObj.stop.type === "date" && (
                            <FormTextBox
                                type="datetime-local" placeholder="not set"
                                currentValue={recurrenceObj.stop.date}
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
