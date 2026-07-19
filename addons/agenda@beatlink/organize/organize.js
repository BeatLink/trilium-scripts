// === Trilium Code note ===
// Title: organize.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page).
//
// Backend helpers for the Organize phase's triage queues:
//   - getItemTemplates(): the item-type templates the "assign a template" queue offers.
//   - getOrganizeCandidates(): every note under the Inbox or an Area subtree, with
//     the flags each queue filters on (hasTemplate / hasArea), plus its tree path,
//     a content preview, and a suggested area (nearest ancestor's #area).
//   - assignTemplate / assignArea / deleteNote: the per-note mutations.
//
// Neither vocabulary is defined here: the AREA list comes from area-picker@beatlink
// (via organizeAreas.jsx), the TEMPLATE list from agenda's managed-templates
// config (via organizeTemplates.getTemplateConfig). Both are loaded by the page
// and passed in — getItemTemplates/getOrganizeCandidates/getMisfiledNotes take the
// enabled/actionable template list and the area list as arguments.
//
// Scope note: only notes UNDER the Inbox and the Area roots are surfaced. The
// structural notes themselves (anything carrying #workflowNote — the areas, the
// buckets, Inbox/My Day/Agenda) are excluded; they're containers, not items.
//
// One backend round-trip collects the candidate list once (runOnBackend closures
// are isolated and can't share helpers), and the frontend filters it into each
// queue — cheaper and simpler than a separate walk per queue.

const WORKFLOW_LABEL = "workflowNote"

// The item-type templates offered by the "Notes Without Templates" queue come
// from agenda's managed-templates config (organizeTemplates.getTemplateConfig),
// passed in as an ordered [{ noteId, name, slug, order, actionable }] list of the
// ENABLED templates — no hard-coded titles here anymore. Returns [{ noteId,
// title }] in the given order (title = the template note's live title).
async function getItemTemplates(templateList) {
    return api.runOnBackend((templateList) => {
        const out = []
        for (const t of templateList) {
            const note = api.getNote(t.noteId)
            if (note) out.push({ noteId: t.noteId, title: note.title })
        }
        return out
    }, [templateList])
}

// Collect every non-structural note under the Inbox / Area subtrees, each with:
//   { noteId, title, path, preview, hasTemplate, templateTitle, hasArea,
//     hasPriority, hasStartDate, isSubtask, suggestedArea }
// The frontend filters this into the per-queue work lists (untemplated, or
// no-area). `suggestedArea` is the nearest ancestor's #area value ("" if none).
// `isSubtask` marks a note whose primary parent is itself an actionable-template
// note (excluded from the no-start-date queue — it's scheduled with its parent).
// `actionableTemplateIds` is the set of template note ids flagged actionable in
// the managed-templates config.
async function getOrganizeCandidates(actionableTemplateIds) {
    return api.runOnBackend((workflowLabel, actionableTemplateIds) => {
        const actionableSet = new Set(actionableTemplateIds)
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

        // A note is a subtask when its primary parent is itself an
        // actionable-template note. Subtasks are managed under their parent, so
        // they're excluded from the "no start date" queue (scheduled with the
        // parent, not on their own).
        function parentIsActionable(note) {
            const parent = note.getParentNotes()[0]
            if (!parent) return false
            const tId = parent.getRelationValue("template")
            return !!tId && actionableSet.has(tId)
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
                        templateId,
                        templateTitle: templateNote ? templateNote.title : "",
                        hasArea: !!child.getLabelValue("area"),
                        hasPriority: !!child.getLabelValue("priority"),
                        hasStartDate: !!child.getLabelValue("startDateTime"),
                        isSubtask: parentIsActionable(child),
                        suggestedArea: ancestorArea(child)
                    })
                }
                visit(child)
            }
        }

        for (const root of rootNotes) visit(root)
        return out
    }, [WORKFLOW_LABEL, actionableTemplateIds])
}

// Find notes whose #area or ~template disagrees with where they're filed. In the
// managed-templates model a bucket IS a template: a note under "Home > Task"
// implies area=03-home and bucket-template=task; it's misfiled if its own #area
// differs from the ancestor Area, or its ~template's slug differs from the
// ancestor bucket's template slug. Only notes inside an Area subtree are checked
// (Inbox notes aren't filed yet). `templateList` is agenda's enabled managed
// templates ([{ noteId, slug, name }]). Returns per note:
//   { noteId, title, path, preview,
//     areaMisfiled, typeMisfiled,
//     branchArea, branchBucket, noteArea, noteTemplateTitle,
//     fixes: { moveTargetNoteId, moveTargetLabel, updateAreaTo, updateAreaColor,
//              updateTypeToId, updateTypeToTitle } }
// `branchBucket` is the ancestor bucket's template slug. `fixes.*` are precomputed
// so the frontend just shows the applicable buttons.
async function getMisfiledNotes(areaList, templateList) {
    return api.runOnBackend((workflowLabel, areaList, templateList) => {
        const tagged = api.searchForNotes(`#${workflowLabel}`)
        const structuralIds = new Set(tagged.map(n => n.noteId))

        // Index the structural notes by their #workflowNote key so we can resolve
        // "the Task bucket under the Home area" -> a real noteId for moves.
        const byKey = {}
        for (const n of tagged) byKey[n.getLabelValue(workflowLabel)] = n

        const isAreaRootKey = k => /^area-\d\d-[a-z]+$/.test(k)
        const areaRootNotes = tagged.filter(n => isAreaRootKey(n.getLabelValue(workflowLabel)))

        // area slug ("03-home") -> its area-root #workflowNote key ("area-03-home")
        const areaKeyBySlug = {}
        for (const a of areaList) areaKeyBySlug[a.slug] = `area-${a.slug}`
        const colorBySlug = {}
        for (const a of areaList) colorBySlug[a.slug] = a.color
        const areaSlugs = areaList.map(a => a.slug)

        // template note id -> its bucket slug; and bucket slug -> template note id
        // (for the "update type" fix, which sets the note's template to the one
        // its bucket represents).
        const slugByTemplateId = {}
        const templateIdBySlug = {}
        const titleByTemplateId = {}
        for (const t of templateList) {
            slugByTemplateId[t.noteId] = t.slug
            templateIdBySlug[t.slug] = t.noteId
            const note = api.getNote(t.noteId)
            titleByTemplateId[t.noteId] = note ? note.title : t.name
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

        // Nearest ancestor Area's #area, and nearest ancestor bucket's template
        // slug. A bucket key is "area-<areaSlug>-<templateSlug>"; since a template
        // slug can itself contain dashes, we strip the known "area-<areaSlug>-"
        // prefix rather than assuming a single trailing segment.
        function bucketSlugFromKey(key) {
            for (const areaSlug of areaSlugs) {
                const prefix = `area-${areaSlug}-`
                if (key.startsWith(prefix)) return key.slice(prefix.length)
            }
            return ""
        }
        function branchContext(note) {
            let branchArea = ""
            let branchBucket = ""
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root") {
                const key = cur.getLabelValue(workflowLabel)
                if (key) {
                    if (!branchBucket) {
                        const slug = bucketSlugFromKey(key)
                        if (slug) branchBucket = slug
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
                let flagged = false
                if (!structuralIds.has(child.noteId)) {
                    const { branchArea, branchBucket } = branchContext(child)
                    const noteArea = child.getLabelValue("area") || ""
                    const templateId = child.getRelationValue("template") || ""
                    let noteTemplateTitle = ""
                    if (templateId) {
                        noteTemplateTitle = titleByTemplateId[templateId] || ""
                        if (!noteTemplateTitle) {
                            const tn = api.getNote(templateId)
                            noteTemplateTitle = tn ? tn.title : ""
                        }
                    }

                    const areaMisfiled = !!noteArea && !!branchArea && noteArea !== branchArea
                    // The note's own bucket slug (from its template); a managed
                    // template maps to a bucket of the same slug. A note whose
                    // template isn't a managed one has no bucket slug and is never
                    // type-misfiled (we don't know where it belongs).
                    const templateBucket = templateId ? slugByTemplateId[templateId] : undefined
                    const typeMisfiled = templateBucket !== undefined && !!branchBucket &&
                        templateBucket !== branchBucket

                    if (areaMisfiled || typeMisfiled) {
                        flagged = true
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

                        // "Set type" fix: adopt the branch bucket's own template.
                        const canonicalId = branchBucket ? (templateIdBySlug[branchBucket] || "") : ""
                        const canonicalTitle = canonicalId ? (titleByTemplateId[canonicalId] || "") : ""

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
                                updateTypeToId: typeMisfiled && canonicalId ? canonicalId : "",
                                updateTypeToTitle: typeMisfiled && canonicalId ? canonicalTitle : ""
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
    }, [WORKFLOW_LABEL, areaList, templateList])
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
    getOrganizeCandidates,
    getMisfiledNotes,
    assignTemplate,
    assignArea,
    assignPriority,
    assignStartDate,
    refileNote,
    deleteNote
}
