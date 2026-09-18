import { defineWidget, useActiveNoteContext, useNoteProperty, useTriliumEvent, RightPanelWidget, ActionButton, FormGroup, FormDropdownList, useEffect, useState } from "trilium:preact"
import { searchForNotes, getActiveContextNote, getNotes, currentNote, activateNote } from "trilium:api"
import { getAreas, assignArea, areaKeyOf } from "areaRegistry.jsx"
import { getExcludeFilters, getExcludedNoteIds } from "pickerRegistry.jsx"
import { resolveConfigNotes } from "libSettingsUI.jsx"
import { useSelectedNoteIds } from "treeSelection.jsx"

const NONE_OPTION = { key: "none", title: "None" }
const MIXED_OPTION = { key: "mixed", title: "— Mixed —" }

export default defineWidget({
    parent: "right-pane",
    position: 2,
    render() {
        const [visible, setVisible] = useState(false)
        const [existingAreas, setExistingAreas] = useState([NONE_OPTION])
        const [areasByKey, setAreasByKey] = useState({})
        const [dropdownValue, setDropdownValue] = useState("none")
        const [targets, setTargets] = useState([])
        const [reload, setReload] = useState(0)
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        const selectedNoteIds = useSelectedNoteIds()
        // The settings page is a render note; activating the settings code note
        // itself would open its source instead of the rendered form.
        const settingsPageNoteId = currentNote.getRelationValue("settingsPageNote")
        // #label:area and #area can be owned by the note, by its template, or by an
        // inheritable ancestor label, so reload on any attribute change reaching this note.
        useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
            if (!note) return
            const owners = [note, ...note.getNotesToInheritAttributesFrom()].filter(Boolean)
            const affects = attr => owners.some(owner => owner.noteId === attr.noteId)
                || (attr.isInheritable && owners.some(owner => owner.hasAncestor(attr.noteId, true)))
            if (loadResults.getAttributeRows().some(affects)) setReload(count => count + 1)
        })
        useEffect(() => {
            (async () => {
                const { schemaNoteId, configNoteId } = await resolveConfigNotes(currentNote)

                setVisible(
                    (await getActiveContextNote())
                        .getLabelValue("label:area") ? true : false
                )

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

                const areas = await getAreas(schemaNoteId, configNoteId)
                const options = areas.filter(a => a.enabled).map(a => ({ key: a.key, title: a.title }))

                setAreasByKey(Object.fromEntries(areas.map(a => [a.key, a])))

                // The stored value carries the area's order prefix; the dropdown
                // is keyed by the area key behind it.
                const assigned = new Set((await getNotes(noteIds, true))
                    .map(n => areaKeyOf(n.getLabelValue("area")) || "none"))
                // Targets that disagree get their own option rather than one
                // note's answer standing in for the whole selection.
                const currentArea = assigned.size > 1 ? "mixed" : ([...assigned][0] ?? "none")
                // The note's #area label can point at a key that no longer exists
                // (the area was renamed/removed/disabled since it was set) —
                // surface that as its own dropdown option instead of silently
                // coercing to "None", which would hide that the note's data is
                // stale rather than actually unset.
                const isInvalid = currentArea !== "none" && currentArea !== "mixed"
                    && !options.some(a => a.key === currentArea)

                setExistingAreas([
                    NONE_OPTION,
                    ...options,
                    ...(isInvalid ? [{ key: currentArea, title: `⚠ Invalid: ${currentArea}` }] : []),
                    ...(currentArea === "mixed" ? [MIXED_OPTION] : [])
                ])
                setDropdownValue(currentArea)
            })()
        }, [noteId, selectedNoteIds, reload])

        if (!targets.length) return null

        const saveArea = async (key) => {
            if (key === "mixed") return
            const area = areasByKey[key]
            await assignArea(targets, area ? area.label : key, area?.color)
            setDropdownValue(key)
            setExistingAreas(list => list.filter(a => a.key !== "mixed"))
        }
        const title = selectedNoteIds.length
            ? `Area (${targets.length} note${targets.length === 1 ? "" : "s"})`
            : "Area"
        return (
            <>
                {
                    visible &&
                    <RightPanelWidget
                        id="x-area-picker"
                        title={title}
                        buttons={settingsPageNoteId && (
                            <ActionButton
                                icon="bx bx-cog"
                                text="Area Picker settings"
                                onClick={() => activateNote(settingsPageNoteId)}
                            />
                        )}
                    >
                        <div id="x-area-picker-widget">
                            <FormDropdownList
                                class="dropdown-component form-control"
                                values={existingAreas}
                                currentValue={dropdownValue}
                                onChange={value => { saveArea(value) }}
                                keyProperty="key" titleProperty="title"
                            />
                        </div>
                    </RightPanelWidget>
                }
            </>
        )
    }
})
