import { defineWidget, useActiveNoteContext, useNoteProperty, RightPanelWidget, ActionButton, FormGroup, FormDropdownList, useEffect, useState } from "trilium:preact"
import { searchForNotes, getNotes, currentNote, activateNote } from "trilium:api"
import { getTemplates, assignTemplate } from "templateRegistry.jsx"
import { getExcludeFilters, getExcludedNoteIds } from "pickerRegistry.jsx"
import { resolveConfigNotes } from "libSettingsUI.jsx"
import { useSelectedNoteIds } from "treeSelection.jsx"

const NONE_OPTION = { noteId: "none", title: "None" }
const MIXED_OPTION = { noteId: "mixed", title: "— Mixed —" }

export default defineWidget({
    parent: "right-pane",
    position: 1,
    render() {
        const [existingTemplates, setExistingTemplates] = useState([NONE_OPTION])
        const [templatesById, setTemplatesById] = useState({})
        const [dropdownValue, setDropdownValue] = useState("none")
        const [targets, setTargets] = useState([])
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        const selectedNoteIds = useSelectedNoteIds()
        // The settings page is a render note; activating the settings code note
        // itself would open its source instead of the rendered form.
        const settingsPageNoteId = currentNote.getRelationValue("settingsPageNote")
        useEffect(() => {
            (async () => {
                const { schemaNoteId, configNoteId } = await resolveConfigNotes(currentNote)

                // A tree selection retargets the picker at every selected note,
                // matching how Trilium's own bulk actions treat it; with nothing
                // selected the picker stays on the active note.
                const candidates = selectedNoteIds.length ? selectedNoteIds : (noteId ? [noteId] : [])
                const filters = await getExcludeFilters(schemaNoteId, configNoteId)
                const excludedIds = filters.length ? await getExcludedNoteIds(filters) : []
                const excluded = new Set(excludedIds)
                const noteIds = candidates.filter(id => !excluded.has(id))

                setTargets(noteIds)
                if (!noteIds.length) return

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

                const assigned = new Set((await getNotes(noteIds, true))
                    .map(n => n.getRelationValue("template") || "none"))
                // Targets that disagree get their own option rather than one
                // note's answer standing in for the whole selection.
                const currentTemplate = assigned.size > 1 ? "mixed" : ([...assigned][0] ?? "none")
                // The note's ~template relation can point at a template that is
                // disabled or missing from the registry — surface that as its own
                // option instead of silently showing "None", which would misreport
                // the note as having no template at all.
                const isUnlisted = currentTemplate !== "none" && currentTemplate !== "mixed"
                    && !options.some(o => o.noteId === currentTemplate)

                setExistingTemplates([
                    NONE_OPTION,
                    ...options,
                    ...(isUnlisted ? [{ noteId: currentTemplate, title: "⚠ Not listed" }] : []),
                    ...(currentTemplate === "mixed" ? [MIXED_OPTION] : [])
                ])
                setDropdownValue(currentTemplate)
            })()
        }, [noteId, selectedNoteIds])

        if (!targets.length) return null

        const saveTemplate = async (template) => {
            if (template === "mixed") return
            await assignTemplate(targets, template, templatesById[template]?.color)
            setDropdownValue(template)
            setExistingTemplates(existingTemplates.filter(t => t.noteId !== "mixed"))
        }
        const title = selectedNoteIds.length
            ? `Template (${targets.length} note${targets.length === 1 ? "" : "s"})`
            : "Template"
        return (
            <RightPanelWidget
                id="x-template-picker"
                title={title}
                buttons={settingsPageNoteId && (
                    <ActionButton
                        icon="bx bx-cog"
                        text="Template Picker settings"
                        onClick={() => activateNote(settingsPageNoteId)}
                    />
                )}
            >
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
