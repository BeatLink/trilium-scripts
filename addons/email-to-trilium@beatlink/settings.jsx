import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

export default function EmailToTriliumSettings() {
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

    return (
        <div class="etr-settings">
            <h3>Email to Trilium</h3>
            <p class="etr-hint">
                Register an OAuth app with Google (Gmail) or Microsoft (Azure) and set its
                redirect URI to <code>{location.origin}/custom/emailToTrilium?action=callback</code>.
                Fill in the client ID/secret below, save, then open the addon's inbox view and
                click <strong>Connect</strong> on each account.
            </p>
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
