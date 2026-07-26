// === Trilium Code note ===
// Title: organize.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page).
//
// Backend helpers for the Organize phase's triage queues:
//   - getBucketTemplates(): template-picker@beatlink's own registry, resolved
//     via its #templatePickerConfig anchor — the vocabulary for item TYPE, which
//     is no longer an agenda dimension (see below).
//   - getOrganizeCandidates(): every note under the Inbox or an Area subtree, with
//     its per-dimension assigned value + suggested value (nearest ancestor's),
//     plus its tree path, content preview, start-date flag and subtask flag.
//   - getMisfiledNotes(): notes whose own area/template disagrees with the
//     top-level root they're filed under, on that root's axis.
//   - deleteNote / refileNote: the per-note mutations. Dimension writes live in
//     dimensions.assignDimension, shared with the Task pane.
//
// The classification vocabulary is agenda's own `dimensions` config
// (dimensions.getDimensions) for everything except item TYPE. A note's type used
// to be a #type label backed by agenda's own `type` dimension; it is now purely
// its ~template relation, resolved against template-picker@beatlink's registry
// (one-directional cross-addon read — agenda depends on template-picker, not the
// other way around). Bucket scaffolding, the misfiled-bucket check, and the
// actionable-item set all key on that registry's templateNoteId now, never on a
// string slug.
//
// Structure: two PARALLEL top-level trees, each one level deep — one root per
// area, one root per template — with a filed item cloned into both (its area
// root and its type root). See agenda-structure@beatlink's structure.js.
//
// Scope note: only notes UNDER the Inbox, the Area roots and the Type roots are
// surfaced, de-duped by noteId since a filed item is reachable from two roots.
// The structural notes themselves (anything carrying #agendaOrganizeArea,
// #agendaOrganizeType or #agendaOrganizeSpecial) are excluded; they're
// containers, not items.
//
// One backend round-trip collects the candidate list once (runOnBackend closures
// are isolated and can't share helpers), and the frontend filters it into each
// queue — cheaper and simpler than a separate walk per queue.

const { getTemplates } = require("templateRegistry.jsx")
const { loadSettings } = require("libSettingsUI.jsx")

// Structural identity labels (written by agenda-structure@beatlink), one per kind of
// top-level root and mutually exclusive: an area root has `area`, a type root
// has `type`, the Inbox / My Day / Agenda singletons have `special`.
//
// `bucket` marked a per-area type bucket under the old nested shape. Nothing
// writes it any more; it is still read so a legacy bucket (which also carries
// `area`) is not mistaken for an area root.
const LABELS = {
    area: "agendaOrganizeArea",
    type: "agendaOrganizeType",
    bucket: "agendaOrganizeBucket",
    special: "agendaOrganizeSpecial"
}

// Resolve template-picker's own settings note ids via its #templatePickerConfig
// anchor — the same discovery shape dimensions.js uses for agenda's own config,
// pointed at a different addon's settings note. One-directional: template-picker
// never reads anything back from agenda.
async function getTemplatePickerConfigIds() {
    const anchors = await api.searchForNotes("#templatePickerConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// template-picker's enabled templates — the vocabulary for item TYPE. Returns []
// when template-picker isn't discoverable, so callers degrade to "no templates"
// rather than throw. [{ id, noteId, name, enabled, color, actionable, icon }],
// `noteId` (the ~template target) is what everything else in this file keys on.
async function getBucketTemplates() {
    const ids = await getTemplatePickerConfigIds()
    if (!ids) return []
    const all = await getTemplates(ids.schemaNoteId, ids.configNoteId)
    return all.filter(t => t.enabled)
}

// Collect every non-structural note under the Inbox / Area subtrees, each with:
//   { noteId, title, path, preview, assigned, suggested, hasStartDate, isSubtask,
//     templateId }
// where `assigned` is { [dimension.label]: value } (the note's own value per
// dimension, "" if unset) and `suggested` is the nearest ancestor's value per
// dimension (used to pre-highlight a queue button). The frontend filters this
// into the per-queue work lists (one queue per triaged dimension, plus start
// date). `templateId` is the note's ~template relation target (or ""), so the
// frontend can gate the actionable-only queues without a second walk.
//
// `dimensionLabels` is the ordered list of every dimension's note label (area,
// priority, any user-added — no longer includes type). `actionableTemplateIds`
// is the set of ~template noteIds marked actionable in template-picker's
// registry. `isSubtask` marks a note whose primary parent's own ~template is
// itself actionable (excluded from the no-start-date queue — it's scheduled
// with its parent).
async function getOrganizeCandidates(dimensionLabels, actionableTemplateIds) {
    return api.runOnBackend((labels, dimensionLabels, actionableTemplateIds) => {
        const actionableSet = new Set(actionableTemplateIds)
        // Scope roots: the Inbox note + every Area root + every Type root. An
        // area root carries the area label and NO bucket label (a legacy nested
        // bucket carries both, and is reached by descending anyway). A note
        // filed in both trees is a clone reachable from two roots, so the walk
        // dedupes by noteId and each item is collected once.
        const areaTagged = api.searchForNotes(`#${labels.area}`)
        const typeTagged = api.searchForNotes(`#${labels.type}`)
        const specialTagged = api.searchForNotes(`#${labels.special}`)
        const rootNotes = areaTagged
            .filter(n => !n.getLabelValue(labels.bucket))
            .concat(typeTagged)
            .concat(specialTagged.filter(n => n.getLabelValue(labels.special) === "inbox"))

        // Any note carrying a structural identity label is scaffolding — never a
        // triage item.
        const structuralIds = new Set(
            areaTagged.concat(typeTagged).concat(specialTagged).map(n => n.noteId))

        // Ancestor breadcrumb: walk primary parents up to (but excluding) root.
        function pathOf(note) {
            const parts = []
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root") {
                parts.unshift(cur.title)
                cur = cur.getParentNotes()[0]
            }
            return parts.join(" › ")
        }

        // For each dimension label, the nearest ancestor's value ("" if none) —
        // used to pre-suggest a value for a note already filed inside a subtree
        // that implies one (e.g. #area from the ancestor Area root).
        function ancestorValues(note) {
            const found = {}
            let remaining = dimensionLabels.length
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root" && remaining > 0) {
                for (const label of dimensionLabels) {
                    if (found[label]) continue
                    const v = cur.getLabelValue(label)
                    if (v) { found[label] = v; remaining-- }
                }
                cur = cur.getParentNotes()[0]
            }
            const out = {}
            for (const label of dimensionLabels) out[label] = found[label] || ""
            return out
        }

        // A short plain-text preview of the note's opening content. Only text
        // notes carry HTML content worth previewing; anything else (code, images,
        // etc.) gets an empty preview. Strips tags, decodes a few common entities,
        // collapses whitespace, and truncates.
        const PREVIEW_MAX = 240
        function previewOf(note) {
            if (note.type !== "text") return ""
            let content
            try {
                content = note.getContent()
            } catch (e) {
                return ""
            }
            if (!content || typeof content !== "string") return ""
            const text = content
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/g, " ")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/\s+/g, " ")
                .trim()
            return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) + "…" : text
        }

        // A note is a subtask when its primary parent is itself an actionable
        // note (its ~template is an actionable template). Subtasks are managed
        // under their parent, so they're excluded from the "no start date" queue
        // (scheduled with the parent, not on their own).
        function parentIsActionable(note) {
            const parent = note.getParentNotes()[0]
            if (!parent) return false
            return actionableSet.has(parent.getRelationValue("template") || "")
        }

        // Collect descendants of the scope roots, de-duped (a note can be cloned
        // under more than one scope root).
        const seen = new Set()
        const out = []

        function visit(note) {
            for (const child of note.getChildNotes()) {
                if (seen.has(child.noteId)) continue
                seen.add(child.noteId)
                if (!structuralIds.has(child.noteId)) {
                    const assigned = {}
                    for (const label of dimensionLabels) {
                        assigned[label] = child.getLabelValue(label) || ""
                    }
                    out.push({
                        noteId: child.noteId,
                        title: child.title,
                        path: pathOf(child),
                        preview: previewOf(child),
                        assigned,
                        suggested: ancestorValues(child),
                        templateId: child.getRelationValue("template") || "",
                        hasStartDate: !!child.getLabelValue("startDateTime"),
                        isSubtask: parentIsActionable(child)
                    })
                }
                visit(child)
            }
        }

        for (const root of rootNotes) visit(root)
        return out
    }, [LABELS, dimensionLabels, actionableTemplateIds])
}

// Find notes filed under a root that disagrees with the note's own labels. The
// tree has two PARALLEL top-level axes: an Area root per value of the area
// dimension, and a Type root per enabled template-picker entry. Neither nests
// the other, and a fully-filed item is cloned into exactly one of each.
//
// A note is checked once per structural parent it sits under, and the axis of
// that parent decides what is compared:
//   - under an Area root: its own #<rootLabel> must match that root's area
//   - under a Type root:  its own ~template must match that root's template
// A note filed under only one of the two axes is not "misfiled" — it's
// incompletely filed, which the per-dimension queues already cover; flagging it
// here would double-report every note the user hasn't finished triaging.
//
// Only notes under a structural root are checked (Inbox notes aren't filed yet).
// Descendants are walked too, inheriting the root they hang under, so a subtask
// filed beneath a misfiled parent is reported only once the parent is fixed.
//
// `rootDim` is the area-scaffolding dimension ({ label, values: [{ key, name,
// color }] }). `bucketTemplates` is template-picker's registry
// ([{ noteId, name, color, ... }], as returned by getBucketTemplates). Returns
// per note:
//   { noteId, title, path, preview, currentParentId,
//     areaMisfiled, typeMisfiled,
//     branchArea, branchBucket, noteArea, noteTemplateTitle,
//     fixes: { moveTargetNoteId, moveTargetLabel, updateAreaTo, updateAreaColor,
//              updateTemplateTo, updateTemplateToTitle } }
// `branchArea` is the containing Area root's area key; `branchBucket` is the
// containing Type root's template noteId. `updateTemplateTo` is that noteId (not
// a slug) so the frontend sets ~template directly. `currentParentId` is the
// branch the note was found under — the one a move removes it from, leaving its
// clone on the other axis alone.
async function getMisfiledNotes(rootDim, bucketTemplates) {
    return api.runOnBackend((labels, rootDim, bucketTemplates) => {
        const rootLabel = rootDim.label
        const areaTagged = api.searchForNotes(`#${labels.area}`)
        const typeTagged = api.searchForNotes(`#${labels.type}`)
        const specialTagged = api.searchForNotes(`#${labels.special}`)
        const structuralIds = new Set(
            areaTagged.concat(typeTagged).concat(specialTagged).map(n => n.noteId))

        // Area roots carry the area label and no bucket label (a legacy nested
        // bucket carries both). Each axis is indexed by its identity value so a
        // note's own labels resolve straight to the root it belongs under.
        const areaRootNotes = areaTagged.filter(n => !n.getLabelValue(labels.bucket))
        const areaRootByKey = {}
        for (const n of areaRootNotes) areaRootByKey[n.getLabelValue(labels.area)] = n
        const typeRootById = {}
        for (const n of typeTagged) typeRootById[n.getLabelValue(labels.type)] = n

        const colorByKey = {}
        for (const v of rootDim.values) colorByKey[v.key] = v.color || ""

        // template noteId -> display name (for the "Set type to …" button).
        const bucketNameByKey = {}
        for (const t of bucketTemplates) bucketNameByKey[t.noteId] = t.name

        function pathOf(note) {
            const parts = []
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root") {
                parts.unshift(cur.title)
                cur = cur.getParentNotes()[0]
            }
            return parts.join(" › ")
        }

        const PREVIEW_MAX = 240
        function previewOf(note) {
            if (note.type !== "text") return ""
            let content
            try { content = note.getContent() } catch (e) { return "" }
            if (!content || typeof content !== "string") return ""
            const text = content
                .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim()
            return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) + "…" : text
        }

        const out = []

        // Walk one axis. `axis` is "area" or "type"; `rootValue` is the root's
        // identity value, fixed for the whole subtree beneath it. `seen` is
        // per-axis: the same note legitimately appears under both a Area root and
        // a Type root, and each visit checks a different label.
        function walkAxis(parent, axis, rootValue, seen) {
            for (const child of parent.getChildNotes()) {
                if (seen.has(child.noteId)) continue
                seen.add(child.noteId)
                if (structuralIds.has(child.noteId)) continue

                const noteArea = child.getLabelValue(rootLabel) || ""
                const noteTemplate = child.getRelationValue("template") || ""

                // Compare only the axis this branch represents. A note with no
                // value on that axis is unclassified, not misfiled — we don't
                // know where it belongs.
                const areaMisfiled = axis === "area" && !!noteArea && noteArea !== rootValue
                const typeMisfiled = axis === "type" && !!noteTemplate && noteTemplate !== rootValue

                if (areaMisfiled || typeMisfiled) {
                    // Move target: the root on THIS axis matching the note's own
                    // label — the branch it should have been filed under. The
                    // note's clone on the other axis is untouched.
                    const target = areaMisfiled
                        ? areaRootByKey[noteArea]
                        : typeRootById[noteTemplate]
                    const targetPath = target ? pathOf(target) : ""

                    out.push({
                        noteId: child.noteId,
                        title: child.title,
                        path: pathOf(child),
                        preview: previewOf(child),
                        // The branch this note was found under — what a move
                        // removes it from.
                        currentParentId: parent.noteId,
                        areaMisfiled,
                        typeMisfiled,
                        branchArea: axis === "area" ? rootValue : "",
                        branchBucket: axis === "type" ? rootValue : "",
                        noteArea,
                        noteTemplateTitle: noteTemplate ? (bucketNameByKey[noteTemplate] || "") : "",
                        fixes: {
                            moveTargetNoteId: target ? target.noteId : "",
                            moveTargetLabel: target
                                ? targetPath + (targetPath ? " › " : "") + target.title
                                : "",
                            // The other fix direction: keep the note where it is
                            // and adopt the root's own value instead.
                            updateAreaTo: areaMisfiled ? rootValue : "",
                            updateAreaColor: areaMisfiled ? (colorByKey[rootValue] || "") : "",
                            updateTemplateTo: typeMisfiled ? rootValue : "",
                            updateTemplateToTitle: typeMisfiled ? (bucketNameByKey[rootValue] || "") : ""
                        }
                    })
                    // A misfiled note's descendants inherit its wrong branch, so
                    // they'd all be flagged for a problem this one move fixes.
                    // Report the topmost offender only; the subtree is re-checked
                    // on the next load, after the move.
                    continue
                }

                walkAxis(child, axis, rootValue, seen)
            }
        }

        const areaSeen = new Set()
        for (const root of areaRootNotes) {
            walkAxis(root, "area", root.getLabelValue(labels.area), areaSeen)
        }
        const typeSeen = new Set()
        for (const root of typeTagged) {
            walkAxis(root, "type", root.getLabelValue(labels.type), typeSeen)
        }
        return out
    }, [LABELS, rootDim, bucketTemplates])
}

// Move a note from one parent branch to another (add to new, remove from old),
// using Trilium's toggleNoteInParent primitive — the same re-file mechanic
// libAgendaOverview uses. Only touches the one misfiled branch (fromParentId),
// leaving any other clones of the note in place.
async function refileNote(noteId, fromParentId, toParentId) {
    return api.runOnBackend((noteId, fromParentId, toParentId) => {
        if (!toParentId || fromParentId === toParentId) return false
        api.toggleNoteInParent(true, noteId, toParentId, "")
        if (fromParentId) api.toggleNoteInParent(false, noteId, fromParentId, "")
        return true
    }, [noteId, fromParentId, toParentId])
}

// Assign a note's start date. Writes the three coordinated labels agenda reads:
// #startDateTime (master, "YYYY-MM-DDTHH:mm") plus derived #startDate
// ("YYYY-MM-DD") and #startTime ("HH:mm"), using agenda's default label names.
// dateStr is "YYYY-MM-DD", timeStr is "HH:mm".
async function assignStartDate(noteId, dateStr, timeStr) {
    return api.runOnBackend((noteId, dateStr, timeStr) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (dateStr && timeStr) {
            note.setLabel("startDateTime", `${dateStr}T${timeStr}`)
            note.setLabel("startDate", dateStr)
            note.setLabel("startTime", timeStr)
        }
        return true
    }, [noteId, dateStr, timeStr])
}

// Assign (or clear) a note's ~template relation directly — used by the misfiled
// queue's "Set type" fix, which adopts the branch bucket's own template rather
// than going through dimensions.assignDimension (there is no type dimension to
// route it through any more).
async function assignTemplate(noteId, templateNoteId) {
    return api.runOnBackend((noteId, templateNoteId) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (templateNoteId) note.setRelation("template", templateNoteId)
        else note.removeRelation("template")
        return true
    }, [noteId, templateNoteId])
}

// Find INVALID roots: structural container notes whose identity no longer maps
// to a current vocabulary — the orphan left behind when the user deletes or
// disables an Area value or a template, or deletes a template note outright.
// Both top-level axes are checked:
//   - an Area root (#agendaOrganizeArea=<areaSlug>) is invalid when its slug is
//     not a current area-dimension value;
//   - a Type root (#agendaOrganizeType=<templateNoteId>) is invalid when its
//     noteId is not a current enabled template-picker entry.
// Legacy nested buckets (carrying #agendaOrganizeBucket alongside an area label)
// are reported too, on the area half only — the flat structure never recreates
// them, so merging one away is exactly the cleanup the user wants.
//
// A root is only ever compared against its OWN axis: an Area root has no
// template and a Type root has no area, so neither is judged on a value it was
// never meant to carry.
//
// `rootDim` is the area-scaffolding dimension ({ label, values: [{ key, name }] }).
// `bucketTemplates` is template-picker's registry ([{ noteId, name, ... }]).
// Returns
//   { invalid: [{ noteId, title, path, area, bucket, childCount,
//                 areaInvalid, bucketInvalid, reason }],
//     targets: [{ noteId, label }] }
// where `targets` is every VALID root (a merge destination), labelled by its
// tree path.
async function getInvalidBuckets(rootDim, bucketTemplates) {
    return api.runOnBackend((labels, rootDim, bucketTemplates) => {
        const areaKeys = new Set(rootDim.values.map(v => v.key))
        const bucketKeys = new Set(bucketTemplates.map(t => t.noteId))
        const bucketNameByKey = {}
        for (const t of bucketTemplates) bucketNameByKey[t.noteId] = t.name

        function pathOf(note) {
            const parts = []
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root") {
                parts.unshift(cur.title)
                cur = cur.getParentNotes()[0]
            }
            return parts.join(" › ")
        }

        // A type identity is a template noteId. Trees provisioned under the older
        // scheme still carry a title SLUG ("notes", "goals"), which matches no
        // noteId and would mark every such root invalid at once — offering a
        // Delete button for the user's entire structure. A slug that names a live
        // template is stale, not invalid: resolve it so those roots are treated as
        // valid. Only one resolving to neither is genuinely orphaned.
        const templateIdByTitleSlug = {}
        for (const t of bucketTemplates) {
            const slug = String(t.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
            if (slug) templateIdByTitleSlug[slug] = t.noteId
        }
        const resolveBucket = (value) =>
            bucketKeys.has(value) ? value : (templateIdByTitleSlug[value] || "")

        const invalid = []
        const targets = []

        function record(note, area, bucket, areaInvalid, bucketInvalid) {
            if (!areaInvalid && !bucketInvalid) {
                const path = pathOf(note)
                targets.push({
                    noteId: note.noteId,
                    label: (path ? path + " › " : "") + note.title
                })
                return
            }
            const reasons = []
            if (areaInvalid) reasons.push(`area "${area || "(none)"}" is not a current area`)
            if (bucketInvalid) reasons.push(`type "${bucketNameByKey[bucket] || bucket || "(none)"}" is not a current template`)
            invalid.push({
                noteId: note.noteId,
                title: note.title,
                path: pathOf(note),
                area,
                bucket,
                childCount: note.getChildNotes().length,
                areaInvalid,
                bucketInvalid,
                reason: reasons.join("; ")
            })
        }

        // Area roots and legacy nested buckets both carry the area label; both
        // are judged on their area slug alone.
        for (const note of api.searchForNotes(`#${labels.area}`)) {
            const area = note.getLabelValue(labels.area) || ""
            record(note, area, "", !areaKeys.has(area), false)
        }

        // Type roots are judged on their template noteId alone.
        for (const note of api.searchForNotes(`#${labels.type}`)) {
            const raw = note.getLabelValue(labels.type) || ""
            const bucket = resolveBucket(raw) || raw
            record(note, "", bucket, false, !bucketKeys.has(bucket))
        }

        return { invalid, targets }
    }, [LABELS, rootDim, bucketTemplates])
}

// Merge one structural root into another: move every child of `fromNoteId` into
// `toNoteId`, append the source's own body under a heading (roots are usually
// empty, but losing content would be data loss), then delete the emptied source
// — but ONLY after confirming it has no remaining children and no content
// (deleting a note the user may have filled is the one irreversible step).
// Returns
//   { moved, movedContent, deleted, keptReason }.
async function mergeBucketInto(fromNoteId, toNoteId) {
    return api.runOnBackend((fromNoteId, toNoteId) => {
        if (!fromNoteId || !toNoteId || fromNoteId === toNoteId) {
            return { moved: 0, movedContent: false, deleted: false, keptReason: "invalid merge target" }
        }
        const from = api.getNote(fromNoteId)
        const to = api.getNote(toNoteId)
        if (!from || !to) {
            return { moved: 0, movedContent: false, deleted: false, keptReason: "note not found" }
        }

        function bodyOf(n) {
            if (n.type !== "text") return ""
            try {
                const b = n.getContent()
                return b && typeof b === "string" ? b : ""
            } catch (e) { return "" }
        }
        function isBlank(html) {
            return !String(html || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()
        }

        // Move each child, then confirm the move from the CHILD's own parent list
        // (re-reading from.getChildNotes() would read a cached entity still listing
        // the moved children, so nothing would ever verify as empty).
        const children = from.getChildNotes()
        const stuck = []
        for (const child of children) {
            api.toggleNoteInParent(true, child.noteId, toNoteId, "")
            api.toggleNoteInParent(false, child.noteId, fromNoteId, "")
            const moved = api.getNote(child.noteId)
            const parentIds = moved ? moved.getParentNotes().map(p => p.noteId) : []
            if (!moved || parentIds.indexOf(toNoteId) === -1 || parentIds.indexOf(fromNoteId) !== -1) {
                stuck.push(child.title)
            }
        }

        // Migrate the source body before emptying it.
        const huskBody = bodyOf(from)
        const movedContent = !isBlank(huskBody)
        let contentStuck = false
        if (movedContent) {
            if (to.type === "text") {
                to.setContent(`${bodyOf(to)}<h2>Merged from ${from.title}</h2>${huskBody}`)
                from.setContent("")
            } else {
                contentStuck = true
            }
        }

        let keptReason = ""
        if (stuck.length > 0) keptReason = `${stuck.length} child note(s) did not move: ${stuck.join(", ")}`
        else if (contentStuck) keptReason = "destination is not a text note; content left in place"

        let deleted = false
        if (!keptReason) {
            from.deleteNote()
            deleted = true
        }
        return { moved: children.length, movedContent, deleted, keptReason }
    }, [fromNoteId, toNoteId])
}

// Delete a note outright (all its clones), used by the Organize queues' Delete
// action to drop junk captured into the Inbox. deleteNote() is Trilium's own
// CASCADE delete: it takes the note's whole subtree, not just the note.
//
// Two structural refusals, because this is reached from one-click table actions
// where the blast radius isn't visible:
//   - a STRUCTURAL note (an area root, a type root, a singleton, or a legacy
//     bucket) is never junk; deleting one takes everything filed under it. They
//     are emptied via mergeBucketInto, which relocates children first and only
//     deletes a verified-empty husk.
//   - a note with descendants requires an explicit acknowledgement of the count,
//     so a caller cannot cascade a subtree by accident.
// Returns { deleted, refusedReason, descendantCount }.
async function deleteNote(noteId, options = {}) {
    return api.runOnBackend((noteId, labels, allowSubtree, allowStructural) => {
        const note = api.getNote(noteId)
        if (!note) return { deleted: false, refusedReason: "note not found", descendantCount: 0 }

        if (!allowStructural &&
            (note.hasLabel(labels.area) || note.hasLabel(labels.type) ||
             note.hasLabel(labels.bucket) || note.hasLabel(labels.special))) {
            return {
                deleted: false,
                refusedReason: "refusing to delete a structural note (area root / type root); merge it instead",
                descendantCount: 0
            }
        }

        let descendantCount = 0
        const seen = {}
        ;(function count(n) {
            for (const child of n.getChildNotes()) {
                if (seen[child.noteId]) continue
                seen[child.noteId] = true
                descendantCount++
                count(child)
            }
        })(note)

        if (descendantCount > 0 && !allowSubtree) {
            return {
                deleted: false,
                refusedReason: `note has ${descendantCount} descendant(s); pass allowSubtree to delete them too`,
                descendantCount
            }
        }

        note.deleteNote()
        return { deleted: true, refusedReason: "", descendantCount }
    }, [noteId, LABELS, !!options.allowSubtree, !!options.allowStructural])
}

module.exports = {
    getBucketTemplates,
    getOrganizeCandidates,
    getMisfiledNotes,
    getInvalidBuckets,
    mergeBucketInto,
    assignStartDate,
    assignTemplate,
    refileNote,
    deleteNote
}
