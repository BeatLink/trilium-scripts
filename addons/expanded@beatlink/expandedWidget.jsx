// Imports -----------------------------------------------------------------------------------
import {
    RightPanelWidget,
    defineWidget,
    ActionButton,
    useActiveNoteContext,
    useNoteLabelBoolean,
    useNoteRelationTarget,
    useState,
    useEffect,
} from "trilium:preact"

import {
    startNote
} from "trilium:api"

import { loadSettings } from "libSettingsUI.jsx"

// Main Widget ---------------------------------------------------------------------------
// Rendered once the configured label name is loaded; a pin toggle lives in the panel
// header (the `buttons` slot) rather than the body.
function ExpandedPanel({ note, labelName }) {
    const [expanded, setExpanded] = useNoteLabelBoolean(note, labelName)
    const [scriptNote] = useNoteRelationTarget(startNote, "scriptNote")

    return (
        <RightPanelWidget
            title="Always Expanded"
            buttons={
                <ActionButton
                    icon={expanded ? "bx bxs-pin" : "bx bx-pin"}
                    text={expanded ? "Unpin (stop keeping expanded)" : "Pin (keep always expanded)"}
                    titlePosition="top"
                    onClick={() => {
                        setExpanded(expanded ? null : true)
                        if (scriptNote) { scriptNote.executeScript() }
                    }}
                />
            }
        />
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 5,
    render() {
        const { note } = useActiveNoteContext()
        const [labelName, setLabelName] = useState(null)

        // The label name is an addon-wide setting, not per-note — load once.
        useEffect(() => {
            (async () => {
                const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
                const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
                const configNoteId = await api.runOnBackend((settingsNoteId) => {
                    return api.getNote(settingsNoteId).getRelationValue("AddonData:config")
                }, [settingsNoteId])
                const { labelName } = await loadSettings(schemaNoteId, configNoteId)
                setLabelName(labelName)
            })()
        }, [])

        if (!labelName || !note) return null

        return <ExpandedPanel note={note} labelName={labelName} />
    }
})
