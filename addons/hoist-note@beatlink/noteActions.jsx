import {
    RightPanelWidget,
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    Button
} from "trilium:preact";

function NoteActionsWidget(){
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");

    const actions = [
        {
            key: "zen",
            icon: "bx bx-expand",
            text: "Zen Mode",
            onClick: () => api.triggerCommand("toggleZenMode")
        },
        {
            key: "hoist",
            icon: "bx bx-move-vertical",
            text: "Hoist Note",
            onClick: () => {
                api.setHoistedNoteId(
                    api.getActiveContext().hoistedNoteId === noteId ? "root" : noteId
                )
            }
        }
    ]

    return (
        <RightPanelWidget title="Note Actions">
            <div className="hoist-note-actions">
                {actions.map(({ key, icon, text, onClick }) => (
                    <Button key={key} icon={icon} text={text} onClick={onClick} />
                ))}
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 5,
    render: NoteActionsWidget
})
