import {
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useEffect,
    useState,
} from "trilium:preact";

import { startNote } from "trilium:api"

import { Timer } from "Timer.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { sendNotificationForDueTasks } = require("libAgendaOverview.js")
const { addDueTasksToAgendaNow } = require("libAgendaNow.js")

// My Day focus controls — a manual countdown timer, shown inline in the
// note-detail pane, but only while the current note is the note the user picked
// as their "My Day" note (myDayNoteId, from settings). Everywhere else it
// renders nothing.
function MyDay() {
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");

    // This widget's own settings — resolved once. `myDayNoteId` is the note
    // this widget attaches to; the constants/profileContext feed the due-task
    // and notification background loops. If the user hasn't picked a My Day
    // note in settings, fall back to the shipped "My Day" note this widget's
    // `nowNote` relation points at (the default target).
    const [ids, setIds] = useState(null)
    useEffect(() => {
        (async () => {
            const { constants, profileContext, myDay } = await getAgendaSettings()
            const defaultNoteId = await startNote.getRelationValue("nowNote")
            setIds({ constants, profileContext, myDay, defaultNoteId })
        })()
    }, [])

    const myDayNoteId = ids?.myDay?.myDayNoteId || ids?.defaultNoteId
    const isMyDay = myDayNoteId && noteId === myDayNoteId

    // Add Due Tasks To My Day Note — files any task starting now onto the
    // My Day note as a to-do. Runs only while browsing the My Day note.
    useEffect(() => {
        if (!isMyDay) return
        if (ids.myDay.addTasksWhenDue) {
            const interval = setInterval(
                async () => { await addDueTasksToAgendaNow(ids.profileContext, ids.constants, myDayNoteId) },
                30000
            )
            return () => clearInterval(interval);
        }
    }, [isMyDay, ids, myDayNoteId])

    // Send Notifications for tasks that are due.
    useEffect(() => {
        if (!isMyDay) return
        if (ids.myDay.sendDueNotifications) {
            const interval = setInterval(
                () => { sendNotificationForDueTasks(ids.profileContext, ids.constants) },
                15000
            )
            return () => clearInterval(interval);
        }
    }, [isMyDay, ids])

    if (!isMyDay) return null

    return (
        <div className="myDayControls">
            <Timer initialEnableSounds={ids.myDay.enableSounds} />
        </div>
    )
}

// Widget Export ---------------------------------------------------------------------
export default defineWidget({
    parent: "note-detail-pane",
    position: 100,
    render: MyDay
});
