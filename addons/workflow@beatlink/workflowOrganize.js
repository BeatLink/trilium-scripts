// === Trilium Code note ===
// Title: workflowOrganize.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Workflow window's Organize tab).
//
// Backend helpers for the Organize phase's "assign a template" triage queue:
//   - getItemTemplates(): the item-type templates the picker offers.
//   - getUntemplatedNotes(): every note under the Inbox or an Area subtree that
//     has no ~template yet, each with its tree-path breadcrumb, as a work queue.
//   - assignTemplate(noteId, templateId): set (or clear) a note's ~template.
//
// Scope note: only notes UNDER the Inbox and the Area roots are surfaced. The
// structural notes themselves (anything carrying #workflowNote — the areas, the
// buckets, Inbox/My Day/Agenda) are excluded; they're containers, not items.

const WORKFLOW_LABEL = "workflowNote"

// The item-type templates offered during Organize, in workflow order. Structural
// templates (Area / Special) are intentionally excluded. Resolved live by title;
// a title with no matching #template note (e.g. Ideas, until its template ships)
// is simply omitted from the picker.
const ITEM_TEMPLATE_TITLES = [
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

// Build the triage queue: untemplated descendants of the Inbox note and every
// Area root, each as { noteId, title, path } where `path` is the ancestor
// breadcrumb ("Root > Area > ..."). Excludes structural #workflowNote notes.
async function getUntemplatedNotes() {
    return api.runOnBackend((workflowLabel) => {
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

        // Collect untemplated descendants of the scope roots, de-duped (a note
        // can be cloned under more than one scope root).
        const seen = new Set()
        const queue = []

        function visit(note) {
            for (const child of note.getChildNotes()) {
                if (seen.has(child.noteId)) continue
                seen.add(child.noteId)
                const untemplated = !child.getRelationValue("template")
                if (untemplated && !structuralIds.has(child.noteId)) {
                    queue.push({ noteId: child.noteId, title: child.title, path: pathOf(child), preview: previewOf(child) })
                }
                visit(child)
            }
        }

        for (const root of rootNotes) visit(root)
        return queue
    }, [WORKFLOW_LABEL])
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

// Delete a note outright (all its clones), used by the Organize queue's Delete
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

module.exports = { getItemTemplates, getUntemplatedNotes, assignTemplate, deleteNote }
