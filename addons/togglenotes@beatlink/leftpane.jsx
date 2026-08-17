import { defineLauncherWidget, useActiveNoteContext } from "trilium:preact"
import { LauncherButtons } from "LauncherButtons.jsx"

export default defineLauncherWidget({
    render: () => {
        return <LauncherButtons variant="launchbar" />
    }
})