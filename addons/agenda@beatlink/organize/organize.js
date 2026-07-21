// === Trilium Code note ===
// Title: organize.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page).
//
// Backend helpers for the Organize phase's triage queues:
//   - getOrganizeCandidates(): every note under the Inbox or an Area subtree, with
//     its per-dimension assigned value + suggested value (nearest ancestor's),
//     plus its tree path, content preview, start-date flag and subtask flag.
//   - getMisfiledNotes(): notes whose area/type disagrees with where they're filed.
//   - deleteNote / refileNote: the per-note mutations. Dimension writes live in
//     dimensions.assignDimension, shared with the Task pane.
//
// The vocabulary is agenda's own `dimensions` config (dimensions.getDimensions),
// loaded by the page and passed in. A dimension is one note label plus its
// ordered values; the type dimension additionally scaffolds buckets and marks
// some values `actionable`, and one dimension scaffolds Area roots — see the
// `rootDim`/`bucketDim` arguments below.
//
// Scope note: only notes UNDER the Inbox and the Area roots are surfaced. The
// structural notes themselves (anything carrying #agendaOrganizeArea or
// #agendaOrganizeSpecial — the areas, the buckets, Inbox/My Day/Agenda) are
// excluded; they're containers, not items.
//
// One backend round-trip collects the candidate list once (runOnBackend closures
// are isolated and can't share helpers), and the frontend filters it into each
// queue — cheaper and simpler than a separate walk per queue.

// Structural identity labels (written by organizeProvision.js). An area root has
// `area` only; a bucket has `area` + `bucket`; the Inbox / My Day / Agenda
// singletons have `special`.
const LABELS = {
    area: "agendaOrganizeArea",
    bucket: "agendaOrganizeBucket",
    special: "agendaOrganizeSpecial"
}

// Collect every non-structural note under the Inbox / Area subtrees, each with:
//   { noteId, title, path, preview, assigned, suggested, hasStartDate, isSubtask,
//     type }
// where `assigned` is { [dimension.label]: value } (the note's own value per
// dimension, "" if unset) and `suggested` is the nearest ancestor's value per
// dimension (used to pre-highlight a queue button). The frontend filters this
// into the per-queue work lists (one queue per triaged dimension, plus start
// date). `type` is the note's #type value, so the frontend can gate the
// actionable-only queues without a second walk.
//
// `dimensionLabels` is the ordered list of every dimension's note label.
// `actionableTypes` is the set of #type values marked actionable (routine/task/
// future/project by default). `isSubtask` marks a note whose primary parent is
// itself an actionable-type note (excluded from the no-start-date queue — it's
// scheduled with its parent).
async function getOrganizeCandidates(dimensionLabels, actionableTypes) {
    return api.runOnBackend((labels, dimensionLabels, actionableTypes) => {
        const actionableSet = new Set(actionableTypes)
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
        // note (its #type is an actionable value). Subtasks are managed under
        // their parent, so they're excluded from the "no start date" queue
        // (scheduled with the parent, not on their own).
        function parentIsActionable(note) {
            const parent = note.getParentNotes()[0]
            if (!parent) return false
            return actionableSet.has(parent.getLabelValue("type") || "")
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
                        type: child.getLabelValue("type") || "",
                        hasStartDate: !!child.getLabelValue("startDateTime"),
                        isSubtask: parentIsActionable(child)
                    })
                }
                visit(child)
            }
        }

        for (const root of rootNotes) visit(root)
        return out
    }, [LABELS, dimensionLabels, actionableTypes])
}

// Find notes whose area or type disagrees with where they're filed. The tree has
// two scaffolding axes: an Area root per value of the root dimension, and a
// bucket per value of the bucket dimension inside each root. A note under
// "Home > Task" implies #area=home and #type=task; it's misfiled if its own
// #<rootLabel> differs from the ancestor Area, or its own #<bucketLabel> differs
// from the ancestor bucket. Only notes inside an Area subtree are checked (Inbox
// notes aren't filed yet).
//
// `rootDim` / `bucketDim` are the two designated dimensions
// ({ label, values: [{ key, name, color }] }). Returns per note:
//   { noteId, title, path, preview,
//     areaMisfiled, typeMisfiled,
//     branchArea, branchBucket, noteArea, noteTemplateTitle,
//     fixes: { moveTargetNoteId, moveTargetLabel, updateAreaTo, updateAreaColor,
//              updateTypeTo, updateTypeToTitle } }
// `branchBucket` is the ancestor bucket's value key. `updateTypeTo` is the value
// KEY (not a note id) so the frontend assigns it through assignDimension.
async function getMisfiledNotes(rootDim, bucketDim) {
    return api.runOnBackend((labels, rootDim, bucketDim) => {
        const rootLabel = rootDim.label
        const bucketLabel = bucketDim.label
        const areaTagged = api.searchForNotes(`#${labels.area}`)
        const specialTagged = api.searchForNotes(`#${labels.special}`)
        const structuralIds = new Set(
            areaTagged.concat(specialTagged).map(n => n.noteId))

        // Index structural notes by "<areaKey>" / "<areaKey> <bucketKey>" so we
        // can resolve "the Task bucket under the Home area" -> a real noteId.
        const idKey = (areaKey, bucketKey) => bucketKey ? `${areaKey} ${bucketKey}` : areaKey
        const byKey = {}
        for (const n of areaTagged) {
            byKey[idKey(n.getLabelValue(labels.area), n.getLabelValue(labels.bucket))] = n
        }

        // Area roots carry the area label and no bucket label.
        const areaRootNotes = areaTagged.filter(n => !n.getLabelValue(labels.bucket))

        const colorByKey = {}
        for (const v of rootDim.values) colorByKey[v.key] = v.color || ""

        // bucket value key -> display name (for the "Set type to …" button).
        const bucketNameByKey = {}
        for (const v of bucketDim.values) bucketNameByKey[v.key] = v.name

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
        // value — both read straight off the structural identity labels
        // (#agendaOrganizeArea / #agendaOrganizeBucket) that scaffolding carries,
        // so no key parsing is involved.
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
                    const noteBucket = child.getLabelValue(bucketLabel) || ""
                    const noteTemplateTitle = noteBucket ? (bucketNameByKey[noteBucket] || noteBucket) : ""

                    const areaMisfiled = !!noteArea && !!branchArea && noteArea !== branchArea
                    // A note with no bucket value is never type-misfiled (we don't
                    // know where it belongs).
                    const typeMisfiled = !!noteBucket && !!branchBucket && noteBucket !== branchBucket

                    if (areaMisfiled || typeMisfiled) {
                        flagged = true
                        // Move target: the note's correct Area (by its own root
                        // value) and, if it has a bucket value, that bucket under
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

                        // "Set type" fix: adopt the branch bucket's own value key.
                        const canonicalTitle = branchBucket ? (bucketNameByKey[branchBucket] || branchBucket) : ""

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
                                updateTypeTo: typeMisfiled && branchBucket ? branchBucket : "",
                                updateTypeToTitle: typeMisfiled && branchBucket ? canonicalTitle : ""
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
    }, [LABELS, rootDim, bucketDim])
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
    getOrganizeCandidates,
    getMisfiledNotes,
    assignStartDate,
    refileNote,
    deleteNote
}
