import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { SettingsForm, resolveConfigNotes } from "libSettingsUI.jsx"
import { recolorAreaNotes, reapplyAreaOrder } from "areaRegistry.jsx"
import { MissingAreasPanel } from "areaPickerPage.jsx"

// The Maintenance and Missing Areas tabs, injected beside the two the schema's
// own registry fields (`areas`, `excludeFilters`) render automatically. Both
// maintenance actions restate on existing notes what the picker only writes at
// assignment time: the area's color, and its order prefix.
function AreaSettings({ schemaNoteId, configNoteId }) {
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    async function run(label, action) {
        setBusy(true)
        setStatus(null)
        try {
            const r = await action(schemaNoteId, configNoteId)
            setStatus(
                `${label} ${r.updated} note${r.updated === 1 ? "" : "s"} ` +
                `(${r.unchanged} already correct` +
                (r.unknown ? `, ${r.unknown} skipped with an unknown area` : "") +
                `).`
            )
        } catch (e) {
            setStatus(`${label} failed: ` + String(e && e.message ? e.message : e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <SettingsForm
            schemaNoteId={schemaNoteId}
            configNoteId={configNoteId}
            extraPanels={[{
                tab: "Maintenance",
                render: () => (
                    <>
                        <p className="area-picker-blurb">
                            Both actions read the saved config, so save any changes in the{" "}
                            <strong>Areas</strong> tab first. Notes whose <code>#area</code> names no
                            listed area are left untouched.
                        </p>
                        <p className="area-picker-blurb">
                            <strong>Recolor</strong> sets <code>#color</code> on every note that
                            already has an <code>#area</code> to that area's current color.
                        </p>
                        <p className="area-picker-blurb">
                            <strong>Reapply order</strong> restates the order prefix on those same
                            notes, so an area moved in the list takes its new position with it.
                            Both <code>career</code> and <code>07-career</code> become the current{" "}
                            <code>NN-career</code>.
                        </p>
                        <div className="area-picker-actions">
                            <button disabled={busy} onClick={() => run("Recolored", recolorAreaNotes)}>
                                {busy ? "Working..." : "Recolor tagged notes"}
                            </button>
                            <button disabled={busy} onClick={() => run("Reordered", reapplyAreaOrder)}>
                                {busy ? "Working..." : "Reapply order to tagged notes"}
                            </button>
                        </div>
                        {status && <div className="area-picker-status">{status}</div>}
                    </>
                )
            }, {
                tab: "Missing Areas",
                render: () => (
                    <MissingAreasPanel schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
                )
            }]}
        />
    )
}

export default function AreaPickerSettings() {
    const [notes, setNotes] = useState(null)

    useEffect(() => {
        // `api.currentNote` must be read here, in this addon's own module —
        // inside libsettings it resolves to the library's note instead.
        (async () => setNotes(await resolveConfigNotes(api.currentNote)))()
    }, [])

    if (!notes?.schemaNoteId || !notes?.configNoteId) return <div><LoadingSpinner /> Loading...</div>

    return <AreaSettings schemaNoteId={notes.schemaNoteId} configNoteId={notes.configNoteId} />
}
