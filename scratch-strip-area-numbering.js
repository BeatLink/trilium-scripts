// === Trilium Code note ===
// Type: Code -> JS Backend    (Run: manually, once, then delete this note)
//
// ONE-TIME: strip the legacy "<NN>-" prefix from every #area value, migrating
// notes onto area-picker's stable keys ("01-career" -> "career").
//
// Set DRY_RUN = false to actually write. Leave it true first and read the
// report -- it lists every note that would change, plus anything unresolvable.
//
// Idempotent: an already-stable value has no prefix to strip and resolves to
// itself, so re-running changes nothing. Safe to run against a mixed notebook.

const DRY_RUN = true

// Areas folded into another (old key -> surviving key). Mirrors AREA_ALIASES in
// organizeProvision.js -- keep the two in sync if you add a fold.
const ALIASES = {
    health: "fitness",
    productivity: "tech"
}

// The current vocabulary, read from area-picker's config so this script can
// never invent a key the picker doesn't know about. Falls back to nothing (and
// aborts) rather than guessing if area-picker isn't discoverable.
function currentAreas() {
    const anchors = api.searchForNotes("#areaConfig")
    if (!anchors.length) return null

    const configNoteId = anchors[0].getRelationValue("AddonData:config")
    if (!configNoteId) return null

    const configNote = api.getNote(configNoteId)
    if (!configNote) return null

    let parsed
    try {
        parsed = JSON.parse(configNote.getContent() || "{}")
    } catch (e) {
        return null
    }

    // The config stores { areas: { <key>: { title, color } } } or a list --
    // accept either shape.
    const areas = parsed.areas
    if (!areas) return null

    const out = {}
    if (Array.isArray(areas)) {
        for (const a of areas) if (a && a.key) out[a.key] = a.color || ""
    } else {
        for (const [key, a] of Object.entries(areas)) out[key] = (a && a.color) || ""
    }
    return Object.keys(out).length ? out : null
}

const byKey = currentAreas()
if (!byKey) {
    api.log("ABORT: could not read area-picker's area list (#areaConfig). Nothing was changed.")
    return
}

const changed = []
const unresolved = []
let alreadyStable = 0

for (const note of api.searchForNotes("#area")) {
    const current = note.getLabelValue("area")
    if (!current) continue

    const stripped = current.replace(/^\d\d-/, "")
    const targetKey = ALIASES[stripped] || stripped

    // Not a key area-picker knows -- could be a vocabulary you maintain by
    // hand, so report it and leave it completely alone.
    if (!(targetKey in byKey)) {
        unresolved.push(`${note.noteId}  ${note.title}  #area=${current}`)
        continue
    }

    if (targetKey === current) { alreadyStable++; continue }

    changed.push(`${current} -> ${targetKey}   ${note.title}`)

    if (!DRY_RUN) {
        note.setLabel("area", targetKey)
        const color = byKey[targetKey]
        if (color) note.setLabel("color", color)
    }
}

api.log("=".repeat(60))
api.log(DRY_RUN ? "DRY RUN -- nothing written" : "APPLIED -- notes updated")
api.log("=".repeat(60))
api.log(`already stable: ${alreadyStable}`)
api.log(`${DRY_RUN ? "would change" : "changed"}:   ${changed.length}`)
api.log(`unresolved:     ${unresolved.length}`)

if (changed.length) {
    api.log("")
    api.log(`--- ${DRY_RUN ? "would change" : "changed"} ---`)
    for (const line of changed) api.log("  " + line)
}

if (unresolved.length) {
    api.log("")
    api.log("--- unresolved (left untouched; no matching area key) ---")
    for (const line of unresolved) api.log("  " + line)
}

api.log("")
api.log(DRY_RUN
    ? "Review the above, then set DRY_RUN = false and run again."
    : "Done. Delete this note.")
