// === Trilium Code note ===
// Title: workflowOrganize.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Workflow window's Organize tab).
//
// Backend helpers for the Organize phase's triage queues:
//   - getItemTemplates(): the item-type templates the "assign a template" queue offers.
//   - getAreas(): the area vocabulary the "assign an area" queue offers.
//   - getOrganizeCandidates(): every note under the Inbox or an Area subtree, with
//     the flags each queue filters on (hasTemplate / hasArea), plus its tree path,
//     a content preview, and a suggested area (nearest ancestor's #area).
//   - assignTemplate / assignArea / deleteNote: the per-note mutations.
//
// Scope note: only notes UNDER the Inbox and the Area roots are surfaced. The
// structural notes themselves (anything carrying #workflowNote — the areas, the
// buckets, Inbox/My Day/Agenda) are excluded; they're containers, not items.
//
// One backend round-trip collects the candidate list once (runOnBackend closures
// are isolated and can't share helpers), and the frontend filters it into each
// queue — cheaper and simpler than a separate walk per queue.

const { AREA_LIST, BUCKET_TEMPLATES } = require("workflowStructure.js")

const WORKFLOW_LABEL = "workflowNote"
// Title of the Task item template; a note whose primary parent carries this
// template is a subtask (see getOrganizeCandidates' parentIsTask).
const TASK_TEMPLATE_TITLE = "3. Task"

// The item-type templates offered by the "Notes Without Templates" queue, in
// workflow order. Structural templates (Area / Special) are excluded. Resolved
// live by title; a title with no matching #template note is simply omitted.
const ITEM_TEMPLATE_TITLES = [
    "0. Ideas",
    "1. Goal",
    "2. Routine",
    "3. Task",
    "4. Future",
    "5. Project",
    "6. Note"
]

// Resolve the offered item templates to real notes. Returns [{ noteId, title }]
// in ITEM_TEMPLATE_TITLES order, skipping any that don't resolve.
async function getItemTemplates() {
    return api.runOnBackend((titles) => {
        const out = []
        for (const title of titles) {
            const results = api.searchForNotes(`#template note.title = "${title}"`)
            if (results.length > 0) out.push({ noteId: results[0].noteId, title })
        }
        return out
    }, [ITEM_TEMPLATE_TITLES])
}

// The area vocabulary the "Notes Without Areas" queue offers: [{ slug, name,
// color }], straight from workflowStructure's single source of truth.
async function getAreas() {
    return AREA_LIST
}

// Collect every non-structural note under the Inbox / Area subtrees, each with:
//   { noteId, title, path, preview, hasTemplate, hasArea, hasPriority,
//     hasStartDate, isSubtask, suggestedArea }
// The frontend filters this into the per-queue work lists (untemplated, or
// no-area). `suggestedArea` is the nearest ancestor's #area value ("" if none).
// `isSubtask` marks a note whose primary parent is a Task (excluded from the
// no-start-date queue).
async function getOrganizeCandidates() {
    return api.runOnBackend((workflowLabel, taskTemplateTitle) => {
        // Scope roots: the Inbox note + every Area root. Area roots have a
        // #workflowNote value like "area-03-legal" (no trailing bucket slug);
        // buckets look like "area-03-legal-goals" and are NOT scope roots (but
        // their contents are still reached by descending from the area root).
        const tagged = api.searchForNotes(`#${workflowLabel}`)
        const isAreaRoot = v => /^area-\d\d-[a-z]+$/.test(v)
        const rootNotes = tagged.filter(n => {
            const v = n.getLabelValue(workflowLabel)
            return v === "inbox" || isAreaRoot(v)
        })

        // Every note carrying #workflowNote is structural — never a triage item.
        const structuralIds = new Set(tagged.map(n => n.noteId))

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

        // Nearest ancestor's #area value ("" if none) — used to pre-suggest the
        // area for a note already filed inside an Area subtree.
        function ancestorArea(note) {
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root") {
                const a = cur.getLabelValue("area")
                if (a) return a
                cur = cur.getParentNotes()[0]
            }
            return ""
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

        // A note is a subtask when its primary parent is itself a Task-templated
        // note. Subtasks are managed under their parent Task, so they're excluded
        // from the "no start date" queue (they don't need their own start date).
        function templateTitleOf(note) {
            const tId = note.getRelationValue("template")
            if (!tId) return ""
            const t = api.getNote(tId)
            return t ? t.title : ""
        }
        function parentIsTask(note) {
            const parent = note.getParentNotes()[0]
            return !!parent && templateTitleOf(parent) === taskTemplateTitle
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
                    const templateId = child.getRelationValue("template") || ""
                    const templateNote = templateId ? api.getNote(templateId) : null
                    out.push({
                        noteId: child.noteId,
                        title: child.title,
                        path: pathOf(child),
                        preview: previewOf(child),
                        hasTemplate: !!templateId,
                        templateTitle: templateNote ? templateNote.title : "",
                        hasArea: !!child.getLabelValue("area"),
                        hasPriority: !!child.getLabelValue("priority"),
                        hasStartDate: !!child.getLabelValue("startDateTime"),
                        isSubtask: parentIsTask(child),
                        suggestedArea: ancestorArea(child)
                    })
                }
                visit(child)
            }
        }

        for (const root of rootNotes) visit(root)
        return out
    }, [WORKFLOW_LABEL, TASK_TEMPLATE_TITLE])
}

// Find notes whose #area or ~template disagrees with where they're filed. A note
// under "Home > Projects" implies area=03-home and bucket=projects; it's misfiled
// if its own #area differs from the ancestor Area, or its ~template isn't one the
// ancestor bucket accepts. Only notes inside an Area subtree are checked (Inbox
// notes aren't filed yet). Returns per note:
//   { noteId, title, path, preview,
//     areaMisfiled, typeMisfiled,
//     branchArea, branchBucket, noteArea, noteTemplateTitle,
//     fixes: { moveTargetNoteId, moveTargetLabel, updateAreaTo, updateAreaColor,
//              updateTypeToId, updateTypeToTitle } }
// `fixes.*` are precomputed so the frontend just shows the applicable buttons.
async function getMisfiledNotes() {
    return api.runOnBackend((workflowLabel, areaList, bucketTemplates) => {
        const tagged = api.searchForNotes(`#${workflowLabel}`)
        const structuralIds = new Set(tagged.map(n => n.noteId))

        // Index the structural notes by their #workflowNote key so we can resolve
        // "the projects bucket under the home area" -> a real noteId for moves.
        const byKey = {}
        for (const n of tagged) byKey[n.getLabelValue(workflowLabel)] = n

        const isAreaRootKey = k => /^area-\d\d-[a-z]+$/.test(k)
        const areaRootNotes = tagged.filter(n => isAreaRootKey(n.getLabelValue(workflowLabel)))

        // area slug ("03-home") -> its area-root #workflowNote key ("area-03-home")
        const areaKeyBySlug = {}
        for (const a of areaList) areaKeyBySlug[a.slug] = `area-${a.slug}`
        const colorBySlug = {}
        for (const a of areaList) colorBySlug[a.slug] = a.color

        // template title -> the bucket slug that accepts it (first match wins).
        const bucketByTemplate = {}
        for (const bucket of Object.keys(bucketTemplates)) {
            for (const title of bucketTemplates[bucket]) {
                if (!(title in bucketByTemplate)) bucketByTemplate[title] = bucket
            }
        }

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

        // Nearest ancestor Area's #area, and nearest ancestor bucket's slug. A
        // bucket key looks like "area-03-home-projects"; the trailing segment is
        // the bucket slug.
        function branchContext(note) {
            let branchArea = ""
            let branchBucket = ""
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root") {
                const key = cur.getLabelValue(workflowLabel)
                if (key) {
                    if (!branchBucket) {
                        const m = key.match(/^area-\d\d-[a-z]+-([a-z]+)$/)
                        if (m) branchBucket = m[1]
                    }
                    if (!branchArea) {
                        const a = cur.getLabelValue("area")
                        if (a) branchArea = a
                    }
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
                if (!structuralIds.has(child.noteId)) {
                    const { branchArea, branchBucket } = branchContext(child)
                    const noteArea = child.getLabelValue("area") || ""
                    const templateId = child.getRelationValue("template") || ""
                    const templateNote = templateId ? api.getNote(templateId) : null
                    const noteTemplateTitle = templateNote ? templateNote.title : ""

                    const areaMisfiled = !!noteArea && !!branchArea && noteArea !== branchArea
                    const templateBucket = noteTemplateTitle ? bucketByTemplate[noteTemplateTitle] : undefined
                    const typeMisfiled = !!noteTemplateTitle && !!branchBucket &&
                        templateBucket !== undefined && templateBucket !== branchBucket

                    if (areaMisfiled || typeMisfiled) {
                        // Move target: the note's correct Area (by its #area) and,
                        // if its type maps to a bucket, that bucket under that area.
                        // Best-effort — fall back to area root, or current area if
                        // #area is unknown.
                        let moveTargetNoteId = ""
                        let moveTargetLabel = ""
                        const destAreaSlug = noteArea || branchArea
                        const destBucketSlug = templateBucket || branchBucket
                        if (destAreaSlug) {
                            const areaKey = areaKeyBySlug[destAreaSlug]
                            const bucketKey = destBucketSlug ? `${areaKey}-${destBucketSlug}` : ""
                            const target = (bucketKey && byKey[bucketKey]) || byKey[areaKey]
                            if (target) {
                                moveTargetNoteId = target.noteId
                                moveTargetLabel = pathOf(target) + (pathOf(target) ? " › " : "") + target.title
                            }
                        }

                        const bucketCanonical = branchBucket && bucketTemplates[branchBucket]
                            ? bucketTemplates[branchBucket][0] : ""
                        const canonicalNote = bucketCanonical
                            ? (api.searchForNotes(`#template note.title = "${bucketCanonical}"`)[0] || null)
                            : null

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
                                updateAreaColor: areaMisfiled ? (colorBySlug[branchArea] || "") : "",
                                updateTypeToId: typeMisfiled && canonicalNote ? canonicalNote.noteId : "",
                                updateTypeToTitle: typeMisfiled && canonicalNote ? bucketCanonical : ""
                            }
                        })
                    }
                }
                visit(child)
            }
        }

        for (const root of areaRootNotes) visit(root)
        return out
    }, [WORKFLOW_LABEL, AREA_LIST, BUCKET_TEMPLATES])
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

// Assign (or clear, when templateId is "") a note's ~template relation.
async function assignTemplate(noteId, templateId) {
    return api.runOnBackend((noteId, templateId) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (templateId) {
            note.setRelation("template", templateId)
        } else {
            note.removeRelation("template")
        }
        return true
    }, [noteId, templateId])
}

// Assign a note's #area + #color, matching area-picker's convention (set both;
// clear both when slug is ""). color may be "" to leave color unset.
async function assignArea(noteId, slug, color) {
    return api.runOnBackend((noteId, slug, color) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (slug) {
            note.setLabel("area", slug)
            if (color) note.setLabel("color", color)
            else note.removeLabel("color")
        } else {
            note.removeLabel("area")
            note.removeLabel("color")
        }
        return true
    }, [noteId, slug, color])
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

// Assign (or clear, when value is "") a note's #priority label — the MoSCoW
// value convention (4-critical..1-low), matching the priority-widget/agenda.
async function assignPriority(noteId, value) {
    return api.runOnBackend((noteId, value) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (value) note.setLabel("priority", value)
        else note.removeLabel("priority")
        return true
    }, [noteId, value])
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
    getItemTemplates,
    getAreas,
    getOrganizeCandidates,
    getMisfiledNotes,
    assignTemplate,
    assignArea,
    assignPriority,
    assignStartDate,
    refileNote,
    deleteNote
}
