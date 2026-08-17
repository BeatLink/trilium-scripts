// The expand pass itself. Every flagged note carries a runOnBranchChange relation pointing here
// (updateExpanded.js puts it there), so any change to the tree re-opens all of them.

const { loadConfig } = require("expandedConfig.js")

function expandBranches() {
    const { labelName } = loadConfig()

    // An unticked box keeps the label with the value "false", so only "true" counts as flagged.
    for (const note of api.searchForNotes(`#${labelName}=true`)) {
        for (const branch of note.getParentBranches()) {
            if (!branch.isExpanded) {
                branch.isExpanded = true
                branch.save()
            }
        }
    }
}
expandBranches()
