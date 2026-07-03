import {
    defineWidget,
    useActiveNoteContext,
    useNoteProperty,
    RightPanelWidget,
    useEffect,
    useState
} from "trilium:preact"
import { currentNote } from "trilium:api"

const { LauncherButtons } = require("LauncherButtonsjsx")

const CONFIG_RELATION = "AddonData:config"

export default defineWidget({
    parent: "right-pane",
    position: 100,
    render() {
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        const [configNote, setConfigNote] = useState(null)

        useEffect(async () => {
            setConfigNote(await currentNote.getRelationTarget(CONFIG_RELATION))
        }, [])

        if (!configNote) return null

        return (
            <RightPanelWidget id="x-launchers-widget" title="Launchers">
                <LauncherButtons configNote={configNote} noteId={noteId} variant="right-pane" />
            </RightPanelWidget>
        )
    }
})
