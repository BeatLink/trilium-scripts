import { useState, useEffect, Button } from "trilium:preact"
import { SettingsForm, loadSettings } from "libSettingsUI.jsx"

// Self-contained: runOnBackend closures can't reference outer imports, only `api`
// and their own passed args, so the compute walk is duplicated here (and again in
// table-widget.jsx) rather than shared with TableCalculator.js.
async function recalculateProfiles(profiles) {
    await api.runOnBackend((profiles) => {
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

        for (const profile of profiles) {
            if (!(profile.tableNoteId && profile.attribute)) continue
            const formatter = new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: profile.currency || "USD",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })
            computeSum(api.getNote(profile.tableNoteId), profile.attribute, formatter)
        }
    }, [profiles])
}

export default function TableCalculatorSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [recalcStatus, setRecalcStatus] = useState(null)

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("AddonData:config")
            setConfigNoteId(target.noteId)
        })()
    }, [])

    async function recalculateAll() {
        const settings = await loadSettings(schemaNoteId, configNoteId)
        await recalculateProfiles(settings.profiles || [])
        setRecalcStatus("done")
        setTimeout(() => setRecalcStatus(null), 2000)
    }

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    return (
        <>
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
            <Button
                icon={recalcStatus === "done" ? "bx-check" : "bx-calculator"}
                text={recalcStatus === "done" ? "Recalculated!" : "Recalculate All"}
                onClick={recalculateAll}
            />
        </>
    )
}
