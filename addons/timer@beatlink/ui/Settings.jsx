// The timer's settings: the values the widget reads, and the page that edits
// them. The #timerConfig label and the schemaNote/configNote relations sit on
// the Timer Settings page itself, so it is both the settings anchor and the UI.

import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { SettingsForm, loadSettings } from "libSettingsUI.jsx"

const DEFAULTS = {
    enableSounds: true
}

// The settings note ids, or null when the anchor isn't discoverable.
export async function getTimerConfigIds() {
    const anchors = await api.searchForNotes("#timerConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// The stored settings, falling back to the shipped defaults when the settings
// note can't be resolved.
export async function getTimerSettings() {
    const ids = await getTimerConfigIds()
    if (!ids) return { ...DEFAULTS }
    const values = await loadSettings(ids.schemaNoteId, ids.configNoteId)
    return { ...DEFAULTS, ...values }
}

export default function TimerSettings() {
    const [ids, setIds] = useState(undefined)

    useEffect(() => {
        (async () => setIds(await getTimerConfigIds()))()
    }, [])

    if (ids === undefined) return <div><LoadingSpinner /> Loading...</div>
    if (ids === null) return <div>The timer's configuration isn't discoverable.</div>

    return (
        <div className="profile-editor">
            <h2>Timer Settings</h2>
            <p>
                Enable Timer Sounds plays a click as each duration dropdown changes, a chime as the
                timer starts, and an alarm as it runs out.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
            />
        </div>
    )
}
