import { SettingsPage } from "libSettingsUI.jsx"
import { RescheduleOptionsPanel } from "rescheduleOptions.jsx"

// This addon's settings page, shown via TAM's "Addon Settings" button and the
// only place its config is edited. taskSchema.json already declares the label
// fields with category/tab "Settings"; rescheduleOptions is schema-hidden and
// rendered here via the rich panel instead of a raw rrule text box.
export default function TaskSettings() {
    return (
        <SettingsPage
            note={api.currentNote}
            extraPanels={[{
                category: "Settings",
                tab: "Reschedule Options",
                render: () => <RescheduleOptionsPanel />
            }]}
        />
    )
}
