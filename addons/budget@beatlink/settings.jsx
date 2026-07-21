import { useState, useEffect } from "trilium:preact"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"

const { resolveColumns, moveColumn } = require("libBudget.js")

/*
 * The Columns tab. Column order isn't expressible in any schema field type, so
 * this rides SettingsForm's `extraPanels` hook and owns its own state and Save
 * button. The value it edits lives in the schema as a `hidden` list field, so
 * the main form still loads, merges, and persists it like any other setting.
 */
function ColumnSettings({ schemaNoteId, configNoteId }) {
    const [columns, setColumns] = useState(null)
    const [status, setStatus] = useState(null)

    useEffect(() => {
        (async () => {
            const values = await loadSettings(schemaNoteId, configNoteId)
            setColumns(resolveColumns(values.columns))
        })()
    }, [schemaNoteId, configNoteId])

    async function save() {
        // Re-read first so saving columns can't clobber a scalar setting saved
        // from another tab since this panel loaded.
        const values = await loadSettings(schemaNoteId, configNoteId)
        await saveSettings(schemaNoteId, configNoteId, {
            ...values,
            columns: columns.map(({ key, visible }) => ({ key, visible }))
        })
        setStatus("saved")
        setTimeout(() => setStatus(null), 2000)
    }

    if (!columns) return <div class="lst-loading">Loading columns...</div>

    return (
        <div class="lst-panel">
            <p class="lst-field-description">
                Choose which columns the budget table shows, and the order they appear in. Title is
                always shown first and the row actions always last, so neither is listed here.
            </p>
            <div class="lst-list">
                {columns.map((column, index) => (
                    <div class="lst-item budget-column-row" key={column.key}>
                        <label class="budget-column-toggle">
                            <input
                                type="checkbox"
                                checked={column.visible}
                                onChange={e => setColumns(current => current.map(c =>
                                    c.key === column.key ? { ...c, visible: e.target.checked } : c
                                ))}
                            />
                            <span>{column.label}</span>
                        </label>
                        <span class="lst-item-actions">
                            <button
                                class="budget-action bx bx-up-arrow-alt"
                                title="Move earlier"
                                disabled={index === 0}
                                onClick={() => setColumns(current => moveColumn(current, column.key, -1))}
                            />
                            <button
                                class="budget-action bx bx-down-arrow-alt"
                                title="Move later"
                                disabled={index === columns.length - 1}
                                onClick={() => setColumns(current => moveColumn(current, column.key, 1))}
                            />
                        </span>
                    </div>
                ))}
            </div>
            <div class="lst-actions">
                <button class="btn btn-primary" onClick={save}>Save</button>
                {status === "saved" && <span class="budget-column-status">Saved.</span>}
            </div>
        </div>
    )
}

export default function BudgetSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("configNote")
            setConfigNoteId(target.noteId)
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    return (
        <SettingsForm
            schemaNoteId={schemaNoteId}
            configNoteId={configNoteId}
            extraPanels={[{
                tab: "Columns",
                render: () => <ColumnSettings schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
            }]}
        />
    )
}
