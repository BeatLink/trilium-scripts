import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

// The Workflow settings page. Renders libsettings' SettingsForm over
// workflowSchema.json / workflowConfig.json — currently the configurable
// morning/noon/evening/night times used by the Organize "No Due Date" section.
// Same minimal wiring as area-picker's settings.jsx.
export default function WorkflowSettings() {
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
        <div className="workflow-settings">
            <h2>Workflow Settings</h2>
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
