import { useState, useEffect, Button, FormTextBox, FormDropdownList } from "trilium:preact"
import { loadSettings, saveSettings } from "libSettingsUI.jsx"
import { RecurrencePicker } from "recurrencePicker.jsx"

const { getAgendaTaskSettings } = require("agendaTaskSettings.js")

const modeOptions = [
    { key: "days", name: "Days From Now" },
    { key: "recurrence", name: "Recurrence Rule" }
]

// A hand-rolled editor for the `rescheduleOptions` registry, injected into the
// Agenda Editor in place of the generic SettingsForm rendering of that field —
// the generic form only knows how to render a recurrence rule as a raw rrule
// string, whereas this reuses the same rich RecurrencePicker the Task pane
// itself uses for a note's own recurrence.
export function RescheduleOptionsPanel() {
    const [ids, setIds] = useState(undefined)
    const [options, setOptions] = useState({})
    const [saveStatus, setSaveStatus] = useState(null)

    useEffect(() => {
        (async () => {
            const settings = await getAgendaTaskSettings()
            if (!settings) { setIds(null); return }
            setIds({ schemaNoteId: settings.schemaNoteId, configNoteId: settings.configNoteId })
            const values = await loadSettings(settings.schemaNoteId, settings.configNoteId)
            setOptions(values.rescheduleOptions || {})
        })()
    }, [])

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) {
        return (
            <div className="reschedule-options-panel">
                <p className="organize-dimensions-blurb">
                    Agenda's configuration isn't discoverable, so there are no reschedule options to edit.
                </p>
            </div>
        )
    }

    const orderedIds = Object.keys(options)

    function updateOption(id, patch) {
        setOptions({ ...options, [id]: { ...options[id], ...patch } })
    }

    function addOption() {
        const id = `option-${Date.now()}`
        setOptions({ ...options, [id]: { name: "New Option", mode: "days", days: 0, recurrence: "" } })
    }

    function removeOption(id) {
        const next = { ...options }
        delete next[id]
        setOptions(next)
    }

    function moveOption(id, direction) {
        const index = orderedIds.indexOf(id)
        const target = index + direction
        if (target < 0 || target >= orderedIds.length) return
        const reordered = [...orderedIds]
        ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
        const next = {}
        for (const key of reordered) next[key] = options[key]
        setOptions(next)
    }

    async function save() {
        const values = await loadSettings(ids.schemaNoteId, ids.configNoteId)
        values.rescheduleOptions = options
        await saveSettings(ids.schemaNoteId, ids.configNoteId, values)
        setSaveStatus("saved")
        setTimeout(() => setSaveStatus(null), 2000)
    }

    return (
        <div className="reschedule-options-panel">
            <p className="organize-dimensions-blurb">
                The reschedule buttons offered by the Task pane's Actions section. Each is either a
                fixed number of days from now, or the next occurrence of a recurrence rule computed
                from now. Order here is button order.
            </p>
            <div className="lst-list">
                {orderedIds.length === 0 && <p className="lst-list-empty">No entries yet.</p>}
                {orderedIds.map((id, index) => {
                    const option = options[id]
                    return (
                        <details className="lst-item" key={id} open>
                            <summary>
                                <span className="lst-item-title">{option.name || "Untitled"}</span>
                                <div className="lst-item-actions" onClick={e => e.preventDefault()}>
                                    <Button icon="bx-chevron-up" onClick={() => moveOption(id, -1)} disabled={index === 0} />
                                    <Button icon="bx-chevron-down" onClick={() => moveOption(id, 1)} disabled={index === orderedIds.length - 1} />
                                    <Button icon="bx-x" onClick={() => removeOption(id)} />
                                </div>
                            </summary>
                            <div className="lst-item-body">
                                <div className="lst-item-fields">
                                    <div className="lst-field-row">
                                        <label>Name</label>
                                        <FormTextBox
                                            currentValue={option.name}
                                            onChange={value => updateOption(id, { name: value })}
                                        />
                                    </div>
                                    <div className="lst-field-row">
                                        <label>Mode</label>
                                        <FormDropdownList
                                            values={modeOptions}
                                            currentValue={option.mode}
                                            onChange={value => updateOption(id, { mode: value })}
                                            keyProperty="key" titleProperty="name"
                                        />
                                    </div>
                                    {option.mode === "days" && (
                                        <div className="lst-field-row">
                                            <label>Days From Now</label>
                                            <FormTextBox
                                                type="number"
                                                min="0" step="1"
                                                currentValue={option.days}
                                                onChange={value => updateOption(id, { days: Number(value) })}
                                            />
                                        </div>
                                    )}
                                    {option.mode === "recurrence" && (
                                        <div className="lst-field-row">
                                            <label>Recurrence Rule</label>
                                            <RecurrencePicker
                                                recurrence={option.recurrence}
                                                onChange={value => updateOption(id, { recurrence: value })}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </details>
                    )
                })}
                <Button icon="bx-plus" text="Add" onClick={addOption} />
            </div>
            <div className="lst-actions">
                <Button
                    icon={saveStatus === "saved" ? "bx-check" : "bx-save"}
                    text={saveStatus === "saved" ? "Saved!" : "Save"}
                    onClick={save}
                />
            </div>
        </div>
    )
}
