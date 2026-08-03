import { useState, useEffect, FormTextBox, Button } from "trilium:preact"
import { loadSettings, saveSettings } from "libSettingsUI.jsx"

const { getAgendaTaskSettings } = require("agendaTaskSettings.js")

const FIELDS = [
    { key: "startDatetimeLabel", label: "Start Datetime Label" },
    { key: "startDateLabel", label: "Start Date Label" },
    { key: "startTimeLabel", label: "Start Time Label" },
    { key: "dueDatetimeLabel", label: "Due Datetime Label" },
    { key: "dueDateLabel", label: "Due Date Label" },
    { key: "dueTimeLabel", label: "Due Time Label" },
    { key: "durationLabel", label: "Duration Label" },
    { key: "recurrenceLabel", label: "Recurrence Label" },
    { key: "blockedByRelation", label: "Blocked By Relation" }
]

// The label-name overrides for Task's own settings note (#agendaTaskConfig),
// injected into the Agenda Editor as its own tab since these fields live in
// taskSchema.json/taskConfig.json, not agenda's shared schema/config note.
export function TaskLabelsPanel() {
    const [ids, setIds] = useState(undefined)
    const [values, setValues] = useState({})
    const [saveStatus, setSaveStatus] = useState(null)

    useEffect(() => {
        (async () => {
            const settings = await getAgendaTaskSettings()
            if (!settings) { setIds(null); return }
            setIds({ schemaNoteId: settings.schemaNoteId, configNoteId: settings.configNoteId })
            const loaded = await loadSettings(settings.schemaNoteId, settings.configNoteId)
            setValues(loaded)
        })()
    }, [])

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) {
        return (
            <div className="task-labels-panel">
                <p className="organize-dimensions-blurb">
                    Task's configuration isn't discoverable, so there are no labels to edit.
                </p>
            </div>
        )
    }

    async function save() {
        await saveSettings(ids.schemaNoteId, ids.configNoteId, values)
        setSaveStatus("saved")
        setTimeout(() => setSaveStatus(null), 2000)
    }

    return (
        <div className="task-labels-panel">
            {FIELDS.map(({ key, label }) => (
                <div className="lst-field-row" key={key}>
                    <label>{label}</label>
                    <FormTextBox
                        currentValue={values[key] || ""}
                        onChange={value => setValues({ ...values, [key]: value })}
                    />
                </div>
            ))}
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
