import { SettingsPage } from "libSettingsUI.jsx"

export default function BlockUrlSettings() {
    // `api.currentNote` must be read here, in this addon's own module — inside
    // libsettings it resolves to the library's note instead.
    return <SettingsPage note={api.currentNote} />
}
