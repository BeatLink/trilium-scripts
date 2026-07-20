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

// Structural #type values that changed name, not just shape, when the numeric
// prefixes were dropped: old value -> new.
//
// "8-special" maps to the singletons' marker because that is what it becomes for
// the notes this map can still reach. Buckets also wore it, but they are
// re-stamped to `typecollection` by provisionNode's derived pass on the same run,
// which lands after this one — so a bucket briefly mapped to `special` here is
// corrected before the run ends, and a bucket the walk no longer reaches (a
// dropped area) is inert scaffolding either way.
const LEGACY_TYPE_VALUES = {
    "7-area": AREA_COLLECTION_TYPE,
    "8-special": SPECIAL_TYPE
}

// Structural identity, split across three independent labels (see
// organizeStructure.js). An area root has AREA_LABEL only; a bucket has
// AREA_LABEL + BUCKET_LABEL; the Inbox / My Day / Agenda singletons have
// SPECIAL_LABEL. Reading two slugs off two labels replaces parsing them back
// out of one composite "area-<slug>-<tplSlug>" key.
const AREA_LABEL = "agendaOrganizeArea"
const BUCKET_LABEL = "agendaOrganizeBucket"
const SPECIAL_LABEL = "agendaOrganizeSpecial"

// The pre-split label, still read by migrateStructuralLabels to re-stamp
// existing trees. Nothing writes it any more.
const LEGACY_LABEL = "workflowNote"

// Removed/renamed areas that fold into a surviving one: old name -> surviving
// name (both lowercase). When an area is dropped (e.g. Health folded into
// Fitness), its name no longer appears in area-picker's list, so migrateAreaSlugs
// can't re-key it by name alone — this alias points the old name at the survivor.
const AREA_ALIASES = {
    health: "fitness",
    productivity: "tech"
}

// Renamed item templates that fold into a surviving one: old slug -> surviving
// slug. slugify() (organizeTemplates.jsx) collapses every non-alphanumeric run
// to a dash, so it cannot be inverted — once a template is renamed, nothing in
// the tree connects its old bucket key to the new slug. This map is that link;
// add an entry when renaming a template that already has buckets in the wild.
const TEMPLATE_ALIASES = {}

// Normalize every note's #area onto area-picker's stable keys.
//
// Area keys used to be "<NN>-<name>" ("01-career"), so the number changed
// whenever areas were reordered and every tagged note had to be rewritten.
// area-picker now stores order-free stable slugs ("career") — order lives in the
// config list's position (see libAgendaConfig.getSortValueMaps) — so this
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
            const current = note.getLabelValue("area")
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

// Normalize every note's #type off the old "<order>-<slug>" shape onto the bare
// slug ("3-task" -> "task").
//
// #type used to bake the template's `order` into its value, so reordering the
// template list rewrote the label on every tagged note. Order now comes from the
// registry's position instead (libAgendaConfig.getSortValueMaps, the same
// mechanism #area has always used), leaving #type a stable, order-free slug.
//
// Only values whose stripped form matches a CURRENT template slug are rewritten.
// A "<NN>-<word>" #type that resolves to no known template is left alone — #type
// is a public label the user may also be using for a vocabulary of their own, and
// blind prefix-stripping would silently rewrite it.
//
// Idempotent: a bare slug has no prefix to strip and compares equal, so a second
// run migrates nothing. Returns the count of notes migrated.
async function migrateTypeSlugs(templateList) {
    return api.runOnBackend((templateList, containerTypes, renames) => {
        // The slugs a migrated value is allowed to land on: every managed
        // template, plus the structural container markers.
        const known = new Set(templateList.map(t => t.slug))
        for (const t of containerTypes) known.add(t)

        let migrated = 0
        for (const note of api.searchForNotes("#type")) {
            const current = note.getLabelValue("type")
            if (!current) continue
            // The structural values changed name as well as shape ("7-area" ->
            // "areacollection"), so they resolve through an explicit map rather
            // than by stripping.
            const target = renames[current] || current.replace(/^\d+-/, "")
            if (target === current || !known.has(target)) continue
            note.setLabel("type", target)
            migrated++
        }
        return migrated
    }, [templateList, [AREA_COLLECTION_TYPE, TYPE_COLLECTION_TYPE], LEGACY_TYPE_VALUES])
}

// Find buckets whose #workflowNote key is stale — created under an area or
// template name that has since been renamed, folded, or dropped — and fold each
// into the surviving bucket for the same (area, template) pair.
//
// A bucket is identified by (areaSlug, templateSlug), and either half can drift:
// an area can be renamed or folded, and a template rename re-slugs its buckets.
//
// Area keys are stable slugs, so they look up directly — through AREA_ALIASES
// for folded areas, and with a legacy "<NN>-" prefix stripped for buckets
// provisioned before the stable-key migration. A template slug carries no such
// remnant: slugify() is lossy, so a renamed template's old slug resolves only
// via an explicit TEMPLATE_ALIASES entry. Unresolvable keys are reported in
// `skipped` rather than guessed at.
// If the rebuilt key differs and a live bucket already holds it, the stale
// bucket is a duplicate of it.
//
// Folding migrates BOTH halves of the stale bucket into the survivor:
//   - children, via toggleNoteInParent (add to survivor, remove from stale),
//     which preserves any clones of those notes living elsewhere;
//   - the bucket note's own body content, appended to the survivor's body under
//     a "Merged from <title>" heading. Buckets are containers whose body is
//     near-always empty, but when one isn't, dropping it would be data loss.
//
// The emptied husk is then deleted — but only after re-reading it and CONFIRMING
// it has no remaining children and no remaining content. If anything survives
// the migration (a child that failed to move, a body that didn't append), the
// husk is kept and reported with `deleted: false` plus the reason. Deleting a
// bucket the user hand-made during adoption is the one irreversible step here,
// so it happens only against a note verified empty, never on assumption.
//
// `dryRun` reports what would happen without writing — the Setup page previews
// before the user commits. Returns
// { merges: [{ fromNoteId, fromKey, fromTitle, toNoteId, toKey, toTitle,
//              movedCount, movedTitles, movedContent, deleted, keptReason }],
//   skipped: [...] }.
async function mergeStaleBuckets(areaList, templateList, dryRun) {
    return api.runOnBackend((areaList, templateList, aliases, templateAliases, labels, dryRun) => {
        // Current vocabularies. Area keys are already stable slugs; a legacy
        // "<NN>-" prefix is stripped so pre-migration buckets still resolve.
        const areaSlugByName = {}
        for (const a of areaList) areaSlugByName[a.slug.replace(/^\d\d-/, "")] = a.slug
        const templateSlugs = new Set(templateList.map(t => t.slug))

        const tagged = api.searchForNotes(`#${labels.area}`)
        const identityOf = n => ({
            area: n.getLabelValue(labels.area) || "",
            bucket: n.getLabelValue(labels.bucket) || ""
        })
        // NUL-delimited so an (area, bucket) pair can never collide with another
        // pairing — no slug can contain it. Written as an escape rather than a
        // raw byte so the file stays text to git (a literal NUL makes diffs
        // binary).
        const idKey = id => id.bucket ? `${id.area}\u0000${id.bucket}` : id.area

        // Index live structural notes by identity so a stale note can find its
        // survivor. Reading two labels replaces parsing a composite key.
        const byIdentity = {}
        for (const n of tagged) byIdentity[idKey(identityOf(n))] = n

        // Resolve a note's identity to today's vocabulary, or null if either
        // half is unresolvable. Area keys are stable, so they resolve directly
        // (a legacy "<NN>-" prefix is stripped first, and AREA_ALIASES covers
        // folds); template slugs retain nothing (slugify() is lossy), so a
        // renamed template resolves only via an explicit alias.
        function currentIdentityFor(id) {
            const areaName = id.area.replace(/^\d\d-/, "")
            const liveArea = areaSlugByName[aliases[areaName] || areaName]
            if (!liveArea) return null
            if (!id.bucket) return { area: liveArea, bucket: "" }
            const liveBucket = templateSlugs.has(id.bucket)
                ? id.bucket
                : (templateAliases[id.bucket] || "")
            if (!liveBucket || !templateSlugs.has(liveBucket)) return null
            return { area: liveArea, bucket: liveBucket }
        }

        const merges = []
        const skipped = []

        for (const note of tagged) {
            const identity = identityOf(note)
            if (!identity.area) continue
            const key = idKey(identity)

            const target = currentIdentityFor(identity)
            if (!target) {
                // Neither half resolves — an area or template the user removed
                // entirely. Not ours to fold; report so it's visible.
                skipped.push({ noteId: note.noteId, key, title: note.title, reason: "no current area/template matches" })
                continue
            }
            const targetKey = idKey(target)
            if (targetKey === key) continue

            const survivor = byIdentity[targetKey]
            if (!survivor) {
                // The re-keyed bucket doesn't exist yet. Don't create it here —
                // provisionStructure builds buckets; re-stamping this note's
                // identity labels lets it be adopted in place instead.
                if (!dryRun) {
                    note.setLabel(labels.area, target.area)
                    if (target.bucket) note.setLabel(labels.bucket, target.bucket)
                    else note.removeLabel(labels.bucket)
                }
                merges.push({
                    fromNoteId: note.noteId, fromKey: key, fromTitle: note.title,
                    toNoteId: note.noteId, toKey: targetKey, toTitle: note.title,
                    movedCount: 0, movedTitles: [], movedContent: false,
                    deleted: false, keptReason: "", rekeyedInPlace: true
                })
                continue
            }
            if (survivor.noteId === note.noteId) continue

            const children = note.getChildNotes()
            const movedTitles = children.map(c => c.title)

            function bodyOf(n) {
                if (n.type !== "text") return ""
                try {
                    const body = n.getContent()
                    return body && typeof body === "string" ? body : ""
                } catch (e) { return "" }
            }
            function isBlank(html) {
                return !String(html || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()
            }

            const staleBody = bodyOf(note)
            const movedContent = !isBlank(staleBody)
            let deleted = false
            let keptReason = ""

            if (!dryRun) {
                // Move each child and confirm the move from the CHILD's own
                // parent list. Re-reading the husk's getChildNotes() instead
                // would read a cached entity that still lists the children we
                // just moved, so every husk would look non-empty and never be
                // deleted.
                const stuck = []
                for (const child of children) {
                    api.toggleNoteInParent(true, child.noteId, survivor.noteId, "")
                    api.toggleNoteInParent(false, child.noteId, note.noteId, "")
                    const moved = api.getNote(child.noteId)
                    const parentIds = moved ? moved.getParentNotes().map(p => p.noteId) : []
                    if (!moved || parentIds.indexOf(survivor.noteId) === -1 ||
                        parentIds.indexOf(note.noteId) !== -1) {
                        stuck.push(child.title)
                    }
                }

                // Migrate the husk's own body onto the survivor before emptying
                // it, so deletion can't drop content.
                let contentStuck = false
                if (movedContent) {
                    const target = api.getNote(survivor.noteId)
                    if (target && target.type === "text") {
                        const existing = bodyOf(target)
                        target.setContent(`${existing}<h2>Merged from ${note.title}</h2>${staleBody}`)
                        note.setContent("")
                    } else {
                        contentStuck = true
                        keptReason = "survivor is not a text note; content left in place"
                    }
                }

                // Delete only on verified-empty: every child confirmed re-parented
                // and the body confirmed migrated.
                if (stuck.length > 0) {
                    keptReason = `${stuck.length} child note(s) did not move: ${stuck.join(", ")}`
                }
                if (!keptReason && !contentStuck) {
                    note.deleteNote()
                    deleted = true
                } else {
                    // Kept for inspection — drop the identity labels so
                    // provisioning stops resolving to it, and point at where it
                    // folded.
                    note.removeLabel(labels.area)
                    note.removeLabel(labels.bucket)
                    note.setLabel("agendaOrganizeMerged", targetKey)
                }
            }

            merges.push({
                fromNoteId: note.noteId, fromKey: key, fromTitle: note.title,
                toNoteId: survivor.noteId, toKey: targetKey, toTitle: survivor.title,
                movedCount: children.length, movedTitles, movedContent,
                deleted, keptReason, rekeyedInPlace: false
            })
        }

        return { merges, skipped }
    }, [areaList, templateList, AREA_ALIASES, TEMPLATE_ALIASES,
        { area: AREA_LABEL, bucket: BUCKET_LABEL, special: SPECIAL_LABEL }, !!dryRun])
}

// One-time migration off the single composite #workflowNote key onto the three
// split identity labels. Runs BEFORE anything resolves structure, because until
// it does, an existing tree carries none of the new labels and provisioning
// would rebuild the whole structure alongside it.
//
// The old key shapes were "inbox" / "my-day" / "agenda" for the singletons,
// "area-<areaSlug>" for an area root, and "area-<areaSlug>-<templateSlug>" for a
// bucket. This is the LAST place that parsing lives — after the migration the
// slugs are read straight off their own labels.
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
            const key = note.getLabelValue(legacyLabel)
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
            // Guard the ambiguous case: a template slug could in principle look
            // like an area slug. Only treat the trailing part as a bucket when
            // the leading part is a known area.
            if (areaSlugs.length > 0 && areaSlugs.indexOf(m[1]) === -1) {
                unparsed.push({ noteId: note.noteId, key, title: note.title })
                continue
            }

            note.setLabel(labels.area, m[1])
            if (m[2]) note.setLabel(labels.bucket, m[2])
            note.removeLabel(legacyLabel)
            migrated++
        }

        return { migrated, unparsed }
    }, [areaList, LEGACY_LABEL, { area: AREA_LABEL, bucket: BUCKET_LABEL, special: SPECIAL_LABEL }])
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

        // Stamp this node's identity labels. An area root gets the area label
        // only; a bucket gets area + bucket; a singleton gets the special label.
        function tagIdentity(n) {
            if (identity.special) {
                n.setLabel(labels.special, identity.special)
                return
            }
            if (identity.area) n.setLabel(labels.area, identity.area)
            if (identity.bucket) n.setLabel(labels.bucket, identity.bucket)
            else n.removeLabel(labels.bucket)
        }

        // Find the note already carrying this exact identity. Buckets must match
        // BOTH labels — an area label alone would match the area root itself and
        // every sibling bucket in it.
        function findTagged() {
            if (identity.special) {
                return api.searchForNotes(`#${labels.special} = "${identity.special}"`)
            }
            if (identity.bucket) {
                return api.searchForNotes(
                    `#${labels.area} = "${identity.area}" #${labels.bucket} = "${identity.bucket}"`)
            }
            // Area root: has the area label and NO bucket label.
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
        { area: node.area || "", bucket: node.bucket || "", special: node.special || "" },
        node.title, node.icon, node.color || "", node.areaValue || "",
        node.typeValue || "",
        !!node.alwaysExpanded, templateId, node.seedLabels || [],
        { area: AREA_LABEL, bucket: BUCKET_LABEL, special: SPECIAL_LABEL }
    ])
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
        [TYPE_TEMPLATE_TITLE]: await resolveTemplateId(TYPE_TEMPLATE_TITLE),
        [SPECIAL_TEMPLATE_TITLE]: await resolveTemplateId(SPECIAL_TEMPLATE_TITLE)
    }

    // Convert any pre-split tree onto the new identity labels FIRST. Until this
    // runs, an existing structure carries only #workflowNote, so every resolve
    // below would miss and rebuild the whole tree alongside the old one.
    const labelMigration = await migrateStructuralLabels(areaList)

    // Then fold stale-identity buckets, still BEFORE the walk. Provisioning
    // resolves by identity and would otherwise create a fresh empty bucket at
    // the current identity, leaving the user's content stranded in the stale one
    // and turning a one-sided migration into a two-live-bucket reconciliation.
    const merged = await mergeStaleBuckets(areaList, templateList, false)

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

    // Same shape for #type: strip the legacy "<order>-" prefix now that ordering
    // lives in the templates registry's position rather than in the label value.
    // Runs after the walk so the structural notes' own #type is already current.
    const migratedTypeCount = await migrateTypeSlugs(templateList)

    return { results, migratedAreaCount, migratedTypeCount, merged, labelMigration }
}

module.exports = {
    provisionStructure, migrateAreaSlugs, migrateTypeSlugs, mergeStaleBuckets, migrateStructuralLabels,
    AREA_LABEL, BUCKET_LABEL, SPECIAL_LABEL
}
