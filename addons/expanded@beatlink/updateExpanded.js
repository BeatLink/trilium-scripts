// Runs on every attribute change in the tree, via the inheritable hooks setupRoot.js puts on root.
// Its only job is keeping the runOnBranchChange relation in step with the checkbox, so that only
// flagged notes ever trigger expandBranches.js.

const { loadConfig } = require("expandedConfig.js")

function updateExpanded() {
    const attribute = api.originEntity
    if (!attribute || attribute.type !== "label") return

    const { labelName } = loadConfig()
    if (attribute.name !== labelName) return

    const expandScriptNoteId = api.currentNote.getRelationValue("expandScript")
    const note = api.getNote(attribute.noteId)
    if (!note || !expandScriptNoteId) return

    // An unticked box keeps the label with the value "false", so only "true" counts as flagged.
    if (attribute.value === "true") {
        note.setRelation("runOnBranchChange", expandScriptNoteId)
        api.getNote(expandScriptNoteId).executeScript()
    } else {
        while (note.hasOwnedRelation("runOnBranchChange", expandScriptNoteId)) {
            note.removeRelation("runOnBranchChange", expandScriptNoteId)
        }
    }
}
updateExpanded()
