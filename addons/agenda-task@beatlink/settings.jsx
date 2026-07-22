import { SettingsPage } from "libSettingsUI.jsx"
import { RescheduleOptionsPanel } from "rescheduleOptions.jsx"

// Standalone settings page for this addon, shown via TAM's "Addon Settings"
// button when installed without agenda@beatlink (whose Agenda Editor embeds
// these same panels instead). taskSchema.json already declares the label
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
