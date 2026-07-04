import {
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    RightPanelWidget,
    Button,
    useState,
    useEffect
} from "trilium:preact"
import { currentNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

// Self-contained: runOnBackend closures can't reference outer imports, only `api`
// and their own passed args, so the compute walk is duplicated here (and again in
// settings.jsx / TableCalculator.js) rather than shared.
async function recalculateProfile(profile) {
    await api.runOnBackend((profile) => {
        const regexPattern = /[^0-9.-]+/g

        function computeSum(node, attribute, formatter) {
            if (!node.hasChildren()) {
                let value = node.getLabelValue(attribute)
                value = parseFloat(value ? value.replace(regexPattern, '') : 0)
                let formattedValue = formatter.format(value)
                node.setLabel(attribute, formattedValue)
                return value
            } else {
                let children = node.getChildNotes()
                let total = children.reduce((sum, child) => sum + computeSum(child, attribute, formatter), 0)
                let formattedTotal = formatter.format(total)
                node.setLabel(attribute, formattedTotal)
                return total
            }
        }

        const formatter = new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: profile.currency || "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })
        computeSum(api.getNote(profile.tableNoteId), profile.attribute, formatter)
    }, [profile])
}

// Only shows itself when the note being viewed matches a configured profile's
// tableNoteId — otherwise renders nothing.
export default defineWidget({
    parent: "right-pane",
    position: 60,
    render() {
        const { note } = useActiveNoteContext()
        const activeNoteId = useNoteProperty(note, "noteId")
        const [profile, setProfile] = useState(null)
        const [status, setStatus] = useState(null)

        useEffect(() => {
            (async () => {
                if (!activeNoteId) { setProfile(null); return }

                const schemaNoteId = await currentNote.getRelationValue("schemaNote")
                const settingsNote = await currentNote.getRelationTarget("settingsNote")
                const configNote = await settingsNote.getRelationTarget("AddonData:config")

                const settings = await loadSettings(schemaNoteId, configNote.noteId)
                const match = (settings.profiles || []).find(p => p.tableNoteId === activeNoteId)
                setProfile(match || null)
            })()
        }, [activeNoteId])

        async function recalc() {
            await recalculateProfile(profile)
            setStatus("done")
            setTimeout(() => setStatus(null), 2000)
        }

        if (!profile) return null

        return (
            <RightPanelWidget id="table-calculator-widget" title="Table Calculator">
                <Button
                    icon={status === "done" ? "bx-check" : "bx-calculator"}
                    text={status === "done" ? "Recalculated!" : "Recalculate"}
                    onClick={recalc}
                />
            </RightPanelWidget>
        )
    }
})
