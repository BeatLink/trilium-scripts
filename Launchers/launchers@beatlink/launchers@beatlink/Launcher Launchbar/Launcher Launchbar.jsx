import { render } from "trilium:preact"

const { LauncherButtons } = require("LauncherButtonsjsx")

const CONFIG_RELATION = "AddonData:config"

class LauncherLaunchbarWidget extends api.NoteContextAwareWidget {
    get parentWidget() { return "left-pane" }
    get position() { return 100 }

    doRender() {
        this.$widget = $('<div style="display:contents"></div>')
        return this.$widget
    }

    async refreshWithNote(note) {
        if (!this._configNote) {
            this._configNote = await api.currentNote.getRelationTarget(CONFIG_RELATION)
        }
        render(
            <LauncherButtons configNote={this._configNote} noteId={note?.noteId} variant="launchbar" />,
            this.$widget[0]
        )
    }
}

module.exports = new LauncherLaunchbarWidget()
