import {
    Button,
    useActiveNoteContext,
    useNoteProperty,
} from "trilium:preact";

const { complete, rescheduleByDays } = require("libAgendaTask.js")
const { updateTaskLists } = require("libAgendaOverview.js")

export function ActionPicker({ constants, ids }) {
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");

    async function afterChange() {
        await updateTaskLists(ids.profileNoteIds, constants, ids.icalNoteId)
    }

    return (
        <div>
            <Button
                icon="bx bx-check"
                text="Complete Task"
                onClick={async e => {
                    await complete(noteId, constants)
                    await afterChange()
                }}
            />
            <Button
                icon="bx bx-rocket"
                text="Start Today"
                onClick={async e => {
                    await rescheduleByDays(noteId, constants, 0)
                    await afterChange()
                }}
            />
            <Button
                icon="bx bx-rocket"
                text="Start Tomorrow"
                onClick={async e => {
                    await rescheduleByDays(noteId, constants, 1)
                    await afterChange()
                }}
            />
        </div>
    )
}
