import { defineWidget, useActiveNoteContext, useNoteProperty, useTriliumEvent, RightPanelWidget, ActionButton, FormGroup, FormDropdownList, useEffect, useState } from "trilium:preact"
import { searchForNotes, getActiveContextNote, currentNote, activateNote } from "trilium:api"
import { getAreas, assignArea } from "areaRegistry.jsx"
import { isExcludedFromPicker } from "pickerRegistry.jsx"
import { resolveConfigNotes } from "libSettingsUI.jsx"

const NONE_OPTION = { key: "none", title: "None" }

export default defineWidget({
    parent: "right-pane",
    position: 2,
    render() {
        const [visible, setVisible] = useState(false)
        const [existingAreas, setExistingAreas] = useState([NONE_OPTION])
        const [areasByKey, setAreasByKey] = useState({})
        const [dropdownValue, setDropdownValue] = useState("none")
        const [excluded, setExcluded] = useState(false)
        const [reload, setReload] = useState(0)
        // The settings page is a render note; activating the settings code note
        // itself would open its source instead of the rendered form.
        const settingsPageNoteId = currentNote.getRelationValue("settingsPageNote")
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
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

                if (await isExcludedFromPicker(schemaNoteId, configNoteId, noteId)) {
                    setExcluded(true)
                    return
                }
                setExcluded(false)

                const areas = await getAreas(schemaNoteId, configNoteId)
                const options = areas.filter(a => a.enabled).map(a => ({ key: a.key, title: a.title }))

                setAreasByKey(Object.fromEntries(areas.map(a => [a.key, a])))

                const currentArea = (await getActiveContextNote()).getLabelValue("area") ?? "none"
                // The note's #area label can point at a key that no longer exists
                // (the area was renamed/removed/disabled since it was set) —
                // surface that as its own dropdown option instead of silently
                // coercing to "None", which would hide that the note's data is
                // stale rather than actually unset.
                const isInvalid = currentArea !== "none" && !options.some(a => a.key === currentArea)

                setExistingAreas([
                    NONE_OPTION,
                    ...options,
                    ...(isInvalid ? [{ key: currentArea, title: `⚠ Invalid: ${currentArea}` }] : [])
                ])
                setDropdownValue(currentArea)
            })()
        }, [noteId, reload])

        if (excluded) return null

        const saveArea = (key) => {
            assignArea(note.noteId, key, areasByKey[key]?.color)
            setDropdownValue(key)
        }
        return (
            <>
                {
                    visible &&
                    <RightPanelWidget
                        id="x-area-picker"
                        title="Area"
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
