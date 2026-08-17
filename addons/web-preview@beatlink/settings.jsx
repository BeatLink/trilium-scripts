import { SettingsPage } from "libSettingsUI.jsx"

export default function WebPreviewSettings() {
    // `api.currentNote` must be read here — inside libsettings it resolves to the library's note.
    return <SettingsPage note={api.currentNote} />
}
