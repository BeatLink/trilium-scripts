import { useState, useEffect, Button } from "trilium:preact"
import { activateNote } from "trilium:api"
import { SettingsForm } from "libSettingsUI.jsx"

export default function AgendaSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [profileEditorNoteId, setProfileEditorNoteId] = useState(null)

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("AddonData:config")
            setConfigNoteId(target.noteId)
            setProfileEditorNoteId(await api.currentNote.getRelationValue("profileEditorNote"))
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    return (
        <div>
            <h3>Agenda Settings</h3>
            {profileEditorNoteId && (
                <Button
                    icon="bx bx-edit"
                    text="Open Profile Editor"
                    onClick={() => activateNote(profileEditorNoteId)}
                />
            )}
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
