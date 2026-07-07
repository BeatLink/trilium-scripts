// Imports -----------------------------------------------------------------------------------
import {
    RightPanelWidget,
    defineWidget,
    FormCheckbox,
    useActiveNoteContext,
    useNoteLabelBoolean,
    useNoteRelationTarget,
} from "trilium:preact"

import {
    startNote
} from "trilium:api"

// Main Widget ---------------------------------------------------------------------------
function MainWidget() {
    const { note } = useActiveNoteContext()
    const [expanded, setExpanded] = useNoteLabelBoolean(note, "alwaysExpanded")
    const [scriptNote] = useNoteRelationTarget(startNote, "scriptNote")

    return (
        <RightPanelWidget title="Task">
            <div className="agenda-widget">
                <FormCheckbox
                    label="Always Expanded"
                    currentValue={!!expanded}
                    onChange={value => {
                        setExpanded(value ? true : null)
                        if (scriptNote) { scriptNote.executeScript() }
                    }}
                />
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 5,
    render: MainWidget
})