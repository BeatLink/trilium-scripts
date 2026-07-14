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
import { ActionBar } from "ActionBar.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { complete, rescheduleByDays } = require("libAgendaTask.js")
const { publish } = require("libIpc.js")

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
            const settings = await getAgendaSettings()
            if (!settings) return
            const { constants } = settings
            setIds({ constants })
        })()
    }, [])

    if (agendaTaskWidget !== '') {return null;}
    if (!ids) return null

    // Every picker and quick action below mutates a task-related label. This
    // widget doesn't refresh the overview note itself — it just broadcasts
    // `agenda:tasksChanged` over libipc@beatlink. The Agenda Overview widget
    // (a separate addon) owns the profile context and iCal note, so it is the
    // one that subscribes and re-files the overview note. That keeps this
    // addon free of any dependency on libAgendaOverview; if Overview isn't
    // installed there's no overview note to keep fresh anyway.
    function afterChange() {
        publish("agenda:tasksChanged")
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
        },
        // Built-in Trilium view commands — no task label is touched, so these
        // deliberately skip afterChange(). Hoist toggles between this note and
        // root, mirroring hoist-note@beatlink.
        {
            key: "zen",
            icon: "bx bx-expand",
            text: "Zen Mode",
            onClick: () => api.triggerCommand("toggleZenMode")
        },
        {
            key: "hoist",
            icon: "bx bx-move-vertical",
            text: "Hoist Note",
            onClick: () => {
                api.setHoistedNoteId(
                    api.getActiveContext().hoistedNoteId === noteId ? "root" : noteId
                )
            }
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
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 4,
    render: MainWidget
})
