import {
    RightPanelWidget,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
    useEffect,
    useState
} from "trilium:preact";

import { startNote } from "trilium:api"

import { DatesDurationPicker } from "DatesDurationPicker.jsx"
import { RecurrencePicker } from "RecurrencePicker.jsx"
import { ActionBar } from "ActionBar.jsx"
import { RankPicker } from "RankPicker.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { updateTaskLists } = require("libAgendaOverview.js")
const { complete, rescheduleByDays } = require("libAgendaTask.js")

// Main Widget ---------------------------------------------------------------------------
function MainWidget(){
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [agendaTaskWidget] = useNoteLabel(note, "agendaTaskWidget")
    const [ids, setIds] = useState(null)

    // Resolve this widget's own relations + settings once — separate from
    // `noteId` above, which is whichever note the user is currently browsing
    useEffect(() => {
        (async () => {
            const { constants, profileNoteIds } = await getAgendaSettings()
            const icalNoteId = await startNote.getRelationValue("icalNote")
            setIds({ constants, profileNoteIds, icalNoteId })
        })()
    }, [])

    if (agendaTaskWidget !== '') {return null;}
    if (!ids) return null

    // Every picker below mutates a task-related label — each needs the
    // overview lists (and ical export) refreshed afterward. Owned here,
    // once, rather than each picker requiring libAgendaOverview.js itself,
    // so this widget is the only thing that knows the four pickers are
    // being used in an Agenda-task context at all.
    async function afterChange() {
        await updateTaskLists(ids.profileNoteIds, ids.constants, ids.icalNoteId)
    }

    const actions = [
        {
            key: "complete",
            icon: "bx bx-check",
            text: "Complete Task",
            onClick: async () => { await complete(noteId, ids.constants); await afterChange() }
        },
        {
            key: "today",
            icon: "bx bx-rocket",
            text: "Start Today",
            onClick: async () => { await rescheduleByDays(noteId, ids.constants, 0); await afterChange() }
        },
        {
            key: "tomorrow",
            icon: "bx bx-rocket",
            text: "Start Tomorrow",
            onClick: async () => { await rescheduleByDays(noteId, ids.constants, 1); await afterChange() }
        }
    ]

    return (
        <RightPanelWidget title="Task">
            <div className="agenda-widget">
                <div>
                    <label>Dates and Duration</label>
                    <DatesDurationPicker constants={ids.constants} onAfterChange={afterChange}/>
                </div>
                <div>
                    <label>Recurrence</label>
                    <RecurrencePicker constants={ids.constants} onAfterChange={afterChange}/>
                </div>
                <div>
                    <label>Actions</label>
                    <ActionBar actions={actions}/>
                </div>
                <div>
                    <label>Rank</label>
                    <RankPicker constants={ids.constants} onAfterChange={afterChange}/>
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
