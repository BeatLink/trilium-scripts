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
const { addDueTasksToAgendaNow } = require("agendaNow.js")

function MyDay() {
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");

    const [ids, setIds] = useState(null)
    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            if (!settings) return
            const { constants, profileContext, myDay } = settings
            const defaultNoteId = await startNote.getRelationValue("nowNote")
            setIds({ constants, profileContext, myDay, defaultNoteId })
        })()
    }, [])

    const myDayNoteId = ids?.myDay?.myDayNoteId || ids?.defaultNoteId
    const isMyDay = myDayNoteId && noteId === myDayNoteId

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

export default defineWidget({
    parent: "note-detail-pane",
    position: 100,
    render: MyDay
});
