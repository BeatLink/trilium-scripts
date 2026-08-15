// Run on backend startup: defines the promoted checkbox for the whole tree by putting the label
// definition on the root note as inheritable, along with the attribute hooks that fire
// updateExpanded.js whenever any note's attributes change.

const { loadConfig } = require("expandedConfig.js")

// Records which label name the definition on root was written for, so renaming it in settings can
// take the old definition down instead of leaving a second checkbox on every note.
const APPLIED_LABEL = "expandedAppliedLabel"

function setInheritableRootAttribute(root, type, name, value) {
    const existing = root.getOwnedAttributes(type, name)[0]
    if (!existing) {
        root.addAttribute(type, name, value, true)
    } else if (existing.value !== value || !existing.isInheritable) {
        existing.value = value
        existing.isInheritable = true
        existing.save()
    }
}

function setupRoot() {
    const { labelName, definition } = loadConfig()
    const root = api.getNote("root")
    const updateExpandedNoteId = api.currentNote.getRelationValue("attributeScript")

    const applied = root.getOwnedLabelValue(APPLIED_LABEL)
    if (applied && applied !== labelName) {
        root.removeLabel(`label:${applied}`)
    }
    root.setLabel(APPLIED_LABEL, labelName)

    setInheritableRootAttribute(root, "label", `label:${labelName}`, definition)
    setInheritableRootAttribute(root, "relation", "runOnAttributeCreation", updateExpandedNoteId)
    setInheritableRootAttribute(root, "relation", "runOnAttributeChange", updateExpandedNoteId)
}
setupRoot()
