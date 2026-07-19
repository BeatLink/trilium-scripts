import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"
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
            <p className="template-picker-blurb">
                The templates the picker dropdown offers. Run <strong>Scan</strong> to pull in every{" "}
                <code>#template</code> note you have — newly found ones are added enabled, at the end.
                Existing rows keep their settings and position. Untick <strong>Enabled</strong> to
                hide a template, use each row's move controls to reorder, then click{" "}
                <strong>Save</strong>.
            </p>

            <button className="template-picker-scan" disabled={busy} onClick={onScan}>
                {busy ? "Scanning..." : "Scan for templates"}
            </button>

            {status && <div className="template-picker-status">{status}</div>}

            <SettingsForm
                key={reloadKey}
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
            />
        </div>
    )
}

export default function TemplatePickerSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("AddonData:config")
            setConfigNoteId(target.noteId)
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    return <TemplatesPanel schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
}
