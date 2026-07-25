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
                Pick the note that shows the My Day focus controls, and choose whether the timer plays
                sounds. Add Tasks When Due and Send Due Notifications poll agenda@beatlink's active
                profile for tasks whose start time has arrived, so they need agenda installed; the
                countdown timer works either way.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
            />
        </div>
    )
}
