/*
    This is a custom widget that allows you to set the priority of a note.
    The widget only appears on notes declaring #label:<name>, where <name> is
    the configured Label Name (default: priority).
*/

import { defineWidget, useActiveNoteContext, useNoteProperty, useTriliumEvent, RightPanelWidget, FormDropdownList, useEffect, useState } from "trilium:preact"
import { getActiveContextNote, currentNote } from "trilium:api"
import { resolveConfigNotes } from "libSettingsUI.jsx"
import { getActiveProfile, assignPriority, isExcludedFromPicker } from "priorityRegistry.jsx"

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
        const [excluded, setExcluded] = useState(false)
        const [reload, setReload] = useState(0)
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        // The label definition can be owned by the note, by its template, or by an
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

                if (await isExcludedFromPicker(schemaNoteId, configNoteId, noteId)) {
                    setExcluded(true)
                    return
                }
                setExcluded(false)

                const profile = await getActiveProfile(schemaNoteId, configNoteId)
                if (!profile) { return }
                const { label, priorities } = profile

                setLabel(label)
                setVisible(
                    (await getActiveContextNote())
                        .getLabelValue(`label:${label}`) ? true : false
                )

                const options = priorities.filter(p => p.enabled).map(p => ({ key: p.key, title: p.title }))

                const currentPriority = (await getActiveContextNote()).getLabelValue(label) ?? "none"
                // The note's label can point at a key that no longer exists (the
                // priority was renamed/removed/disabled from settings since it was
                // set) — surface that as its own dropdown option instead of
                // silently coercing to "None", which would hide that the note's
                // data is stale rather than actually unset.
                const isInvalid = currentPriority !== "none"
                    && !options.some(priority => priority.key === currentPriority)

                setExistingPriorities([
                    NONE_OPTION,
                    ...options,
                    ...(isInvalid ? [{ key: currentPriority, title: `⚠ Invalid: ${currentPriority}` }] : [])
                ])
                setPriorityColors(Object.fromEntries(priorities.map(priority => [priority.key, priority.color])))
                setDropdownValue(currentPriority)
            })()
        }, [noteId, reload])

        if (excluded) return null

        const savePriority = (priority) => {
            assignPriority(note.noteId, label, priority, priorityColors[priority])
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
                                onChange={value => { savePriority(value) }}
                                keyProperty="key" titleProperty="title"
                            />
                        </div>
                    </RightPanelWidget>
                }
            </>
        )
    }
})
