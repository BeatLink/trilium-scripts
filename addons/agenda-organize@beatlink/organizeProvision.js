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

const {
    buildStructure,
    AREA_TEMPLATE_TITLE, TYPE_TEMPLATE_TITLE, SPECIAL_TEMPLATE_TITLE,
    AREA_COLLECTION_TYPE, TYPE_COLLECTION_TYPE, SPECIAL_TYPE
} = require("organizeStructure.js")
const { getBucketTemplates } = require("organize.js")

// Structural identity, one label per kind of top-level root (see
// organizeStructure.js). An area root has AREA_LABEL, a type root has
// TYPE_LABEL, the Inbox / My Day / Agenda singletons have SPECIAL_LABEL. The
// three are mutually exclusive.
const AREA_LABEL = "agendaOrganizeArea"
const TYPE_LABEL = "agendaOrganizeType"
const SPECIAL_LABEL = "agendaOrganizeSpecial"

// The label that marked a per-area type bucket under the old nested shape
// (an area root's child, carrying AREA_LABEL alongside it). The structure is
// flat now and nothing reads or writes it; it survives here only so
// migrateStructuralLabels can recognize a legacy bucket and leave it alone
// rather than mistaking it for an area root.
const BUCKET_LABEL = "agendaOrganizeBucket"

// The pre-split label, still read by migrateStructuralLabels to re-stamp
// existing trees. Nothing writes it any more.
const LEGACY_LABEL = "workflowNote"

// Removed/renamed areas that fold into a surviving one: old name -> surviving
// name (both lowercase). When an area value is dropped (e.g. Health folded into
// Fitness), its key no longer appears in the area dimension, so migrateAreaSlugs
// can't re-key it by name alone — this alias points the old name at the survivor.
const AREA_ALIASES = {
    health: "fitness",
    productivity: "tech"
}

// Normalize every note's #area onto area-picker's stable keys.
//
// Area keys used to be "<NN>-<name>" ("01-career"), so the number changed
// whenever areas were reordered and every tagged note had to be rewritten.
// the area dimension now stores order-free stable slugs ("career") — order lives
// in the value list's position (see dimensions.getSortValueMaps) — so this
// migration runs one way: strip a leading "<NN>-" when present, then resolve
// through AREA_ALIASES for areas that were folded into another (health ->
// fitness). #color is re-asserted from the resolved area.
//
// Idempotent by construction: an already-stable value has no prefix to strip and
// resolves to itself, so a second run migrates nothing. Values matching no
// current area are left alone (could be a vocabulary the user maintains by
// hand). Returns the count of notes migrated.
async function migrateAreaSlugs(areaList) {
    return api.runOnBackend((areaList, aliases) => {
        // stable key -> { slug, color } for the current vocabulary.
        const byKey = {}
        for (const a of areaList) byKey[a.slug] = { slug: a.slug, color: a.color }

        let migrated = 0
        for (const note of api.searchForNotes("#area")) {
            // Owned-only: #area is inherited by every note templated from an area
            // collection, and setLabel() below would stamp the inherited value on
            // as an owned one.
            const current = note.getOwnedLabelValue("area")
            if (!current) continue
            const stripped = current.replace(/^\d\d-/, "")
            const target = byKey[aliases[stripped] || stripped]
            if (!target || target.slug === current) continue
            note.setLabel("area", target.slug)
            if (target.color) note.setLabel("color", target.color)
            migrated++
        }
        return migrated
    }, [areaList, AREA_ALIASES])
}

// One-time migration off the single composite #workflowNote key onto the split
// identity labels. Runs BEFORE anything resolves structure, because until it
// does, an existing tree carries none of the new labels and provisioning would
// rebuild the whole structure alongside it.
//
// The old key shapes were "inbox" / "my-day" / "agenda" for the singletons,
// "area-<areaSlug>" for an area root, and "area-<areaSlug>-<templateSlug>" for a
// per-area type bucket. This is the LAST place that parsing lives — after the
// migration the slugs are read straight off their own labels.
//
// The bucket shape has no equivalent under the flat structure: a note nested
// inside an area root is not one of today's top-level roots, and stamping it
// with either identity label would make provisioning adopt a nested note as a
// root. Those keys are reported as unparsed and left untouched, legacy label
// intact, so the notes stay exactly where the user has them.
//
// Idempotent: notes already carrying a new label are skipped, and the legacy
// label is removed as each note is converted, so a second run finds nothing.
// Returns { migrated, unparsed } — `unparsed` lists keys that matched no known
// shape, left untouched with their legacy label intact.
async function migrateStructuralLabels(areaList) {
    return api.runOnBackend((areaList, legacyLabel, labels) => {
        const areaSlugs = (areaList || []).map(a => a.slug)
        const specials = { "inbox": "inbox", "my-day": "my-day", "agenda": "agenda" }

        let migrated = 0
        const unparsed = []

        for (const note of api.getNotesWithLabel(legacyLabel)) {
            // Owned-only: an inherited legacy key would stamp the structural
            // identity label onto every instance of the template carrying it.
            const key = note.getOwnedLabelValue(legacyLabel)
            if (!key) continue

            if (specials[key]) {
                note.setLabel(labels.special, specials[key])
                note.removeLabel(legacyLabel)
                migrated++
                continue
            }

            // Legacy keys were written when area slugs were numbered, so match
            // both shapes: "area-01-career-task" and "area-career-task". The
            // area half is normalized to its stable key before being stamped.
            const m = key.match(/^area-(?:\d\d-)?([a-z]+)(?:-(.+))?$/)
            if (!m) {
                unparsed.push({ noteId: note.noteId, key, title: note.title })
                continue
            }
            if (areaSlugs.length > 0 && areaSlugs.indexOf(m[1]) === -1) {
                unparsed.push({ noteId: note.noteId, key, title: note.title })
                continue
            }
            // A trailing segment means this was a per-area type bucket, a shape
            // the flat structure has no place for. Leave it alone (see above).
            if (m[2]) {
                unparsed.push({ noteId: note.noteId, key, title: note.title })
                continue
            }

            note.setLabel(labels.area, m[1])
            note.removeLabel(legacyLabel)
            migrated++
        }

        return { migrated, unparsed }
    }, [areaList, LEGACY_LABEL, { area: AREA_LABEL, special: SPECIAL_LABEL }])
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
    return api.runOnBackend((parentNoteId, identity, title, icon, color, areaValue, typeValue, alwaysExpanded, templateId, seedLabels, labels) => {
        let note
        let created = false
        let adopted = false

        // Stamp this node's identity label — exactly one, since the three kinds
        // of root are mutually exclusive.
        function tagIdentity(n) {
            if (identity.special) {
                n.setLabel(labels.special, identity.special)
                return
            }
            if (identity.typeRoot) {
                n.setLabel(labels.type, identity.typeRoot)
                return
            }
            if (identity.area) n.setLabel(labels.area, identity.area)
        }

        // Find the note already carrying this exact identity.
        function findTagged() {
            if (identity.special) {
                return api.searchForNotes(`#${labels.special} = "${identity.special}"`)
            }
            if (identity.typeRoot) {
                return api.searchForNotes(`#${labels.type} = "${identity.typeRoot}"`)
            }
            // Area root: the area label and NO bucket label. A tree provisioned
            // under the old nested shape has per-area buckets carrying the same
            // area label, so matching on it alone would resolve the area root to
            // one of its own former children and provision the flat structure
            // inside it.
            return api.searchForNotes(`#${labels.area} = "${identity.area}" #!${labels.bucket}`)
        }

        // 1. Already tagged by us? Trust the tag over the title (survives renames).
        const tagged = findTagged()
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
                tagIdentity(note)
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
                tagIdentity(note)
                for (const label of seedLabels) note.setLabel(label.name, label.value)
            }
        }

        // Derived attributes — re-asserted every run (idempotent) on any of the
        // three branches above, so icon/color/template/#area/#type/#alwaysExpanded
        // are self-healing.
        if (icon) note.setLabel("iconClass", `bx ${icon}`)
        if (color) note.setLabel("color", color)
        if (areaValue) note.setLabel("area", areaValue)
        if (typeValue) note.setLabel("type", typeValue)
        if (alwaysExpanded) note.setLabel("alwaysExpanded", "")
        if (templateId) note.setRelation("template", templateId)

        return { noteId: note.noteId, created, adopted, title }
    }, [
        parentNoteId,
        { area: node.area || "", typeRoot: node.typeRoot || "", special: node.special || "" },
        node.title, node.icon, node.color || "", node.areaValue || "",
        node.typeValue || "",
        !!node.alwaysExpanded, templateId, node.seedLabels || [],
        { area: AREA_LABEL, type: TYPE_LABEL, bucket: BUCKET_LABEL, special: SPECIAL_LABEL }
    ])
}

// Provision every top-level root under "root". The structure is flat — the walk
// stays recursive only because a node's `children` is part of the node contract,
// and today every node's is empty.
//
// `dimensions` is agenda's full dimension list; the root dimension
// (scaffoldsAreas) becomes the Area roots, reduced here to the
// { slug, name, color } shape the builder and migrations expect. The type roots
// come straight from template-picker@beatlink's own enabled registry entries
// ({ noteId, name, icon }), one root per entry. Returns a flat result log
// [{ key, title, created, adopted, noteId, depth }] for the Setup page to show.
//
// This provisions CONTAINERS only. Filing an item into its area root and its
// type root is the Organize page's per-note job, so nothing here creates,
// moves or reconciles item branches — re-running is safe and never touches
// anything the user has filed.
async function provisionStructure(dimensions) {
    const rootDim = dimensions.find(d => d.scaffoldsAreas)
    const areaList = (rootDim ? rootDim.values : [])
        .map(v => ({ slug: v.key, name: v.name, color: v.color }))
    const templateList = (await getBucketTemplates())
        .map(t => ({ noteId: t.noteId, name: t.name, icon: t.icon }))

    // Resolve the two templates once up front, then map each node's template
    // title to a real id inside the walk.
    const templateIds = {
        [AREA_TEMPLATE_TITLE]: await resolveTemplateId(AREA_TEMPLATE_TITLE),
        [TYPE_TEMPLATE_TITLE]: await resolveTemplateId(TYPE_TEMPLATE_TITLE),
        [SPECIAL_TEMPLATE_TITLE]: await resolveTemplateId(SPECIAL_TEMPLATE_TITLE)
    }

    // Convert any pre-split tree onto the new identity labels FIRST. Until this
    // runs, an existing structure carries only #workflowNote, so every resolve
    // below would miss and rebuild the whole tree alongside the old one.
    const labelMigration = await migrateStructuralLabels(areaList)

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

    return { results, migratedAreaCount, labelMigration }
}

module.exports = {
    provisionStructure, migrateAreaSlugs, migrateStructuralLabels,
    AREA_LABEL, TYPE_LABEL, SPECIAL_LABEL
}
