// Imports -----------------------------------------------------------------------------------
import { 
    RightPanelWidget,
    defineWidget,
    FormCheckbox,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
    useState,
    useEffect
} from "trilium:preact";

import {
    startNote
} from "trilium:api"

// Main Widget ---------------------------------------------------------------------------
function MainWidget(){
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [expanded, setExpanded] = useNoteLabel(note, "alwaysExpanded")
    const [scriptNote, setScriptNote] = useState(null)

    useEffect(() => {
        async function fetchData() {
            const scriptNote = await startNote.getRelationTarget('scriptNote');
            setScriptNote(scriptNote)
        }
        fetchData();
  }, []);
    
    return (
        <RightPanelWidget title="Task">
            <div className="agenda-widget">
                <FormCheckbox
                    label="Always Expanded"
                    currentValue={expanded !== null ? true : false}
                    onChange={value => {
                        setExpanded(value ? "" : null)
                        scriptNote.executeScript()
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