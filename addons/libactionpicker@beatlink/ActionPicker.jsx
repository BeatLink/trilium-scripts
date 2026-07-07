import {
    Button,
    useActiveNoteContext,
    useNoteProperty,
} from "trilium:preact";

const { complete, rescheduleByDays } = require("libAgendaTask.js")

export function ActionPicker({ constants, onAfterChange }) {
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");

    return (
        <div>
            <Button
                icon="bx bx-check"
                text="Complete Task"
                onClick={async e => {
                    await complete(noteId, constants)
                    await onAfterChange()
                }}
            />
            <Button
                icon="bx bx-rocket"
                text="Start Today"
                onClick={async e => {
                    await rescheduleByDays(noteId, constants, 0)
                    await onAfterChange()
                }}
            />
            <Button
                icon="bx bx-rocket"
                text="Start Tomorrow"
                onClick={async e => {
                    await rescheduleByDays(noteId, constants, 1)
                    await onAfterChange()
                }}
            />
        </div>
    )
}
