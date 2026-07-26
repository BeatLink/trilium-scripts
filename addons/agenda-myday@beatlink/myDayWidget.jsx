import {
    RightPanelWidget,
    defineWidget,
    useEffect,
    useState,
    useTriliumEvent,
    Button,
} from "trilium:preact";

import { startNote } from "trilium:api"

import { Timer } from "Timer.jsx"

const {
    getMyDaySettings,
    getSuggestedTasks,
    addTaskToMyDay,
    addDueTasksToMyDay,
    sendNotificationForDueTasks
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
            const myDay = await getMyDaySettings()
            const defaultNoteId = await startNote.getRelationValue("nowNote")
            setIds({ myDay, defaultNoteId })
        })()
    }, [])

    const myDayNoteId = ids?.myDay?.myDayNoteId || ids?.defaultNoteId

    // Suggestions come from the configured task search, so they stay empty when
    // it matches nothing.
    async function refreshSuggestions() {
        if (!ids) return
        setBuckets(await getSuggestedTasks(ids.myDay, myDayNoteId))
    }

    useEffect(() => { refreshSuggestions() }, [ids, myDayNoteId])

    useTriliumEvent("agenda:tasksChanged", () => { refreshSuggestions() })

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
        await addTaskToMyDay(myDayNoteId, taskNoteId, true)
        await refreshSuggestions()
    }

    return (
        <RightPanelWidget title="My Day">
            <div className="myDayControls">
                <Timer initialEnableSounds={ids.myDay.enableSounds} />
            </div>
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
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 5,
    render: MyDay
});
