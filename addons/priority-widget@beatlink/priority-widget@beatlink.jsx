/*
    This is a custom widget that allows you to set the priority of a note.
    The widget only appears on notes declaring #label:<name>, where <name> is
    the configured Label Name (default: priority).
*/

import { defineWidget, useActiveNoteContext, useNoteProperty, RightPanelWidget, FormDropdownList, useEffect, useState } from "trilium:preact"
import { getActiveContextNote, currentNote } from "trilium:api"
import { loadSettings, resolveConfigNotes } from "libSettingsUI.jsx"

const NONE_OPTION = { key: "none", title: "None" }

export default defineWidget({
    parent: "right-pane",
    position: 3,
    render() {
        const [visible, setVisible] = useState(false)
        const [existingPriorities, setExistingPriorities] = useState([NONE_OPTION])
        const [priorityColors, setPriorityColors] = useState({})
        const [label, setLabel] = useState("priority")
        const [dropdownValue, setDropdownValue] = useState("none")
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        useEffect(() => {
            (async () => {
                const { schemaNoteId, configNoteId } = await resolveConfigNotes(currentNote)
                const { selected, profiles } = await loadSettings(schemaNoteId, configNoteId)
                // A `selected` pointing at a deleted profile would otherwise throw
                // on destructure; fall back to the first profile so the picker
                // still works rather than disappearing with no explanation.
                const profile = profiles[selected] ?? Object.values(profiles)[0]
                if (!profile) { return }
                const { label, priorities } = profile

                setLabel(label)
                setVisible(
                    (await getActiveContextNote())
                        .getLabelValue(`label:${label}`) ? true : false
                )

                const currentPriority = (await getActiveContextNote()).getLabelValue(label) ?? "none"
                // The note's label can point at a key that no longer exists (the
                // priority was renamed/removed from settings since it was set) —
                // surface that as its own dropdown option instead of silently
                // coercing to "None", which would hide that the note's data is
                // stale rather than actually unset.
                const isInvalid = currentPriority !== "none"
                    && !priorities.some(priority => priority.key === currentPriority)

                setExistingPriorities([
                    NONE_OPTION,
                    ...priorities.map(priority => ({ key: priority.key, title: priority.title })),
                    ...(isInvalid ? [{ key: currentPriority, title: `⚠ Invalid: ${currentPriority}` }] : [])
                ])
                setPriorityColors(Object.fromEntries(priorities.map(priority => [priority.key, priority.color])))
                setDropdownValue(currentPriority)
            })()
        }, [noteId])
        const savePriority = (priority, color) => {
            api.runOnBackend((noteId, label, priority, color) => {
                if (priority != "none") {
                    api.getNote(noteId).setLabel(label, priority)
                    if (color) {
                        api.getNote(noteId).setLabel("color", color)
                    } else {
                        api.getNote(noteId).removeLabel("color")
                    }
                } else {
                    api.getNote(noteId).removeLabel(label)
                    api.getNote(noteId).removeLabel("color")
                }
            }, [note.noteId, label, priority, color])
            setDropdownValue(priority)
        }
        return (
            <>
                {
                    visible &&
                    <RightPanelWidget id="x-priority-picker" title="Priority">
                        <div id="x-priority-picker-widget">
                            <FormDropdownList
                                class="dropdown-component form-control"
                                values={existingPriorities}
                                currentValue={dropdownValue}
                                onChange={value => { savePriority(value, priorityColors[value]) }}
                                keyProperty="key" titleProperty="title"
                            />
                        </div>
                    </RightPanelWidget>
                }
            </>
        )
    }
})
