import { useState, useEffect, Button } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

/*
 * Wires ~renderNote onto budget notes that predate the provisioning hook (or
 * were templated while the addon was disabled). Self-contained: runOnBackend
 * closures can't reference outer imports, so the walk is inlined here rather
 * than calling budgetProvision.js's backfill().
 */
async function backfill(templateNoteId, widgetNoteId) {
    return await api.runOnBackend((templateNoteId, widgetNoteId) => {
        const candidates = []
        if (templateNoteId) {
            for (const rel of api.getNote(templateNoteId).getTargetRelations("template")) {
                const note = rel.getNote()
                if (note) candidates.push(note)
            }
        }
        for (const note of api.searchForNotes("#budgetTable")) candidates.push(note)

        let wired = 0
        const seen = new Set()
        for (const note of candidates) {
            if (seen.has(note.noteId) || note.isDeleted) continue
            seen.add(note.noteId)
            if (note.getRelationValue("renderNote")) continue
            note.setRelation("renderNote", widgetNoteId)
            wired++
        }
        return wired
    }, [templateNoteId, widgetNoteId])
}

export default function BudgetSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [status, setStatus] = useState(null)

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("AddonData:config")
            setConfigNoteId(target.noteId)
        })()
    }, [])

    async function wireExisting() {
        const provisionNote = await api.currentNote.getRelationTarget("provisionNote")
        const templateNoteId = await provisionNote.getRelationValue("budgetTemplateNote")
        const widgetNoteId = await provisionNote.getRelationValue("budgetWidgetNote")
        const wired = await backfill(templateNoteId, widgetNoteId)
        setStatus(`Wired ${wired} note${wired === 1 ? "" : "s"}`)
        setTimeout(() => setStatus(null), 3000)
    }

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    return (
        <>
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
            <Button
                icon={status ? "bx-check" : "bx-link"}
                text={status || "Wire Existing Budget Notes"}
                onClick={wireExisting}
            />
        </>
    )
}
