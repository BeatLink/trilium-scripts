import {
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useEffect,
    useState,
} from "trilium:preact";

import { startNote } from "trilium:api"

import { Timer } from "Timer.jsx"

const { sendNotificationForDueTasks, addDueTasksToAgendaNow } = require("libAgendaOverview.js")
const { getMyDayContext } = require("myDaySettings.js")

function MyDay() {
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");

    const [ids, setIds] = useState(null)
    useEffect(() => {
        (async () => {
            const { myDay, hasAgenda, profileContext, constants } = await getMyDayContext()
            const defaultNoteId = await startNote.getRelationValue("nowNote")
            setIds({ constants, profileContext, myDay, hasAgenda, defaultNoteId })
        })()
    }, [])

    const myDayNoteId = ids?.myDay?.myDayNoteId || ids?.defaultNoteId
    const isMyDay = myDayNoteId && noteId === myDayNoteId

    useEffect(() => {
        if (!isMyDay) return
        // Both due-task loops resolve their task list from agenda's active
        // profile, so they stay off when agenda@beatlink isn't installed.
        if (ids.hasAgenda && ids.myDay.addTasksWhenDue) {
            const interval = setInterval(
                async () => { await addDueTasksToAgendaNow(ids.profileContext, ids.constants, myDayNoteId) },
                30000
            )
            return () => clearInterval(interval);
        }
    }, [isMyDay, ids, myDayNoteId])

    useEffect(() => {
        if (!isMyDay) return
        if (ids.hasAgenda && ids.myDay.sendDueNotifications) {
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

export default defineWidget({
    parent: "note-detail-pane",
    position: 100,
    render: MyDay
});
