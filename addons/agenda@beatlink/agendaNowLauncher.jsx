import { defineLauncherWidget, useActiveNoteContext, useEffect, useState } from "trilium:preact";
import { startNote } from "trilium:api"
import { getAgendaSettings } from "agendaSettings.jsx"

const { addTaskToAgendaNow, launchAgendaNow } = require("libAgendaNow.js")

function LaunchBarWidget() {
    const { note } = useActiveNoteContext();
    const [ids, setIds] = useState(null)

    useEffect(() => {
        (async () => {
            const { agendaNow } = await getAgendaSettings()
            const nowNoteId = await startNote.getRelationValue("nowNote")
            setIds({ nowNoteId, windowConfig: agendaNow.windowConfig })
        })()
    }, [])

    async function handleLaunch() {
        await launchAgendaNow(ids.nowNoteId, ids.windowConfig)
    }

    if (!ids) return null

    return (
        <div>
            <button
                title="Add To AgendaNow"
                className="
                    launcher-button
                    bx bx-add-to-queue
                "
                onClick={e => {
                    addTaskToAgendaNow(ids.nowNoteId, note.noteId, false)
                }}
            />
            <button
                title="Launch Agenda Now"
                className="
                    launcher-button
                    bx bxs-star-half
                "
                onClick={handleLaunch}
                />
        </div>
    )
}

export default defineLauncherWidget({
    render: LaunchBarWidget
});
