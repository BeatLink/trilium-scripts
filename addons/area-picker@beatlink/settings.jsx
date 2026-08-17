import { SettingsPage } from "libSettingsUI.jsx"

// `note` must be passed from this module — inside libsettings, `api.currentNote`
// is the library's own note, not this settings note. Two registry fields in
// the schema (`areas`, `excludeFilters`) render as two tabs automatically.
export default function AreaPickerSettings() {
    return <SettingsPage note={api.currentNote} />
}
