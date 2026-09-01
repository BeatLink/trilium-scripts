// One-time migration script — NOT part of this addon's shipped manifest.
//
// Run this ONCE, manually, before updating agenda-overview@beatlink past
// 2.0.0, if you have agenda@beatlink installed. agenda@beatlink is gone: its
// settings note moved into this addon, which means your config.json's
// #TAMFILEID identity changes from "agenda@beatlink/config" to
// "agenda-overview@beatlink/config". Without this script the next sync sees
// agenda's old export as removed and PRUNES (deletes) your config — every
// profile, dimension, search, filter, sort, prefix, colour and grouping you
// have set up — then creates a fresh empty one under agenda-overview.
//
// This script re-tags your EXISTING config note in place — same note, same
// content — so agenda-overview's next sync adopts it by its new #TAMFILEID
// instead of creating a new one, and agenda's next sync no longer sees it as
// its own to prune.
//
// HOW TO RUN:
//   1. In Trilium, create a new Code note (JS Backend).
//   2. Paste this whole file as its content.
//   3. Open the note and click the "Execute script" (play) button once.
//   4. Read the printed summary, then delete this note — it's single-use.
//   5. Update agenda-overview@beatlink, then uninstall agenda@beatlink.
//
// Safe to re-run: a note already carrying the new #TAMFILEID is skipped, so
// running it twice does nothing the second time.

const RENAMES = {
    "agenda@beatlink/config": "agenda-overview@beatlink/config"
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
api.showMessage(`Agenda config migration done:\n\n${results.join("\n")}`)
