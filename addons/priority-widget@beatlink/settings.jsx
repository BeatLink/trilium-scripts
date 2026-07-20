import { SettingsPage } from "libSettingsUI.jsx"

// `note` must be passed from this module — inside libsettings, `api.currentNote`
// is the library's own note, not this settings note.
export default function PriorityPickerSettings() {
    return <SettingsPage note={api.currentNote} />
}
