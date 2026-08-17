import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"
import { activateNote } from "trilium:api"

export default function YouTubeManagerSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [managerNoteId, setManagerNoteId] = useState("")

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("configNote")
            setConfigNoteId(target.noteId)
            setManagerNoteId(await api.currentNote.getRelationValue("managerPageNote") || "")
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    return (
        <div>
            <button class="ym-btn" disabled={!managerNoteId} onClick={() => activateNote(managerNoteId)}>
                Back
            </button>
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
