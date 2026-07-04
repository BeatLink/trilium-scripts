import { defineWidget, RightPanelWidget } from "trilium:preact"
import { LauncherButtons } from "LauncherButtons.jsx"

export default defineWidget({
    parent: "right-pane",
    position: 50,
    render() {
        return (
            <RightPanelWidget id="x-launchers-widget" title="Launchers">
                <LauncherButtons variant="right-pane" />
            </RightPanelWidget>
        )
    }
})
