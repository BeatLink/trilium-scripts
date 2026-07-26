import {
    RightPanelWidget,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useEffect,
    useState,
    useTriliumEvent,
    Button,
} from "trilium:preact";

import { Timer } from "Timer.jsx"

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
    const { note } = useActiveNoteContext()
    const activeNoteId = useNoteProperty(note, "noteId")

    useEffect(() => {
        (async () => {
            setIds({ myDay: await getMyDaySettings() })
        })()
    }, [])

    // No bundled note ships with this addon: point the My Day Note setting at
    // whichever note you want to collect today's tasks.
    const myDayNoteId = ids?.myDay?.myDayNoteId
    const isVisible = Boolean(myDayNoteId) && activeNoteId === myDayNoteId

    // Suggestions come from the configured task search, so they stay empty when
    // it matches nothing.
    async function refreshSuggestions() {
        if (!ids) return
        setBuckets(await getSuggestedTasks(ids.myDay, myDayNoteId))
    }

    // Only query while the panel is on screen; the auto-file loop below calls
    // refreshSuggestions() directly, so its own refresh is unaffected. Pruning
    // runs first so a task completed while the panel was unmounted (no event
    // reached us) is cleared on the way in.
    useEffect(() => {
        if (!isVisible) return
        (async () => {
            await pruneMyDayNote(ids.myDay, myDayNoteId)
            await refreshSuggestions()
        })()
    }, [ids, myDayNoteId, isVisible])

    // Deliberately ungated: a task is usually completed from its own note, not
    // from the My Day note, so gating the prune on isVisible would mean it only
    // ran when it had nothing to do.
    useTriliumEvent("agenda:tasksChanged", async () => {
        if (!ids) return
        await pruneMyDayNote(ids.myDay, myDayNoteId)
        if (isVisible) await refreshSuggestions()
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

    // The panel only shows on the My Day note itself. The two setInterval loops
    // above are deliberately left outside this gate: they are background
    // automation, and would stop firing as soon as you navigated elsewhere.
    if (!ids || !isVisible) return null

    async function addToMyDay(taskNoteId) {
        await addTaskToMyDay(myDayNoteId, taskNoteId, true, ids.myDay.addToTop)
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
