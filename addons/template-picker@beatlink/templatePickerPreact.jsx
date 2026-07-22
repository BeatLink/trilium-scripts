import { defineWidget, useActiveNoteContext, useNoteProperty, RightPanelWidget, FormGroup, FormDropdownList, useEffect, useState } from "trilium:preact"
import { searchForNotes, getActiveContextNote, currentNote } from "trilium:api"
import { getTemplates, assignTemplate, isExcludedFromPicker } from "templateRegistry.jsx"
import { resolveConfigNotes } from "libSettingsUI.jsx"

const NONE_OPTION = { noteId: "none", title: "None" }

export default defineWidget({
    parent: "right-pane",
    position: 1,
    render() {
        const [existingTemplates, setExistingTemplates] = useState([NONE_OPTION])
        const [templatesById, setTemplatesById] = useState({})
        const [dropdownValue, setDropdownValue] = useState("none")
        const [excluded, setExcluded] = useState(false)
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        useEffect(() => {
            (async () => {
                const { schemaNoteId, configNoteId } = await resolveConfigNotes(currentNote)

                if (await isExcludedFromPicker(schemaNoteId, configNoteId, noteId)) {
                    setExcluded(true)
                    return
                }
                setExcluded(false)

                const templates = await getTemplates(schemaNoteId, configNoteId)

                // An install that has never been scanned has an empty registry —
                // fall back to every #template note so the picker still works out
                // of the box, rather than showing nothing until the user finds the
                // settings page.
                const options = templates.length
                    ? templates.filter(t => t.enabled).map(t => ({ noteId: t.noteId, title: t.name }))
                    : (await searchForNotes("#template orderBy note.title"))
                        .map(n => ({ noteId: n.noteId, title: n.title }))

                setTemplatesById(Object.fromEntries(templates.map(t => [t.noteId, t])))

                const currentTemplate = (await getActiveContextNote())
                    .getRelationValue("template") ?? "none"
                // The note's ~template relation can point at a template that is
                // disabled or missing from the registry — surface that as its own
                // option instead of silently showing "None", which would misreport
                // the note as having no template at all.
                const isUnlisted = currentTemplate !== "none"
                    && !options.some(o => o.noteId === currentTemplate)

                setExistingTemplates([
                    NONE_OPTION,
                    ...options,
                    ...(isUnlisted ? [{ noteId: currentTemplate, title: "⚠ Not listed" }] : [])
                ])
                setDropdownValue(currentTemplate)
            })()
        }, [noteId])

        if (excluded) return null

        const saveTemplate = async (template) => {
            await assignTemplate(note.noteId, template, templatesById[template]?.color)
            setDropdownValue(template)
        }
        return (
            <RightPanelWidget id="x-template-picker" title="Template">
                <div id="x-template-picker-widget">
                    <FormDropdownList
                        class="dropdown-component form-control"
                        values={existingTemplates}
                        currentValue={dropdownValue}
                        onChange={value => { saveTemplate(value) }}
                        keyProperty="noteId" titleProperty="title"
                    />
                </div>
            </RightPanelWidget>
        )
    }
})
