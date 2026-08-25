import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { SettingsForm, resolveConfigNotes } from "libSettingsUI.jsx"
import { scanTemplates } from "templateRegistry.jsx"

// The Scan button above the registry editor. Scan writes config directly, so the
// form is remounted (reloadKey bump) afterward to re-read the fresh config.
function TemplatesPanel({ schemaNoteId, configNoteId }) {
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [reloadKey, setReloadKey] = useState(0)

    async function onScan() {
        setBusy(true)
        setStatus(null)
        try {
            const r = await scanTemplates(schemaNoteId, configNoteId)
            setReloadKey(k => k + 1)
            setStatus(
                `Scan complete: ${r.added} new template${r.added === 1 ? "" : "s"} found ` +
                `(${r.total} total).`
            )
        } catch (e) {
            setStatus("Scan failed: " + String(e && e.message ? e.message : e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="template-picker-settings">
            <SettingsForm
                key={reloadKey}
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                extraPanels={[{
                    tab: "Scan",
                    render: () => (
                        <>
                            <p className="template-picker-blurb">
                                Run <strong>Scan</strong> to pull in every <code>#template</code> note
                                you have — newly found ones are added enabled, at the end, in the{" "}
                                <strong>Templates</strong> tab. Existing rows keep their settings and
                                position.
                            </p>
                            <button className="template-picker-scan" disabled={busy} onClick={onScan}>
                                {busy ? "Scanning..." : "Scan for templates"}
                            </button>
                            {status && <div className="template-picker-status">{status}</div>}
                        </>
                    )
                }]}
            />
        </div>
    )
}

// Not `SettingsPage`, because the Scan button stacks *above* the form rather
// than living in a tab — only the note resolution is shared.
export default function TemplatePickerSettings() {
    const [notes, setNotes] = useState(null)

    useEffect(() => {
        // `api.currentNote` must be read here, in this addon's own module —
        // inside libsettings it resolves to the library's note instead.
        (async () => setNotes(await resolveConfigNotes(api.currentNote)))()
    }, [])

    if (!notes?.schemaNoteId || !notes?.configNoteId) return <div><LoadingSpinner /> Loading...</div>

    return <TemplatesPanel schemaNoteId={notes.schemaNoteId} configNoteId={notes.configNoteId} />
}
