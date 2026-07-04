import { defineLauncherWidget, useActiveNoteContext, useEffect, useState } from "trilium:preact";

const { addTaskToAgendaNow, launchAgendaNow } = require("libAgendaNow.js")

function LaunchBarWidget() {
    const { note } = useActiveNoteContext();
    const [ids, setIds] = useState(null)

    useEffect(() => {
        (async () => {
            const nowNoteId = await api.currentNote.getRelationValue("nowNote")
            const configNoteId = await api.currentNote.getRelationValue("agendaNowConfig")
            setIds({ nowNoteId, configNoteId })
        })()
    }, [])

    async function handleLaunch() {
        const config = JSON.parse(await (await api.getNote(ids.configNoteId)).getContent())
        await launchAgendaNow(ids.nowNoteId, config.newWindowConfig)
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
                    bxs-star-half
                "
                onClick={handleLaunch}
                />
        </div>
    )
}

export default defineLauncherWidget({
    render: LaunchBarWidget
});
