import {
    defineWidget,
    RightPanelWidget,
    useActiveNoteContext,
    useNoteLabel,
    useState,
    useEffect
} from "trilium:preact"
import { RecurrencePicker } from "RecurrencePicker.jsx"
import { loadSettings } from "libSettingsUI.jsx"

// Recurrence only makes sense relative to a start date — hide the picker
// until the configured date label is actually set on this note.
function RecurrenceGate({ note, dateLabel, recurrenceLabel }) {
    const [dateValue] = useNoteLabel(note, dateLabel)
    if (!dateValue) return null

    return (
        <RightPanelWidget id="x-recurrence-picker" title="Recurrence">
            <RecurrencePicker
                constants={{ RECURRENCE_LABEL: recurrenceLabel }}
                onAfterChange={() => {}}
            />
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 4,
    render() {
        const { note } = useActiveNoteContext()
        const [labels, setLabels] = useState(null)

        // Label names are an addon-wide setting, not per-note — load once.
        useEffect(() => {
            (async () => {
                const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
                const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
                const configNoteId = await api.runOnBackend((settingsNoteId) => {
                    return api.getNote(settingsNoteId).getRelationValue("AddonData:config")
                }, [settingsNoteId])
                const { dateLabel, recurrenceLabel } = await loadSettings(schemaNoteId, configNoteId)
                setLabels({ dateLabel, recurrenceLabel })
            })()
        }, [])

        if (!labels || !note) return null

        return (
            <RecurrenceGate
                note={note}
                dateLabel={labels.dateLabel}
                recurrenceLabel={labels.recurrenceLabel}
            />
        )
    }
})
