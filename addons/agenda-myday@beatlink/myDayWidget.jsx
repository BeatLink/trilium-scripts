import {
    RightPanelWidget,
    Collapsible,
    defineWidget,
    useEffect,
    useState,
    useTriliumEvent,
    Button,
} from "trilium:preact";

import { Timer } from "Timer.jsx"
import { MyDayNote } from "myDayNote.jsx"

const {
    getMyDaySettings,
    getSuggestedTasks,
    addTaskToMyDay,
    addDueTasksToMyDay,
    sendNotificationForDueTasks,
    pruneMyDayNote
} = require("myDaySettings.js")

// One suggested task: its title, when it's scheduled, and a + that files it onto
// the My Day note.
function Suggestion({ task, onAdd }) {
    const when = api.dayjs(task.datetime)
    const isToday = when.isSame(api.dayjs(), "day")

    return (
        <div className="myDaySuggestion">
            <Button
                icon="bx bx-plus"
                title="Add to My Day"
                onClick={() => onAdd(task.noteId)}
            />
            <a className="myDaySuggestionTitle" href={`#root/${task.noteId}`}>{task.title}</a>
            <span className="myDaySuggestionWhen">
                {isToday ? when.format("HH:mm") : when.format("MMM D")}
            </span>
        </div>
    )
}

function MyDay() {
    const [ids, setIds] = useState(null)
    const [buckets, setBuckets] = useState([])

    useEffect(() => {
        (async () => {
            setIds({ myDay: await getMyDaySettings() })
        })()
    }, [])

    // No bundled note ships with this addon: point the My Day Note setting at
    // whichever note you want to collect today's tasks.
    const myDayNoteId = ids?.myDay?.myDayNoteId

    // Suggestions come from the configured task search, so they stay empty when
    // it matches nothing.
    async function refreshSuggestions() {
        if (!ids) return
        setBuckets(await getSuggestedTasks(ids.myDay, myDayNoteId))
    }

    // Pruning runs first so a task completed while the panel was unmounted (no
    // event reached us) is cleared on the way in.
    useEffect(() => {
        if (!myDayNoteId) return
        (async () => {
            await pruneMyDayNote(myDayNoteId)
            await refreshSuggestions()
        })()
    }, [ids, myDayNoteId])

    useTriliumEvent("agenda:tasksChanged", async () => {
        if (!ids) return
        await pruneMyDayNote(myDayNoteId)
        await refreshSuggestions()
    })

    useEffect(() => {
        if (!ids?.myDay.addTasksWhenDue) return
        const interval = setInterval(
            async () => {
                await addDueTasksToMyDay(ids.myDay, myDayNoteId)
                await refreshSuggestions()
            },
            30000
        )
        return () => clearInterval(interval);
    }, [ids, myDayNoteId])

    useEffect(() => {
        if (!ids?.myDay.sendDueNotifications) return
        const interval = setInterval(
            () => { sendNotificationForDueTasks(ids.myDay) },
            15000
        )
        return () => clearInterval(interval);
    }, [ids])

    if (!ids) return null

    async function addToMyDay(taskNoteId) {
        await addTaskToMyDay(myDayNoteId, taskNoteId, true, ids.myDay.addToTop)
        await refreshSuggestions()
    }

    // The panel is shown on every note, so the My Day note is always at hand and
    // never has to be navigated to.
    return (
        <RightPanelWidget id="x-my-day" title="My Day">
            {myDayNoteId
                ? <MyDayNote noteId={myDayNoteId} />
                : <div className="myDayEmpty">Set the My Day Note in settings.</div>}
            <div className="myDayControls">
                <Timer initialEnableSounds={ids.myDay.enableSounds} />
            </div>
            <Collapsible title="Suggestions" className="myDaySuggestionsSection">
                <div className="myDaySuggestions">
                    {buckets.length === 0 && (
                        <div className="myDayEmpty">Nothing to suggest.</div>
                    )}
                    {buckets.map(bucket => (
                        <div key={bucket.id}>
                            <label>{bucket.display}</label>
                            {bucket.tasks.map(task => (
                                <Suggestion key={task.noteId} task={task} onAdd={addToMyDay} />
                            ))}
                        </div>
                    ))}
                </div>
            </Collapsible>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 5,
    render: MyDay
});
