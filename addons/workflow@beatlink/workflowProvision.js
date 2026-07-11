// === Trilium Code note ===
// Title: workflowProvision.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Setup page).
//
// Provisions the opinionated notebook structure (workflowStructure.js) by
// find-or-create, tagging each note with #workflowNote=<key> so the addon can
// resolve it later — the same identity idea as TAM's #TAMFILEID, but scoped to
// this addon and applied to notes the user may already have created by hand.
//
// Resolution order for each node (idempotent, rename-safe):
//   1. an existing note already tagged #workflowNote=<key>  -> adopt as-is
//   2. else a child of the target parent whose title matches -> adopt + tag it
//   3. else create the note under the parent and tag it
// Adopting never overwrites the note's content or its existing labels; the
// node's `labels`/`icon` are applied only when the note is newly created.
//
// Top-level nodes (Inbox / My Day / Agenda / the 15 Areas) are provisioned
// under Trilium's "root"; each area's subtype notes under that area.

const { STRUCTURE } = require("workflowStructure.js")

const WORKFLOW_LABEL = "workflowNote"

// Resolve-or-create one node under `parentNoteId`. Returns { noteId, created,
// adopted, title }. Runs entirely on the backend — the closure may reference
// only `api`, so every value it needs is passed in the args array.
async function provisionNode(parentNoteId, key, title, icon, labels) {
    return api.runOnBackend((parentNoteId, key, title, icon, labels, workflowLabel) => {
        // 1. Already tagged by us? Trust the tag over the title (survives renames).
        const tagged = api.searchForNotes(`#${workflowLabel} = "${key}"`)
        if (tagged.length > 0) {
            return { noteId: tagged[0].noteId, created: false, adopted: false, title }
        }

        // 2. A same-titled child already under the parent — adopt it in place.
        const parent = api.getNote(parentNoteId)
        const existing = parent
            ? parent.getChildNotes().find(child => child.title === title)
            : null
        if (existing) {
            existing.setLabel(workflowLabel, key)
            return { noteId: existing.noteId, created: false, adopted: true, title }
        }

        // 3. Create it, tag it, and apply the node's creation-only labels + icon.
        const { note } = api.createNewNote({
            parentNoteId,
            title,
            type: "text",
            content: "",
            mime: "text/html"
        })
        note.setLabel(workflowLabel, key)
        if (icon) note.setLabel("iconClass", `bx ${icon}`)
        for (const label of labels) note.setLabel(label.name, label.value)
        return { noteId: note.noteId, created: true, adopted: false, title }
    }, [parentNoteId, key, title, icon, labels, WORKFLOW_LABEL])
}

// Walk the whole STRUCTURE depth-first, provisioning each node under its
// resolved parent. Top-level nodes go under "root". Returns a flat result log
// [{ key, title, created, adopted, noteId, depth }] for the Setup page to show.
async function provisionStructure() {
    const results = []

    async function walk(nodes, parentNoteId, depth) {
        for (const node of nodes) {
            const res = await provisionNode(
                parentNoteId, node.key, node.title, node.icon, node.labels || []
            )
            results.push({ ...res, key: node.key, depth })
            if (node.children && node.children.length > 0) {
                await walk(node.children, res.noteId, depth + 1)
            }
        }
    }

    await walk(STRUCTURE, "root", 0)
    return results
}

module.exports = { provisionStructure, WORKFLOW_LABEL }
