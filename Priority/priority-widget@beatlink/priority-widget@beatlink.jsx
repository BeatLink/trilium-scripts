// Constants ------------------------------------------------------------------------------
const profileNoteRelation = "AddonData:profile"

// Imports -------------------------------------------------------------------------------
import { defineWidget, useActiveNoteContext, useNoteProperty, RightPanelWidget, FormDropdownList, useEffect, useState } from "trilium:preact"
import { getActiveContextNote, currentNote, log } from "trilium:api"

// Widget ---------------------------------------------------------------------------------
export default defineWidget({
    parent: "right-pane",
    position: 3,
    render() {

        // State Variables
        const [visible, setVisible] = useState(false)
        const [existingOptions, setExistingOptions] = useState([{ key: "none", name: "No Priorities" }])
        const [label, setLabel] = useState("")
        const [value, setValue] = useState("none")
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")

        // Load Data
        useEffect(() => {
            (async () => {
                if (!note) { return }
                let profileNote = await currentNote.getRelationTarget(profileNoteRelation)
                let database = JSON.parse(await profileNote.getContent())
                let profile = database.profiles[database.selected]
                setLabel(profile.label)
                setVisible(note.hasLabel(`label:${profile.label}`))
                setExistingOptions(
                    Object.entries(profile.options)
                    .map(([key, name]) => ({ key: key, name: name }))
                    .concat({ key: "none", name: "None" })
                )
                setValue(
                    (await getActiveContextNote())
                        .getLabelValue(profile.label) ?? "none"
                )
            })()
        }, [noteId])

        // Save Data
        const saveValue = (value) => {
            api.runOnBackend((noteId, label, value) => {
                if (value !== "none") {
                    api.getNote(noteId).setLabel(label, value)
                } else {
                    api.getNote(noteId).removeLabel(label)
                }
            }, [noteId, label, value])
            setValue(value)
        }

        // Set Visibility
        if (!visible) { return null }

        // Widget
        return (
            <RightPanelWidget id="x-priority-picker" title="Priority">
                <div id="x-priority-picker-widget">
                    <FormDropdownList
                        values={existingOptions}
                        currentValue={value}
                        onChange={value => { saveValue(value) }}
                        keyProperty="key" titleProperty="name"
                    />
                </div>
            </RightPanelWidget>
        )
    }
})
