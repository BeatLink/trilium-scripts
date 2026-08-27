import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { SettingsForm, resolveConfigNotes } from "libSettingsUI.jsx"
import { recolorAreaNotes } from "areaRegistry.jsx"
import { MissingAreasPanel } from "areaPickerPage.jsx"

// The Recolor and Missing Areas tabs, injected beside the two the schema's own
// registry fields (`areas`, `excludeFilters`) render automatically. Recolor
// re-stamps #color on every note already carrying an #area, which the picker
// otherwise only does at assignment time.
function AreaSettings({ schemaNoteId, configNoteId }) {
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    async function onRecolor() {
        setBusy(true)
        setStatus(null)
        try {
            const r = await recolorAreaNotes(schemaNoteId, configNoteId)
            setStatus(
                `Recolored ${r.updated} note${r.updated === 1 ? "" : "s"} ` +
                `(${r.unchanged} already correct` +
                (r.unknown ? `, ${r.unknown} skipped with an unknown area` : "") +
                `).`
            )
        } catch (e) {
            setStatus("Recolor failed: " + String(e && e.message ? e.message : e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <SettingsForm
            schemaNoteId={schemaNoteId}
            configNoteId={configNoteId}
            extraPanels={[{
                tab: "Recolor",
                render: () => (
                    <>
                        <p className="area-picker-blurb">
                            Set <code>#color</code> on every note that already has an <code>#area</code>{" "}
                            to that area's current color. This reads the saved config, so save any
                            color changes in the <strong>Areas</strong> tab first. Notes whose{" "}
                            <code>#area</code> matches no area are left untouched.
                        </p>
                        <button className="area-picker-recolor" disabled={busy} onClick={onRecolor}>
                            {busy ? "Recoloring..." : "Recolor tagged notes"}
                        </button>
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
