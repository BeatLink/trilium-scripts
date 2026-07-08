import {
    ActionButton,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
    useEffect,
    useState,
    useMemo,
} from "trilium:preact";

import {
    activateNote,
    activateNewNote,
    setHoistedNoteId,
    startNote,
} from "trilium:api"

import { Timer } from "Timer.jsx"
import { getAgendaSettings } from "agendaSettings.jsx"

const { sendNotificationForDueTasks } = require("libAgendaOverview.js")
const { durationStringToHMS, complete } = require("libAgendaTask.js")
const { setupLauncherWidget, launchAgendaNow, addDueTasksToAgendaNow } = require("libAgendaNow.js")

function AgendaNow() {
    // Note Info
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");

    // Agenda Now Note
    const agendaNowNote =
        window.process?.argv
        .find(arg => arg.includes("agendaNowData"))
        ?.split("=")[1]
    useEffect(() => {
        if (agendaNowNote){
            setHoistedNoteId("root")
            activateNote(agendaNowNote)
            document.body.classList.add("zen", "AgendaNowEnabled");
            return () => { document.body.classList.remove("zen", "AgendaNowEnabled") };
        }
    }, [agendaNowNote])

    // This widget's own relations + settings — profile/nowNote/widget/config note ids
    const [ids, setIds] = useState(null)
    useEffect(() => {
        (async () => {
            const { constants, profileContext } = await getAgendaSettings()
            const nowNoteId = await startNote.getRelationValue("nowNote")
            const widgetNoteId = await startNote.getRelationValue("LauncherWidget")
            const configNoteId = await startNote.getRelationValue("agendaNowConfig")
            setIds({ constants, profileContext, nowNoteId, widgetNoteId, configNoteId })
        })()
    }, [])

    // Time Info
    const [durationString] = useNoteLabel(note, ids?.constants?.DURATION_LABEL)
    const duration = useMemo(
        () => durationStringToHMS(durationString ?? ""),
        [durationString]
    )

    // Config (raw JSON note, not schema-driven — see libagendanow@beatlink's
    // README for why this doesn't go through libsettings)
    const [database, setDatabase] = useState({})
    useEffect(() => {
        if (!ids) return
        (async () => {
            const content = await (await api.getNote(ids.configNoteId)).getContent()
            setDatabase(JSON.parse(content))
        })()
    }, [ids])

    // Add Due Tasks To AgendaNow
    useEffect(() => {
        if (!ids) return
        if (database?.addTasksWhenDue) {
            const interval = setInterval(
                async () => { await addDueTasksToAgendaNow(ids.profileContext, ids.constants, ids.nowNoteId) },
                30000
            )
            return () => clearInterval(interval);
        }
    }, [database, ids])

    // Enable Launcher
    useEffect(() => {
        if (!ids) return
        database?.enableLauncher && setupLauncherWidget(ids.widgetNoteId)
    }, [database, ids])

    // Launch on Start
    useEffect(() => {
        if (!ids) return
        database?.launchOnStart && launchAgendaNow(ids.nowNoteId, database.newWindowConfig)
    }, [database, ids])

    // Send Notifications
    useEffect(() => {
        if (!ids) return
        if (database?.sendDueNotifications) {
            const interval = setInterval(
                () => { sendNotificationForDueTasks(ids.profileContext, ids.constants) },
                15000
            )
            return () => clearInterval(interval);
        }
    }, [database, ids])

    return (
        <div className="agendaNowControls">
            <span>
                {
                    noteId && noteId !== agendaNowNote &&
                    <ActionButton
                        icon="bx bx-arrow-back"
                        text="Back to Now"
                        onClick={e => {activateNewNote(agendaNowNote)} }
                        titlePosition="top"
                    />
                }
            </span>
            <Timer
                initialHours={duration.hours}
                initialMinutes={duration.minutes}
                initialSeconds={duration.seconds}
                initialEnableSounds={database.enableSounds}
            />
            { note?.hasLabel("agendaTaskWidget") &&
                <ActionButton
                    icon="bx bx-check"
                    text="Mark Done"
                    onClick={e => {complete(noteId, ids.constants)} }
                    titlePosition="top"
                />
            }
            <ActionButton
                icon="bx bx-x-circle"
                text="Close Window"
                onClick={e => {window.close()} }
                titlePosition="top"
            />
        </div>
    )
}

// Widget Export ---------------------------------------------------------------------
export default defineWidget({
    parent: "note-detail-pane",
    position: 100,
    render: AgendaNow
});
