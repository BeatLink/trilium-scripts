import {
    RightPanelWidget,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
    useEffect,
    useState,
    useTriliumEvent,
    Button
} from "trilium:preact";

const {
    getMyDaySettings,
    addTaskToMyDay,
    removeTaskFromMyDay
} = require("myDaySettings.js")

// A per-task panel: shown in the right pane while a task note is active, with a
// single button that files the task onto the My Day note or takes it back off.
//
// This lives here rather than in agenda-task@beatlink because everything it
// needs - the My Day note id, the add/remove pair that keeps the #agendaMyDay
// label and the note's links consistent - is this addon's. It reaches agenda
// tasks the same way the suggestions panel does: through a shared label
// convention (#agendaTaskWidget, configurable), not a code dependency.
function MyDayTask() {
    const { note } = useActiveNoteContext()
    const noteId = useNoteProperty(note, "noteId")
    const [settings, setSettings] = useState(null)
    const [onMyDay, setOnMyDay] = useState(false)

    useEffect(() => {
        (async () => setSettings(await getMyDaySettings()))()
    }, [])

    const taskLabel = settings?.taskLabel
    // Read through useNoteLabel so the button follows the note as it changes,
    // including edits made from anywhere else in the UI.
    const [taskMarker] = useNoteLabel(note, taskLabel || "agendaTaskWidget")
    const [myDayLabel] = useNoteLabel(note, "agendaMyDay")

    // The label hooks are the fast path; this resync covers the completion and
    // reschedule flows, which clear #agendaMyDay from the backend.
    useTriliumEvent("agenda:tasksChanged", async () => {
        const current = await api.getNote(noteId)
        setOnMyDay(Boolean(current?.hasLabel("agendaMyDay")))
    })

    useEffect(() => {
        setOnMyDay(myDayLabel !== undefined && myDayLabel !== null)
    }, [noteId, myDayLabel])

    const myDayNoteId = settings?.myDayNoteId
    // Never shown on the My Day note itself - that note carries the suggestions
    // panel, and filing it onto itself is meaningless.
    const isTask = taskMarker !== undefined && taskMarker !== null
    if (!settings || !myDayNoteId || !isTask || noteId === myDayNoteId) return null

    async function toggle() {
        if (onMyDay) {
            await removeTaskFromMyDay(myDayNoteId, noteId)
        } else {
            await addTaskToMyDay(myDayNoteId, noteId, true, settings.addToTop)
        }
        setOnMyDay(!onMyDay)
        // Lets the suggestions panel re-file and drop the task from its list.
        api.triggerEvent("agenda:tasksChanged")
    }

    return (
        <RightPanelWidget title="My Day">
            <div className="myDayTaskActions">
                <Button
                    icon={onMyDay ? "bx bx-x" : "bx bx-plus"}
                    text={onMyDay ? "Remove from My Day" : "Add to My Day"}
                    onClick={toggle}
                />
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 5,
    render: MyDayTask
});
