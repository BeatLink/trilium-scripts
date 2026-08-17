import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

const { getMyDayConfigIds } = require("myDaySettings.js")

export default function MyDayEditor() {
    const [ids, setIds] = useState(undefined)

    useEffect(() => {
        (async () => setIds(await getMyDayConfigIds()))()
    }, [])

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) return <div>My Day's configuration isn't discoverable.</div>

    return (
        <div className="profile-editor">
            <h2>My Day Editor</h2>
            <p>
                Set My Day Note to the note that collects today's tasks; the panel only appears while
                that note is active, so nothing shows until it's set. Task Search decides which notes
                can be suggested, and Add Tasks When Due / Send Due Notifications poll that same
                search for tasks whose start time has arrived.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
            />
        </div>
    )
}
