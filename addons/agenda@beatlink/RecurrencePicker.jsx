import { FormDropdownList, useActiveNoteContext, useNoteProperty, useNoteLabel, useMemo } from "trilium:preact";
import { FormToggleButton } from "FormToggleButton.jsx"
import { FormNumber } from "FormNumber.jsx"
import { FormDatetime } from "FormDatetime.jsx"

const { RRuleToObj, ObjToRRule } = require("libRecurrence.js")
const { updateTaskLists } = require("libAgendaOverview.js")

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

const stopOptions = [
    { key: "never", name: "Never" },
    { key: "number", name: "After Count" },
    { key: "date", name: "After Date" }
]

export function RecurrencePicker({ constants, ids }){
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [recurrence, setRecurrence] = useNoteLabel(note, constants.RECURRENCE_LABEL)

    const recurrenceObj = useMemo(
        () => RRuleToObj(recurrence),
        [recurrence]
    )

    function updateRecurrence(newRecurrence) {
        setRecurrence(ObjToRRule(newRecurrence))
        updateTaskLists(ids.profileNoteIds, constants, ids.icalNoteId)
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
                    <label>Day of Month</label>
                    <div>
                        {recurrenceObj.month.weekday !== "" && (
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
                        <FormDropdownList
                            values={[{key: "", name: "None"}, ...weekdayOptions]}
                            currentValue={recurrenceObj.month.weekday}
                            onChange={value => {
                                updateRecurrence({
                                    ...recurrenceObj,
                                    month: { ...recurrenceObj.month, weekday: value }
                                })
                            }}
                            keyProperty="key" titleProperty="name"
                        />
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
