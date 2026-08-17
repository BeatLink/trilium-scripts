// One-time migration script — NOT part of either addon's shipped manifest.
//
// Run this ONCE, manually, before updating agenda@beatlink past 3.0.0 (or
// template-picker@beatlink past 1.5.0), if you already have an installed
// agenda with its 7 item templates (Ideas/Goal/Routine/Task/Future/Project/
// Note). Those templates moved out of agenda's manifest into
// template-picker@beatlink's — which means their #TAMFILEID identity changes
// from "agenda@beatlink/tpl-*" to "template-picker@beatlink/tpl-*". Without
// this script, the next sync would see agenda's old export as removed and
// PRUNE (delete) your existing, possibly-customized template notes, then
// create fresh blank ones under template-picker instead.
//
// This script re-tags your EXISTING template notes in place — same note,
// same content, same relations pointing at them — so template-picker's next
// sync finds and adopts them by their new #TAMFILEID instead of creating new
// ones, and agenda's next sync no longer sees them as its own to prune.
//
// HOW TO RUN:
//   1. In Trilium, create a new Code note (JS Backend).
//   2. Paste this whole file as its content.
//   3. Open the note and click the "Execute script" (play) button once.
//   4. Read the printed summary, then delete this note — it's single-use.
//
// Safe to re-run: a note already carrying the new #TAMFILEID is skipped, so
// running it twice does nothing the second time.

const RENAMES = {
    "agenda@beatlink/tpl-idea": "template-picker@beatlink/tpl-idea",
    "agenda@beatlink/tpl-goal": "template-picker@beatlink/tpl-goal",
    "agenda@beatlink/tpl-routine": "template-picker@beatlink/tpl-routine",
    "agenda@beatlink/tpl-task": "template-picker@beatlink/tpl-task",
    "agenda@beatlink/tpl-future": "template-picker@beatlink/tpl-future",
    "agenda@beatlink/tpl-project": "template-picker@beatlink/tpl-project",
    "agenda@beatlink/tpl-note": "template-picker@beatlink/tpl-note"
}

const results = []
for (const [oldId, newId] of Object.entries(RENAMES)) {
    const already = api.getNoteWithLabel("TAMFILEID", newId)
    if (already) {
        results.push(`SKIP  ${newId} — already migrated (note "${already.title}")`)
        continue
    }
    const note = api.getNoteWithLabel("TAMFILEID", oldId)
    if (!note) {
        results.push(`MISS  ${oldId} — no note found with this TAMFILEID (already moved, or never installed)`)
        continue
    }
    note.setLabel("TAMFILEID", newId)
    results.push(`OK    "${note.title}" — retagged ${oldId} -> ${newId}`)
}

console.log(results.join("\n"))
api.showMessage(`Template migration done:\n\n${results.join("\n")}`)
