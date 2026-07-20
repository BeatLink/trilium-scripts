/*
    This is a custom widget that allows you to set the priority of a note.
    Add this to a JS Frontend file and set label of #widget.
    Set a #priorityLabel= label for the label to store the priority of each note
*/

import { defineWidget, useActiveNoteContext, useNoteProperty, RightPanelWidget, FormGroup, FormDropdownList, useEffect, useState } from "trilium:preact"
import { searchForNotes, getActiveContextNote, currentNote, log } from "trilium:api"
import { loadSettings, resolveConfigNotes } from "libSettingsUI.jsx"

const NONE_OPTION = { label: "none", title: "None" }

export default defineWidget({
    parent: "right-pane",
    position: 2,
    render() {
        let defaultDropdownOption = [{ noteId: "none", name: "No Area Found" }]
        const [visible, setVisible] = useState(false)
        const [existingAreas, setExistingAreas] = useState(defaultDropdownOption)
        const [areaColors, setAreaColors] = useState({})
        const [dropdownValue, setDropdownValue] = useState("none")
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        useEffect(() => {
            (async () => {
                const { schemaNoteId, configNoteId } = await resolveConfigNotes(currentNote)
                const { areas } = await loadSettings(schemaNoteId, configNoteId)

                setVisible(
                    (await getActiveContextNote())
                        .getLabelValue("label:area") ? true : false
                )

                const currentArea = (await getActiveContextNote()).getLabelValue("area") ?? "none"
                // The note's #area label can point at a key that no longer exists
                // (the area was renamed/removed from settings since it was set) —
                // surface that as its own dropdown option instead of silently
                // coercing to "None", which would hide that the note's data is
                // stale rather than actually unset.
                const isInvalid = currentArea !== "none" && !areas.some(area => area.key === currentArea)

                setExistingAreas([
                    NONE_OPTION,
                    ...areas.map(area => ({ label: area.key, title: area.title })),
                    ...(isInvalid ? [{ label: currentArea, title: `⚠ Invalid: ${currentArea}` }] : [])
                ])
                setAreaColors(Object.fromEntries(areas.map(area => [area.key, area.color])))
                setDropdownValue(currentArea)
            })()
        }, [noteId])
        const saveArea = (area, color) => {
            api.runOnBackend((noteId, area, color) => {
                if (area != "none") {
                    api.getNote(noteId).setLabel("area", area)
                    if (color) {
                        api.getNote(noteId).setLabel("color", color)
                    } else {
                        api.getNote(noteId).removeLabel("color")
                    }
                } else {
                    api.getNote(noteId).removeLabel("area")
                    api.getNote(noteId).removeLabel("color")
                }
            }, [note.noteId, area, color])
            setDropdownValue(area)
        }
        return (
            <>
                {
                    visible &&
                    <RightPanelWidget id="x-area-picker" title="Area">
                        <div id="x-area-picker-widget">
                            <FormDropdownList
                                class="dropdown-component form-control"
                                values={existingAreas}
                                currentValue={dropdownValue}
                                onChange={value => { saveArea(value, areaColors[value]) }}
                                keyProperty="label" titleProperty="title"
                            />
                        </div>
                    </RightPanelWidget>
                }
            </>
        )
    }
})
