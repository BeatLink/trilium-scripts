/*
 * Wires ~renderNote onto budget notes.
 *
 * The Budget template can't carry an inheritable ~renderNote itself: Trilium
 * supports inheritable relations, but TAM's manifest applies relations with a
 * plain setRelation and only honours the "(inheritable)" suffix for labels, so a
 * template-level render relation never reaches instances.
 *
 * Instead this script runs as a global backend hook on attribute creation. When
 * a note gains the Budget template (~template pointing at our template note) or
 * carries #budgetTable directly, it gets ~renderNote -> budgetWidget.jsx if it
 * doesn't already have one.
 */

const templateNoteId = api.currentNote.getRelationValue("budgetTemplateNote")
const widgetNoteId = api.currentNote.getRelationValue("budgetWidgetNote")

function isBudgetNote(note) {
    if (note.hasLabel("budgetTable")) return true
    const template = note.getRelation("template")
    return !!template && template.value === templateNoteId
}

function provision(note) {
    if (!note || note.isDeleted) return
    if (!widgetNoteId) return
    if (!isBudgetNote(note)) return
    // Don't clobber a render target the user pointed somewhere else.
    if (note.getRelationValue("renderNote")) return
    note.setRelation("renderNote", widgetNoteId)
}

const attribute = api.originEntity

// Attribute event: only the two attributes that can make a note a budget note
// are worth a lookup. Notes templated before this hook was installed are
// backfilled by the settings screen's "Wire Existing Budget Notes" button,
// which calls backfill() below.
if (attribute && attribute.name) {
    if (attribute.name === "template" || attribute.name === "budgetTable") {
        provision(api.getNote(attribute.noteId))
    }
}

// Called from the settings screen via api.runOnBackend.
function backfill() {
    let wired = 0
    const seen = new Set()
    const candidates = []

    if (templateNoteId) {
        for (const rel of api.getNote(templateNoteId).getTargetRelations("template")) {
            const note = rel.getNote()
            if (note) candidates.push(note)
        }
    }
    for (const note of api.searchForNotes("#budgetTable")) candidates.push(note)

    for (const note of candidates) {
        if (seen.has(note.noteId)) continue
        seen.add(note.noteId)
        if (!note.getRelationValue("renderNote") && isBudgetNote(note)) {
            provision(note)
            wired++
        }
    }
    return wired
}

module.exports = { backfill }
