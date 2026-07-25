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

// Fold duplicate and stale buckets down to a single survivor per (area, bucket)
// identity. Three duplication scenarios collapse to one problem -- more than one
// note claims the same LIVE bucket identity -- handled uniformly:
//
//   A. Two live buckets, same current key (e.g. two "Task" buckets both tagged
//      area=home bucket=task). Neither is stale; the old code skipped both.
//   B. A tagged bucket plus a same-titled sibling with no identity labels
//      (provisioning adopted the tagged one, orphaning the twin). Only a twin
//      carrying a provisioning marker — the legacy identity label or a live
//      bucket ~template — is a candidate; a title match alone is not enough to
//      put a note on a delete path (see step 2).
//   C. A bucket whose area folded via AREA_ALIASES and should resolve onto the
//      surviving area (a bucket's own noteId-based identity never goes stale on
//      its own — only its area half can).
//
// Every candidate is resolved to its live identity, grouped by it, and each
// group with >1 note keeps ONE survivor (a member already at the live identity,
// else the note with the most children, then the longest body, then the lowest
// noteId -- the one most likely to be the real bucket) and folds the rest in.
//
// Folding migrates both halves of each husk into the survivor:
//   - children, via toggleNoteInParent (add to survivor, remove from husk),
//     which preserves any clones of those notes living elsewhere;
//   - the husk's own body, appended under a "Merged from <title>" heading.
//     Buckets are containers whose body is near-always empty, but when one
//     isn't, dropping it would be data loss.
//
// A husk is deleted only after re-reading it and CONFIRMING it has no remaining
// children, no remaining content, and no clones in other parents (deleteNote()
// removes the note itself, so a cloned husk would vanish from wherever else the
// user filed it). Anything that survives the migration keeps the husk (reported
// `deleted: false` + reason). Deleting a note is the one irreversible step, so it
// happens only against a note verified empty AND verified provisioned, never on
// assumption — a title match is not evidence of ownership.
//
// A lone stale bucket (no other note at its live identity) is re-keyed in place
// so provisionStructure adopts it -- reported `rekeyedInPlace: true`.
//
// `dryRun` reports what would happen without writing. Returns
// { merges: [{ fromNoteId, fromKey, fromTitle, toNoteId, toKey, toTitle,
//              movedCount, movedTitles, movedContent, deleted, keptReason,
//              rekeyedInPlace }],
//   skipped: [...] }.
async function mergeStaleBuckets(areaList, templateList, dryRun) {
    return api.runOnBackend((areaList, templateList, aliases, labels, dryRun) => {
        // Current vocabularies. Area keys are already stable slugs; a legacy
        // "<NN>-" prefix is stripped so pre-migration buckets still resolve.
        const areaSlugByName = {}
        for (const a of areaList) areaSlugByName[a.slug.replace(/^\d\d-/, "")] = a.slug
        // Bucket identity is a template noteId, which never gets renamed — no
        // alias table needed, a bucket's own value either is or isn't a
        // currently-enabled template.
        const templateIds = new Set(templateList.map(t => t.noteId))

        const identityOf = n => ({
            area: n.getLabelValue(labels.area) || "",
            bucket: n.getLabelValue(labels.bucket) || ""
        })
        // Pipe-delimited: a slug is [a-z0-9-] only and a noteId is alphanumeric,
        // so "|" can never appear in either half and an (area, bucket) pair can
        // never collide with another.
        const idKey = id => id.bucket ? `${id.area}|${id.bucket}` : id.area

        // Resolve a note's identity to today's vocabulary, or null if either
        // half is unresolvable. Area keys are stable, so they resolve directly
        // (a legacy "<NN>-" prefix is stripped first, and AREA_ALIASES covers
        // folds); a bucket noteId resolves only if it's still a live template.
        function currentIdentityFor(id) {
            const areaName = id.area.replace(/^\d\d-/, "")
            const liveArea = areaSlugByName[aliases[areaName] || areaName]
            if (!liveArea) return null
            if (!id.bucket) return { area: liveArea, bucket: "" }
            if (!templateIds.has(id.bucket)) return null
            return { area: liveArea, bucket: id.bucket }
        }

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
        // Weight for survivor selection: most children, then longest body.
        function weightOf(n) {
            return n.getChildNotes().length * 1e6 + bodyOf(n).length
        }

        const merges = []
        const skipped = []

        // 1. Group candidate BUCKETS by live identity. Area roots are singletons
        //    per area, so they're excluded. Tagged notes resolve through
        //    currentIdentityFor (covers scenarios A and C); unresolvable ones are
        //    reported and skipped.
        const tagged = api.searchForNotes(`#${labels.area}`)
        const groups = {}            // liveKey -> [{ note, wasStale, untagged }]
        const liveIdentityByKey = {} // liveKey -> resolved identity
        const areaRoots = {}         // areaKey -> area root note

        for (const n of tagged) {
            const id = identityOf(n)
            if (id.area && !id.bucket) areaRoots[id.area] = n
        }

        for (const note of tagged) {
            const identity = identityOf(note)
            if (!identity.area || !identity.bucket) continue   // area root, not a bucket

            const target = currentIdentityFor(identity)
            if (!target || !target.bucket) {
                skipped.push({ noteId: note.noteId, key: idKey(identity), title: note.title, reason: "no current area/template matches" })
                continue
            }
            const liveKey = idKey(target)
            liveIdentityByKey[liveKey] = target
            ;(groups[liveKey] || (groups[liveKey] = [])).push({
                note, wasStale: liveKey !== idKey(identity), untagged: false
            })
        }

        // 2. Scenario B: pull in same-titled twins that carry NO bucket label —
        //    a bucket provisioning created, then orphaned when the tagged one was
        //    adopted instead. For each known live bucket identity, look under the
        //    same area root for such siblings sharing a group member's title.
        //
        //    A title match alone is NOT sufficient evidence. These candidates are
        //    the only notes here that carry no identity label of their own, so a
        //    plain title match would sweep in any hand-made note that happens to
        //    share a bucket's title ("Notes", "Inbox", "Reading") and delete it at
        //    step 3. Require positive proof the note came from provisioning:
        //    either the legacy identity label, or the bucket ~template that
        //    provisionNode stamps on every bucket it creates. A user's own note
        //    has neither.
        function isProvisioned(n) {
            if (n.getLabelValue(labels.legacy)) return true
            const tpl = n.getRelationValue("template") || ""
            return templateIds.has(tpl)
        }

        for (const [liveKey, members] of Object.entries(groups)) {
            const target = liveIdentityByKey[liveKey]
            const root = areaRoots[target.area]
            if (!root) continue
            const titles = new Set(members.map(m => m.note.title))
            const known = new Set(members.map(m => m.note.noteId))
            for (const child of root.getChildNotes()) {
                if (known.has(child.noteId)) continue
                if (child.getLabelValue(labels.bucket)) continue  // has its own identity
                if (!titles.has(child.title)) continue
                if (!isProvisioned(child)) {
                    skipped.push({
                        noteId: child.noteId, key: liveKey, title: child.title,
                        reason: "untagged same-titled note with no provisioning marker; left alone"
                    })
                    continue
                }
                members.push({ note: child, wasStale: true, untagged: true })
            }
        }

        // 3. Fold each group down to one survivor.
        for (const [liveKey, members] of Object.entries(groups)) {
            const target = liveIdentityByKey[liveKey]

            // Survivor: prefer a member ALREADY at the live identity (not stale,
            // not an untagged twin), then heaviest, then lowest noteId.
            members.sort((a, b) => {
                if (a.wasStale !== b.wasStale) return a.wasStale ? 1 : -1
                const wa = weightOf(a.note), wb = weightOf(b.note)
                if (wa !== wb) return wb - wa
                return a.note.noteId < b.note.noteId ? -1 : 1
            })
            const survivor = members[0].note
            const husks = members.slice(1)

            // Ensure the survivor carries the live identity (a whole group that
            // drifted has a stale/untagged survivor, re-keyed here).
            if (!dryRun && (members[0].wasStale || members[0].untagged)) {
                survivor.setLabel(labels.area, target.area)
                survivor.setLabel(labels.bucket, target.bucket)
                survivor.removeLabel("agendaOrganizeMerged")
            }
            if (husks.length === 0) {
                // Lone bucket. Only report it if it was re-keyed in place.
                if (members[0].wasStale || members[0].untagged) {
                    merges.push({
                        fromNoteId: survivor.noteId, fromKey: idKey(identityOf(survivor)),
                        fromTitle: survivor.title, toNoteId: survivor.noteId, toKey: liveKey,
                        toTitle: survivor.title, movedCount: 0, movedTitles: [],
                        movedContent: false, deleted: false, keptReason: "", rekeyedInPlace: true
                    })
                }
                continue
            }

            for (const { note } of husks) {
                const fromKey = idKey(identityOf(note))
                const children = note.getChildNotes()
                const movedTitles = children.map(c => c.title)
                const huskBody = bodyOf(note)
                const movedContent = !isBlank(huskBody)
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

                    // Migrate the husk's own body onto the survivor before
                    // emptying it, so deletion can't drop content.
                    let contentStuck = false
                    if (movedContent) {
                        const survivorNote = api.getNote(survivor.noteId)
                        if (survivorNote && survivorNote.type === "text") {
                            const existing = bodyOf(survivorNote)
                            survivorNote.setContent(`${existing}<h2>Merged from ${note.title}</h2>${huskBody}`)
                            note.setContent("")
                        } else {
                            contentStuck = true
                            keptReason = "survivor is not a text note; content left in place"
                        }
                    }

                    // Delete only on verified-empty: every child confirmed
                    // re-parented and the body confirmed migrated.
                    if (stuck.length > 0) {
                        keptReason = `${stuck.length} child note(s) did not move: ${stuck.join(", ")}`
                    }

                    // A husk cloned into another parent is reachable from
                    // somewhere the user put it deliberately. deleteNote() removes
                    // the note itself, not just this branch, so it would vanish
                    // from that other location too. Unclone it here and keep it.
                    if (!keptReason) {
                        const live = api.getNote(note.noteId)
                        const otherParents = live
                            ? live.getParentNotes().map(p => p.noteId).filter(id => id !== survivor.noteId)
                            : []
                        if (otherParents.length > 1) {
                            keptReason = `note is cloned into ${otherParents.length} parents; left in place`
                        }
                    }

                    if (!keptReason && !contentStuck) {
                        note.deleteNote()
                        deleted = true
                    } else {
                        // Kept for inspection -- drop the identity labels so
                        // provisioning stops resolving to it, and point at where
                        // it folded.
                        note.removeLabel(labels.area)
                        note.removeLabel(labels.bucket)
                        note.setLabel("agendaOrganizeMerged", liveKey)
                    }
                }

                merges.push({
                    fromNoteId: note.noteId, fromKey, fromTitle: note.title,
                    toNoteId: survivor.noteId, toKey: liveKey, toTitle: survivor.title,
                    movedCount: children.length, movedTitles, movedContent,
                    deleted, keptReason, rekeyedInPlace: false
                })
            }
        }

        return { merges, skipped }
    }, [areaList, templateList, AREA_ALIASES,
        { area: AREA_LABEL, bucket: BUCKET_LABEL, special: SPECIAL_LABEL, legacy: LEGACY_LABEL },
        !!dryRun])
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
// resolved parent. Top-level nodes go under "root".
//
// `dimensions` is agenda's full dimension list; the root dimension
// (scaffoldsAreas) becomes the Area notes, reduced here to the
// { slug, name, color } shape the builder and migrations expect. The per-type
// buckets no longer come from a dimension — they come straight from
// template-picker@beatlink's own enabled registry entries
// ({ noteId, name, icon }), one bucket per entry. Returns a flat result log
// [{ key, title, created, adopted, noteId, depth }] for the Setup page to show.
async function provisionStructure(dimensions, options = {}) {
    // Merging is the only step here that deletes notes. `previewMerge` reports
    // what it would fold without writing, and provisions nothing else either —
    // a walk against an unmerged tree would create duplicate buckets.
    const previewMerge = !!options.previewMerge
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

    // A preview touches nothing: report the merge plan and return before the
    // label migration, which writes.
    if (previewMerge) {
        const plan = await mergeStaleBuckets(areaList, templateList, true)
        return { results: [], migratedAreaCount: 0, merged: plan, labelMigration: null, previewOnly: true }
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

    return { results, migratedAreaCount, merged, labelMigration }
}

module.exports = {
    provisionStructure, migrateAreaSlugs, mergeStaleBuckets, migrateStructuralLabels,
    AREA_LABEL, BUCKET_LABEL, SPECIAL_LABEL
}
