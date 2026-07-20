import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"
import { getTemplates } from "templateRegistry.jsx"

// The item-type templates the Organize workflow offers. agenda does NOT own this
// vocabulary — template-picker@beatlink does, in its own settings note (found by
// #templatePickerConfig, the same discovery organizeAreas.jsx uses for
// area-picker's #areaConfig). This module reads that registry and adds only what
// agenda needs on top of it.
//
// Two properties agenda cares about are read off each template NOTE, not from
// config, so the note itself is the single source of truth:
//   #agendaTaskWidget  -> actionable: its items flow through the priority and
//                         start-date triage queues (and mount the Task editor)
//   #label:priority    -> its items carry a priority at all
// Both are plain Trilium labels the user sets on the template like any other, so
// making a type actionable is one label rather than a config row to keep in sync.
//
// Display/sort order is the registry's own key order (template-picker's move
// controls rewrite it), matching how #area ordering works — see
// libAgendaConfig.getSortValueMaps.
//
// Structural templates (AreaCollection / TypeCollection / Special) are NOT part of
// this vocabulary — organizeStructure.js keeps them hard-coded, and they are
// filtered out below so scaffolding never appears as an assignable item type.

// The label agenda widgets sort/group notes by; its value is the bare `<slug>`.
// Order is NOT baked into the value — it comes from the registry's position via
// libAgendaConfig.getSortValueMaps, the same way #area ordering works, so
// reordering templates never rewrites a tagged note.
const TYPE_LABEL = "type"
// The label that mounts agenda's Task editor on a note, and the marker that makes
// a template actionable. Set by the user on the template note.
const TASK_WIDGET_LABEL = "agendaTaskWidget"

// Scaffolding template titles, excluded from the assignable item vocabulary.
// template-picker's Scan picks up every #template note including agenda's own
// containers, so they are filtered here rather than in its registry. The numbered
// predecessors are kept so a tree provisioned before the rename filters too.
const STRUCTURAL_TITLES = new Set([
    "AreaCollection", "TypeCollection", "Special",
    "7. Area", "8. Special"
])

// Resolve template-picker's settings note to the schema + config note ids
// libsettings needs. Returns null when template-picker isn't installed, so the
// callers can explain that rather than throw (matching getAreaConfigIds).
export async function getTemplateConfigIds() {
    const anchors = await api.searchForNotes("#templatePickerConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("AddonData:config")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// A URL/label-safe slug from a template's display name: lowercased, runs of
// non-alphanumerics collapsed to a single dash, edges trimmed. Used as the
// trailing segment of #type and the scaffolding bucket's #agendaOrganizeBucket.
function slugify(name) {
    return String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "template"
}

// The item-type vocabulary: template-picker's registry, with agenda's per-note
// properties read off each template note. Returns
// [{ id, noteId, name, slug, enabled, actionable, hasPriority, order }] in
// registry order (`order` is the row's position, so it feeds the #type sort map
// the same way an area's list position does).
//
// `actionable` and `hasPriority` come from the template note's own labels
// (#agendaTaskWidget, #label:priority), not from config — see the module header.
// Structural scaffolding templates are filtered out by title so they can never be
// offered as an assignable type. Returns [] when template-picker isn't installed.
export async function getTemplateConfig() {
    const ctx = await getTemplateConfigIds()
    if (!ctx) return []
    const rows = await getTemplates(ctx.schemaNoteId, ctx.configNoteId)
    if (!rows.length) return []

    // Read the two agenda labels off each resolved template note in one hop.
    const flags = await api.runOnBackend((noteIds, taskWidgetLabel) => {
        const out = {}
        for (const noteId of noteIds) {
            const note = api.getNote(noteId)
            if (!note) continue
            out[noteId] = {
                actionable: note.hasLabel(taskWidgetLabel),
                // Trilium's promoted-attribute declaration for #priority. Its
                // presence means items of this type carry a priority.
                hasPriority: note.hasLabel("label:priority")
            }
        }
        return out
    }, [rows.map(r => r.noteId), TASK_WIDGET_LABEL])

    return rows
        .filter(r => !STRUCTURAL_TITLES.has(r.name))
        .map((r, index) => ({
            ...r,
            slug: slugify(r.name),
            actionable: !!(flags[r.noteId] && flags[r.noteId].actionable),
            hasPriority: !!(flags[r.noteId] && flags[r.noteId].hasPriority),
            order: index
        }))
}

// Re-derive #type onto each enabled template, and strip it from the disabled ones
// so a template leaving the vocabulary keeps no stale sort key.
//
// #agendaTaskWidget is deliberately NOT written here. It is user-set INPUT that
// getTemplateConfig reads to decide `actionable` — writing it back would make
// agenda overwrite the very label it derives from, clearing the user's choice on
// the next save. Same for #label:priority.
//
// Idempotent — safe to run on every Save. Returns the count of templates written.
async function writeTemplateLabels(list, disabledNoteIds) {
    return api.runOnBackend((list, disabledNoteIds, typeLabel) => {
        let count = 0
        for (const t of list) {
            const note = api.getNote(t.noteId)
            if (!note) continue
            note.setLabel(typeLabel, t.slug)
            count++
        }
        for (const noteId of disabledNoteIds) {
            const note = api.getNote(noteId)
            if (!note) continue
            note.removeLabel(typeLabel)
        }
        return count
    }, [list, disabledNoteIds, TYPE_LABEL])
}

// The Save-side counterpart, wired as the Templates form's `onSaved`: once
// template-picker's registry is persisted, re-derive agenda's #type sort key onto
// the enabled templates. Returns the count.
export async function applyTemplateLabels() {
    const resolved = await getTemplateConfig()
    return writeTemplateLabels(
        resolved.filter(t => t.enabled),
        resolved.filter(t => !t.enabled).map(t => t.noteId)
    )
}

// The Templates settings panel: template-picker's own `templates` registry
// editor, surfaced inside agenda's Organize page so the vocabulary the workflow
// scaffolds from can be edited without leaving it.
//
// This edits TEMPLATE-PICKER's config note, not agenda's — the two addons share
// the vocabulary by #templatePickerConfig discovery, and duplicating it here would
// let them drift. Same shape as AreasPanel: resolve the other addon's note ids and
// hand them to the same SettingsForm its own settings page uses. Scan lives in
// template-picker's settings page, so there's no Scan button here.
//
// Save re-derives agenda's #type sort key onto the enabled templates (onSaved =
// applyTemplateLabels). It does NOT write #agendaTaskWidget / #label:priority —
// those are user-set labels on the template note that agenda only reads.
export function TemplatesPanel() {
    const [ids, setIds] = useState(undefined)

    useEffect(() => {
        (async () => setIds(await getTemplateConfigIds()))()
    }, [])

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) {
        return (
            <div className="organize-templates">
                <p className="organize-templates-blurb">
                    Template Picker isn't installed, so there's no template vocabulary to edit.
                    Install <code>template-picker@beatlink</code> to define the item types this
                    workflow offers and scaffolds buckets for.
                </p>
            </div>
        )
    }

    return (
        <div className="organize-templates">
            <p className="organize-templates-blurb">
                The item-type templates the Organize workflow offers and scaffolds a bucket per. This
                is <strong>Template Picker's</strong> configuration, shared with its dropdown widget.
                <strong> Enabled</strong> templates appear in the assign queue and get a bucket; the
                order of this list sets the assign/bucket sequence and the order these types sort in
                across agenda's views. Use Template Picker's own settings page to <strong>Scan</strong>{" "}
                for newly-added <code>#template</code> notes.
            </p>
            <p className="organize-templates-warning">
                A template is <strong>actionable</strong> — its notes flow through the priority and
                start-date queues and mount the Task editor — when the template note itself carries{" "}
                <code>#agendaTaskWidget</code>. Priority comes from <code>#label:priority</code> on the
                same note. Set those on the template note directly; agenda reads them and never
                overwrites them.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
                only="Templates"
                onSaved={applyTemplateLabels}
            />
        </div>
    )
}
