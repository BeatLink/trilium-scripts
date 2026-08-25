import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { loadSettings } from "libSettingsUI.jsx"
import { CalendarWidget } from "CalendarWidget.jsx"

export default function SimpleCalendarView() {
    const [settings, setSettings] = useState(null)

    useEffect(() => {
        (async () => {
            const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
            const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
            const configNoteId = (await api.getNote(settingsNoteId)).getRelationValue("configNote")
            setSettings(await loadSettings(schemaNoteId, configNoteId))
        })()
    }, [])

    if (!settings) return <div><LoadingSpinner /> Loading...</div>

    const eventsUrl = settings.mode === "url" ? settings.feedUrl : "custom/simpleCalendarFeed"

    return <CalendarWidget eventsUrl={eventsUrl} />
}
