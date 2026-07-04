import {
    RightPanelWidget,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
    useEffect,
    useState
} from "trilium:preact";

import { DatesDurationPicker } from "DatesDurationPicker.jsx"
import { RecurrencePicker } from "RecurrencePicker.jsx"
import { ActionPicker } from "ActionPicker.jsx"
import { RankPicker } from "RankPicker.jsx"

const constants = require("agendaConstants.js")

// Main Widget ---------------------------------------------------------------------------
function MainWidget(){
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [agendaTaskWidget] = useNoteLabel(note, "agendaTaskWidget")
    const [ids, setIds] = useState(null)

    // Resolve this widget's own relations once — separate from `noteId`
    // above, which is whichever note the user is currently browsing
    useEffect(() => {
        (async () => {
            const profileNoteId = await api.currentNote.getRelationValue("profile")
            const icalNoteId = await api.currentNote.getRelationValue("icalNote")
            setIds({ profileNoteIds: [profileNoteId], icalNoteId })
        })()
    }, [])

    if (agendaTaskWidget !== '') {return null;}
    if (!ids) return null

    return (
        <RightPanelWidget title="Task">
            <div className="agenda-widget">
                <div>
                    <label>Dates and Duration</label>
                    <DatesDurationPicker constants={constants} ids={ids}/>
                </div>
                <div>
                    <label>Recurrence</label>
                    <RecurrencePicker constants={constants} ids={ids}/>
                </div>
                <div>
                    <label>Actions</label>
                    <ActionPicker constants={constants} ids={ids}/>
                </div>
                <div>
                    <label>Rank</label>
                    <RankPicker constants={constants} ids={ids}/>
                </div>
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 4,
    render: MainWidget
})
