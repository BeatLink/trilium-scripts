// One-time migration script — NOT part of either addon's shipped manifest.
//
// Run this ONCE, manually, before updating agenda-structure@beatlink past
// 2.0.0 (or template-picker@beatlink past 1.6.0), if you already have an
// installed agenda-structure with its AreaCollection template. That template
// moved out of agenda-structure's manifest into template-picker@beatlink's —
// which means its #TAMFILEID identity changes from
// "agenda-structure@beatlink/tpl-area" to "template-picker@beatlink/tpl-area".
//
// Without this script, agenda-structure's next sync sees tpl-area as removed
// from its manifest and PRUNES (deletes) the note — persistent placement does
// not protect it, because pruneRemovedNotes builds its exempt set from the
// CURRENT manifest and tpl-area is no longer in it. Every Area root's
// ~template relation would break, and template-picker would create a fresh
// blank AreaCollection alongside it.
//
// This script re-tags your EXISTING AreaCollection note in place — same note,
// same content, same ~template relations pointing at it — so template-picker's
// next sync adopts it by its new #TAMFILEID instead of creating a new one, and
// agenda-structure's next sync no longer sees it as its own to prune.
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
    "agenda-structure@beatlink/tpl-area": "template-picker@beatlink/tpl-area"
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
api.showMessage(`AreaCollection migration done:\n\n${results.join("\n")}`)
