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

// Renamed item templates that fold into a surviving one: old slug -> surviving
// slug. slugify() (organizeTemplates.jsx) collapses every non-alphanumeric run
// to a dash, so it cannot be inverted — once a template is renamed, nothing in
// the tree connects its old bucket key to the new slug. This map is that link;
// add an entry when renaming a template that already has buckets in the wild.
const TEMPLATE_ALIASES = {}

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

// Find buckets whose #workflowNote key is stale — created under an area or
// template name that has since been renamed, folded, or dropped — and fold each
// into the surviving bucket for the same (area, template) pair.
//
// A bucket key is "area-<areaSlug>-<templateSlug>", and BOTH halves can drift:
// the area slug renumbers on reorder (migrateAreaSlugs' problem, but for #area
// labels, not for the structural notes themselves), and a template rename
// re-slugs its buckets.
//
// The two halves resolve differently. An area slug is "<NN>-<name>", so the
// stable name survives renumbering and can be looked up directly (through
// AREA_ALIASES for folded areas) — the same trick migrateAreaSlugs uses. A
// template slug carries no such remnant: slugify() is lossy, so a renamed
// template's old slug resolves only via an explicit TEMPLATE_ALIASES entry.
// Unresolvable keys are reported in `skipped` rather than guessed at.
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
    return api.runOnBackend((areaList, templateList, aliases, templateAliases, workflowLabel, dryRun) => {
        // Current vocabularies, keyed by stable NAME rather than numbered slug.
        const areaSlugByName = {}
        for (const a of areaList) areaSlugByName[a.slug.replace(/^\d\d-/, "")] = a.slug
        const templateSlugs = new Set(templateList.map(t => t.slug))

        const tagged = api.searchForNotes(`#${workflowLabel}`)
        const byKey = {}
        for (const n of tagged) byKey[n.getLabelValue(workflowLabel)] = n

        // Split a structural key into its area and (optional) template halves.
        // Two shapes exist: an area ROOT is "area-<areaSlug>" and a BUCKET is
        // "area-<areaSlug>-<templateSlug>". A template slug may itself contain
        // dashes, so the area half is matched as the fixed "<NN>-<name>" prefix
        // and everything after it is the template slug (absent for a root).
        function splitKey(key) {
            const m = key.match(/^area-(\d\d-[a-z]+)(?:-(.+))?$/)
            if (!m) return null
            return { areaSlug: m[1], templateSlug: m[2] || "" }
        }

        // Re-key a stale structural key to what it would be in today's
        // vocabulary, or "" if either half can't be resolved. Handles roots
        // (no template half) and buckets alike.
        function currentKeyFor(parts) {
            const areaName = parts.areaSlug.replace(/^\d\d-/, "")
            const liveAreaSlug = areaSlugByName[aliases[areaName] || areaName]
            if (!liveAreaSlug) return ""
            if (!parts.templateSlug) return `area-${liveAreaSlug}`
            // slugify() is lossy (all non-alphanumerics collapse to "-"), so a
            // stale slug cannot be inverted back to a name. A renamed template's
            // old slug is only resolvable via an explicit alias.
            const t = parts.templateSlug
            const liveTemplateSlug = templateSlugs.has(t) ? t : (templateAliases[t] || "")
            if (!liveTemplateSlug || !templateSlugs.has(liveTemplateSlug)) return ""
            return `area-${liveAreaSlug}-${liveTemplateSlug}`
        }

        const merges = []
        const skipped = []

        for (const note of tagged) {
            const key = note.getLabelValue(workflowLabel)
            const parts = key ? splitKey(key) : null
            if (!parts) continue

            const targetKey = currentKeyFor(parts)
            if (!targetKey) {
                // Neither half resolves — an area or template the user removed
                // entirely. Not ours to fold; report so it's visible.
                skipped.push({ noteId: note.noteId, key, title: note.title, reason: "no current area/template matches" })
                continue
            }
            if (targetKey === key) continue

            const survivor = byKey[targetKey]
            if (!survivor) {
                // The re-keyed bucket doesn't exist yet. Don't create it here —
                // provisionStructure builds buckets; re-tagging this note to the
                // current key lets it be adopted in place instead.
                if (!dryRun) note.setLabel(workflowLabel, targetKey)
                merges.push({
                    fromNoteId: note.noteId, fromKey: key, fromTitle: note.title,
                    toNoteId: note.noteId, toKey: targetKey, toTitle: note.title,
                    movedCount: 0, movedTitles: [], hadContent: false, rekeyedInPlace: true
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
                    // Kept for inspection — drop the key so provisioning
                    // stops resolving to it, and point at where it folded.
                    note.removeLabel(workflowLabel)
                    note.setLabel("workflowNoteMerged", targetKey)
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
    }, [areaList, templateList, AREA_ALIASES, TEMPLATE_ALIASES, WORKFLOW_LABEL, !!dryRun])
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

    // Fold stale-keyed buckets BEFORE the walk. Provisioning resolves by key and
    // would otherwise create a fresh empty bucket at the current key, leaving the
    // user's content stranded in the stale one and turning a one-sided migration
    // into a two-live-bucket reconciliation.
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

    return { results, migratedAreaCount, merged }
}

module.exports = { provisionStructure, migrateAreaSlugs, mergeStaleBuckets, WORKFLOW_LABEL }
