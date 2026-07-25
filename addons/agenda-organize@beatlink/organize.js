// === Trilium Code note ===
// Title: organize.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page and organizeProvision.js).
//
// Backend helpers for the Organize phase's triage queues:
//   - getBucketTemplates(): template-picker@beatlink's own registry, resolved
//     via its #templatePickerConfig anchor — the vocabulary for item TYPE, which
//     is no longer an agenda dimension (see below).
//   - getOrganizeCandidates(): every note under the Inbox or an Area subtree, with
//     its per-dimension assigned value + suggested value (nearest ancestor's),
//     plus its tree path, content preview, start-date flag and subtask flag.
//   - getMisfiledNotes(): notes whose area/bucket disagrees with where they're filed.
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
// Scope note: only notes UNDER the Inbox and the Area roots are surfaced. The
// structural notes themselves (anything carrying #agendaOrganizeArea or
// #agendaOrganizeSpecial — the areas, the buckets, Inbox/My Day/Agenda) are
// excluded; they're containers, not items.
//
// One backend round-trip collects the candidate list once (runOnBackend closures
// are isolated and can't share helpers), and the frontend filters it into each
// queue — cheaper and simpler than a separate walk per queue.

const { getTemplates } = require("templateRegistry.jsx")
const { loadSettings } = require("libSettingsUI.jsx")

// Structural identity labels (written by organizeProvision.js). An area root has
// `area` only; a bucket has `area` + `bucket`; the Inbox / My Day / Agenda
// singletons have `special`.
const LABELS = {
    area: "agendaOrganizeArea",
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
        // Scope roots: the Inbox note + every Area root. An area root carries
        // the area label and NO bucket label; a bucket carries both and is NOT a
        // scope root (its contents are still reached by descending from the area
        // root).
        const areaTagged = api.searchForNotes(`#${labels.area}`)
        const specialTagged = api.searchForNotes(`#${labels.special}`)
        const rootNotes = areaTagged
            .filter(n => !n.getLabelValue(labels.bucket))
            .concat(specialTagged.filter(n => n.getLabelValue(labels.special) === "inbox"))

        // Any note carrying a structural identity label is scaffolding — never a
        // triage item.
        const structuralIds = new Set(
            areaTagged.concat(specialTagged).map(n => n.noteId))

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

// Find notes whose area or bucket disagrees with where they're filed. The tree
// has two scaffolding axes: an Area root per value of the area dimension, and a
// bucket per enabled template-picker entry inside each. A note under
// "Home > Task" implies #area=home and ~template=<Task's noteId>; it's misfiled
// if its own #<rootLabel> differs from the ancestor Area, or its own ~template
// differs from the ancestor bucket's. Only notes inside an Area subtree are
// checked (Inbox notes aren't filed yet).
//
// `rootDim` is the area-scaffolding dimension ({ label, values: [{ key, name,
// color }] }). `bucketTemplates` is template-picker's registry
// ([{ noteId, name, color, ... }], as returned by getBucketTemplates). Returns
// per note:
//   { noteId, title, path, preview,
//     areaMisfiled, typeMisfiled,
//     branchArea, branchBucket, noteArea, noteTemplateTitle,
//     fixes: { moveTargetNoteId, moveTargetLabel, updateAreaTo, updateAreaColor,
//              updateTemplateTo, updateTemplateToTitle } }
// `branchBucket` is the ancestor bucket's ~template noteId. `updateTemplateTo` is
// that noteId (not a slug) so the frontend sets ~template directly.
async function getMisfiledNotes(rootDim, bucketTemplates) {
    return api.runOnBackend((labels, rootDim, bucketTemplates) => {
        const rootLabel = rootDim.label
        const areaTagged = api.searchForNotes(`#${labels.area}`)
        const specialTagged = api.searchForNotes(`#${labels.special}`)
        const structuralIds = new Set(
            areaTagged.concat(specialTagged).map(n => n.noteId))

        // Index structural notes by "<areaKey>" / "<areaKey> <bucketNoteId>" so
        // we can resolve "the Task bucket under the Home area" -> a real noteId.
        const idKey = (areaKey, bucketId) => bucketId ? `${areaKey} ${bucketId}` : areaKey
        const byKey = {}
        for (const n of areaTagged) {
            byKey[idKey(n.getLabelValue(labels.area), n.getLabelValue(labels.bucket))] = n
        }

        // Area roots carry the area label and no bucket label.
        const areaRootNotes = areaTagged.filter(n => !n.getLabelValue(labels.bucket))

        const colorByKey = {}
        for (const v of rootDim.values) colorByKey[v.key] = v.color || ""

        // bucket ~template noteId -> display name (for the "Set type to …" button).
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

        // Nearest ancestor Area's root value, and nearest ancestor bucket's
        // ~template noteId — both read straight off the structural identity
        // labels (#agendaOrganizeArea / #agendaOrganizeBucket) that scaffolding
        // carries, so no key parsing is involved.
        function branchContext(note) {
            let branchArea = ""
            let branchBucket = ""
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root") {
                if (!branchBucket) {
                    const b = cur.getLabelValue(labels.bucket)
                    if (b) branchBucket = b
                }
                if (!branchArea) {
                    const a = cur.getLabelValue(labels.area)
                    if (a) branchArea = a
                }
                cur = cur.getParentNotes()[0]
            }
            return { branchArea, branchBucket }
        }

        const seen = new Set()
        const out = []

        function visit(note) {
            for (const child of note.getChildNotes()) {
                if (seen.has(child.noteId)) continue
                seen.add(child.noteId)
                let flagged = false
                if (!structuralIds.has(child.noteId)) {
                    const { branchArea, branchBucket } = branchContext(child)
                    const noteArea = child.getLabelValue(rootLabel) || ""
                    const noteBucket = child.getRelationValue("template") || ""
                    const noteTemplateTitle = noteBucket ? (bucketNameByKey[noteBucket] || "") : ""

                    const areaMisfiled = !!noteArea && !!branchArea && noteArea !== branchArea
                    // A note with no ~template is never type-misfiled (we don't
                    // know where it belongs).
                    const typeMisfiled = !!noteBucket && !!branchBucket && noteBucket !== branchBucket

                    if (areaMisfiled || typeMisfiled) {
                        flagged = true
                        // Move target: the note's correct Area (by its own root
                        // value) and, if it has a ~template, that bucket under
                        // that area. Best-effort — fall back to the area root, or
                        // the current area when the note's own value is unknown.
                        let moveTargetNoteId = ""
                        let moveTargetLabel = ""
                        const destAreaKey = noteArea || branchArea
                        const destBucketKey = noteBucket || branchBucket
                        if (destAreaKey) {
                            const target = (destBucketKey && byKey[idKey(destAreaKey, destBucketKey)])
                                || byKey[idKey(destAreaKey, "")]
                            if (target) {
                                moveTargetNoteId = target.noteId
                                moveTargetLabel = pathOf(target) + (pathOf(target) ? " › " : "") + target.title
                            }
                        }

                        // "Set type" fix: adopt the branch bucket's own ~template.
                        const canonicalTitle = branchBucket ? (bucketNameByKey[branchBucket] || "") : ""

                        // The branch this note is filed under (its parent in this
                        // subtree walk) — what a move removes it from.
                        const currentParentId = note.noteId

                        out.push({
                            noteId: child.noteId,
                            title: child.title,
                            path: pathOf(child),
                            preview: previewOf(child),
                            currentParentId,
                            areaMisfiled,
                            typeMisfiled,
                            branchArea,
                            branchBucket,
                            noteArea,
                            noteTemplateTitle,
                            fixes: {
                                moveTargetNoteId,
                                moveTargetLabel,
                                updateAreaTo: areaMisfiled ? branchArea : "",
                                updateAreaColor: areaMisfiled ? (colorByKey[branchArea] || "") : "",
                                updateTemplateTo: typeMisfiled && branchBucket ? branchBucket : "",
                                updateTemplateToTitle: typeMisfiled && branchBucket ? canonicalTitle : ""
                            }
                        })
                    }
                }
                // A misfiled note's descendants inherit its (wrong) branch context,
                // so they'd all be flagged for a problem that moving this one note
                // fixes. Report the topmost offender only; the subtree is re-checked
                // on the next load, after the move.
                if (!flagged) visit(child)
            }
        }

        for (const root of areaRootNotes) visit(root)
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

// Find INVALID buckets: structural bucket notes whose identity no longer maps to
// a current vocabulary. A bucket carries #agendaOrganizeArea=<areaSlug> plus
// #agendaOrganizeBucket=<templateNoteId>; it's invalid when its area slug is not
// a current area-dimension value OR its bucket noteId is not a current enabled
// template-picker entry — the orphan left behind when the user deletes/disables
// an Area value or a template, or deletes the template note itself.
//
// `rootDim` is the area-scaffolding dimension ({ label, values: [{ key, name }] }).
// `bucketTemplates` is template-picker's registry ([{ noteId, name, ... }]).
// Returns
//   { invalid: [{ noteId, title, path, area, bucket, childCount,
//                 areaInvalid, bucketInvalid, reason }],
//     targets: [{ noteId, label }] }
// where `targets` is every VALID bucket (a merge destination), labelled by its
// tree path so the user can tell "Home › Tasks" from "Career › Tasks".
async function getInvalidBuckets(rootDim, bucketTemplates) {
    return api.runOnBackend((labels, rootDim, bucketTemplates) => {
        const areaKeys = new Set(rootDim.values.map(v => v.key))
        const bucketKeys = new Set(bucketTemplates.map(t => t.noteId))
        const areaNameByKey = {}
        for (const v of rootDim.values) areaNameByKey[v.key] = v.name
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

        // Every structural bucket: carries the bucket label (area roots don't).
        const bucketNotes = api.searchForNotes(`#${labels.bucket}`)

        const invalid = []
        const targets = []
        for (const note of bucketNotes) {
            const area = note.getLabelValue(labels.area) || ""
            const bucket = note.getLabelValue(labels.bucket) || ""
            const areaInvalid = !areaKeys.has(area)
            const bucketInvalid = !bucketKeys.has(bucket)

            if (!areaInvalid && !bucketInvalid) {
                // A valid bucket — offer it as a merge destination.
                const path = pathOf(note)
                targets.push({
                    noteId: note.noteId,
                    label: (path ? path + " › " : "") + note.title
                })
                continue
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
        return { invalid, targets }
    }, [LABELS, rootDim, bucketTemplates])
}

// Merge one bucket into another: move every child of `fromNoteId` into
// `toNoteId`, append the source's own body under a heading (buckets are usually
// empty, but losing content would be data loss), then delete the emptied source
// — but ONLY after confirming it has no remaining children and no content, the
// same verified-empty discipline mergeStaleBuckets uses (deleting a note the user
// may have filled is the one irreversible step). Returns
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
// cascade delete, the same call TAM uses to remove notes.
async function deleteNote(noteId) {
    return api.runOnBackend((noteId) => {
        const note = api.getNote(noteId)
        if (!note) return false
        note.deleteNote()
        return true
    }, [noteId])
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
