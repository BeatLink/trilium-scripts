// === Trilium Code note ===
// Title: organizeProvision.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Setup page).
//
// Provisions the opinionated notebook structure (organizeStructure.js) by
// find-or-create, tagging each note with #workflowNote=<key> so the addon can
// resolve it later — the same identity idea as TAM's #TAMFILEID, but scoped to
// this addon and applied to notes the user may already have created by hand.
//
// Resolution order for each node (idempotent, rename-safe):
//   1. an existing note already tagged #workflowNote=<key>  -> adopt as-is
//   2. else a child of the target parent whose title matches -> adopt + tag it
//   3. else create the note under the parent and tag it
//
// Derived attributes — the note's icon (#iconClass), color (#color) and the
// ~template relation — are RE-ASSERTED on every run, on adopted and created
// notes alike, so the structure's look is self-healing and re-running fixes
// drift. seedLabels and note content are applied only when the note is created.

const { buildStructure, AREA_TEMPLATE_TITLE, SPECIAL_TEMPLATE_TITLE } = require("organizeStructure.js")

const WORKFLOW_LABEL = "workflowNote"

// Removed/renamed areas that fold into a surviving one: old name -> surviving
// name (both lowercase). When an area is dropped (e.g. Health folded into
// Fitness), its name no longer appears in area-picker's list, so migrateAreaSlugs
// can't re-key it by name alone — this alias points the old name at the survivor.
const AREA_ALIASES = {
    health: "fitness",
    productivity: "tech"
}

// Migrate stale #area slugs after an area reorder OR a fold in area-picker. Slugs
// are "<NN>-<name>"; the number changes when areas are inserted/reordered/removed,
// but names are stable, so we re-key by name: for every note carrying #area,
// resolve its name-part (via AREA_ALIASES first, for folded areas) to the current
// slug in `areaList` and rewrite #area + #color when it differs. Notes whose name
// is neither a current area nor an alias are left alone (could be custom).
// Returns the count of notes migrated.
async function migrateAreaSlugs(areaList) {
    return api.runOnBackend((areaList, aliases) => {
        // name (lowercase) -> { slug, color } for the current vocabulary.
        const byName = {}
        for (const a of areaList) {
            const name = a.slug.replace(/^\d\d-/, "")
            byName[name] = { slug: a.slug, color: a.color }
        }

        let migrated = 0
        for (const note of api.searchForNotes("#area")) {
            const current = note.getLabelValue("area")
            if (!current) continue
            const m = current.match(/^\d\d-(.+)$/)
            if (!m) continue
            const name = aliases[m[1]] || m[1]
            const target = byName[name]
            if (!target || target.slug === current) continue
            note.setLabel("area", target.slug)
            if (target.color) note.setLabel("color", target.color)
            migrated++
        }
        return migrated
    }, [areaList, AREA_ALIASES])
}

// Resolve a bundled template note id by its title (must carry #template).
// Returns "" if not found, so provisioning degrades gracefully when a template
// note is missing — the note is still created/tagged, just without a template
// relation.
async function resolveTemplateId(title) {
    return api.runOnBackend((title) => {
        const results = api.searchForNotes(`#template note.title = "${title}"`)
        return results.length > 0 ? results[0].noteId : ""
    }, [title])
}

// Resolve-or-create one node under `parentNoteId`, then (re)assert its derived
// attributes. `templateId` is the pre-resolved real id for node.template ("" if
// none). Returns { noteId, created, adopted, title }. Runs on the backend — the
// closure may reference only `api`, so every value is passed in.
async function provisionNode(parentNoteId, node, templateId) {
    return api.runOnBackend((parentNoteId, key, title, icon, color, areaValue, alwaysExpanded, templateId, seedLabels, workflowLabel) => {
        let note
        let created = false
        let adopted = false

        // 1. Already tagged by us? Trust the tag over the title (survives renames).
        const tagged = api.searchForNotes(`#${workflowLabel} = "${key}"`)
        if (tagged.length > 0) {
            note = api.getNote(tagged[0].noteId)
        } else {
            // 2. A same-titled child already under the parent — adopt it in place.
            const parent = api.getNote(parentNoteId)
            const existing = parent
                ? parent.getChildNotes().find(child => child.title === title)
                : null
            if (existing) {
                note = existing
                adopted = true
                note.setLabel(workflowLabel, key)
            } else {
                // 3. Create it, tag it, and apply the creation-only seed labels.
                note = api.createNewNote({
                    parentNoteId,
                    title,
                    type: "text",
                    content: "",
                    mime: "text/html"
                }).note
                created = true
                note.setLabel(workflowLabel, key)
                for (const label of seedLabels) note.setLabel(label.name, label.value)
            }
        }

        // Derived attributes — re-asserted every run (idempotent) on any of the
        // three branches above, so icon/color/template/#area/#alwaysExpanded are
        // self-healing.
        if (icon) note.setLabel("iconClass", `bx ${icon}`)
        if (color) note.setLabel("color", color)
        if (areaValue) note.setLabel("area", areaValue)
        if (alwaysExpanded) note.setLabel("alwaysExpanded", "")
        if (templateId) note.setRelation("template", templateId)

        return { noteId: note.noteId, created, adopted, title }
    }, [parentNoteId, node.key, node.title, node.icon, node.color || "", node.areaValue || "", !!node.alwaysExpanded, templateId, node.seedLabels || [], WORKFLOW_LABEL])
}

// Walk the whole structure depth-first, provisioning each node under its
// resolved parent. Top-level nodes go under "root". `areaList` is area-picker's
// vocabulary ([{ slug, name, color }]); `templateList` is agenda's enabled
// managed templates ([{ slug, name, ... }], in order) — together they drive
// which Area notes and per-template buckets are built. Returns a flat result log
// [{ key, title, created, adopted, noteId, depth }] for the Setup page to show.
async function provisionStructure(areaList, templateList) {
    // Resolve the two templates once up front, then map each node's template
    // title to a real id inside the walk.
    const templateIds = {
        [AREA_TEMPLATE_TITLE]: await resolveTemplateId(AREA_TEMPLATE_TITLE),
        [SPECIAL_TEMPLATE_TITLE]: await resolveTemplateId(SPECIAL_TEMPLATE_TITLE)
    }

    const results = []

    async function walk(nodes, parentNoteId, depth) {
        for (const node of nodes) {
            const templateId = node.template ? (templateIds[node.template] || "") : ""
            const res = await provisionNode(parentNoteId, node, templateId)
            results.push({ ...res, key: node.key, depth })
            if (node.children && node.children.length > 0) {
                await walk(node.children, res.noteId, depth + 1)
            }
        }
    }

    await walk(buildStructure(areaList, templateList), "root", 0)

    // After the structure notes are in place (area roots' #area re-asserted),
    // re-key any note still carrying a stale area slug from a prior ordering.
    const migratedAreaCount = await migrateAreaSlugs(areaList)

    return { results, migratedAreaCount }
}

module.exports = { provisionStructure, migrateAreaSlugs, WORKFLOW_LABEL }
