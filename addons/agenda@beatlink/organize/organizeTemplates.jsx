import { useState, useEffect } from "trilium:preact"
import { loadSettings, saveSettings, SettingsForm } from "libSettingsUI.jsx"

// Managed item-type templates for the Organize workflow. The config lives in the
// shared #agendaConfig note as the `templates` registry (schema.json); this
// module reads it, resolves each entry to a live #template note, and re-derives
// the labels agenda's widgets key on (#type sort key, #agendaTaskWidget).
//
// An entry: { name, titleMatch, templateNoteId, enabled, actionable, order }.
//   - Seeded (bundled) entries ship with `titleMatch` set and `templateNoteId`
//     blank; the first Scan resolves the title to a real note id.
//   - Scan-discovered entries are keyed by note id, `titleMatch` blank.
// Structural templates (the Area root / container templates) are NOT managed
// here — organizeStructure.js keeps them hard-coded.

// The label agenda widgets sort/group notes by; its value is `<order>-<slug>`.
const TYPE_LABEL = "type"
// The label that mounts agenda's Task editor on a note.
const TASK_WIDGET_LABEL = "agendaTaskWidget"

// Resolve the #agendaConfig anchor to the schema + config note ids libsettings
// needs. Returns null when agenda's config note can't be found.
async function getConfigContext() {
    const anchors = await api.searchForNotes("#agendaConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("AddonData:config")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// A URL/label-safe slug from a template's display name: lowercased, runs of
// non-alphanumerics collapsed to a single dash, edges trimmed. Used as the
// trailing segment of #type and the scaffolding bucket's #workflowNote key.
function slugify(name) {
    return String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "template"
}

// Read the managed template config, resolving each entry to a live note. Returns
// [{ id, noteId, name, slug, enabled, actionable, order }] sorted by order, for
// entries that resolve to an existing note (a stale id / unresolved titleMatch is
// dropped). `id` is the registry key. Loads settings itself so any frontend
// caller (the Organize page, provisioning) can use it without wiring.
export async function getTemplateConfig() {
    const ctx = await getConfigContext()
    if (!ctx) return []
    const settings = await loadSettings(ctx.schemaNoteId, ctx.configNoteId)
    const registry = settings.templates || {}

    // Resolve each entry's live note id: an explicit templateNoteId if it still
    // exists, else a lookup of its `titleMatch` among #template notes.
    const entries = Object.entries(registry)
    const resolved = await api.runOnBackend((entries) => {
        return entries.map(([id, e]) => {
            let noteId = ""
            if (e.templateNoteId && api.getNote(e.templateNoteId)) {
                noteId = e.templateNoteId
            } else if (e.titleMatch) {
                const hits = api.searchForNotes(`#template note.title = "${e.titleMatch}"`)
                if (hits.length) noteId = hits[0].noteId
            }
            return { id, noteId, name: e.name, enabled: e.enabled, actionable: e.actionable, order: e.order }
        })
    }, [entries])

    return resolved
        .filter(e => e.noteId)
        .map(e => ({ ...e, slug: slugify(e.name) }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

// Re-derive the labels agenda reads from the current template config: for each
// resolved template set #type=<order>-<slug>; set/remove #agendaTaskWidget per
// `actionable`. Idempotent — safe to run on every Scan / Save. Returns the count
// of templates whose labels were (re)written.
async function writeTemplateLabels(list) {
    return api.runOnBackend((list, typeLabel, taskWidgetLabel) => {
        let count = 0
        for (const t of list) {
            const note = api.getNote(t.noteId)
            if (!note) continue
            note.setLabel(typeLabel, `${t.order}-${t.slug}`)
            if (t.actionable) note.setLabel(taskWidgetLabel, "")
            else note.removeLabel(taskWidgetLabel)
            count++
        }
        return count
    }, [list, TYPE_LABEL, TASK_WIDGET_LABEL])
}

// The Save-side counterpart, wired as the Templates SettingsForm's `onSaved`:
// once the registry is persisted, re-derive the labels agenda reads (#type,
// #agendaTaskWidget) onto every enabled+resolved template. Returns the count.
export async function applyTemplateLabels() {
    const resolved = await getTemplateConfig()
    return writeTemplateLabels(resolved.filter(t => t.enabled))
}

// Scan Trilium for every #template note and reconcile the registry: add an entry
// (disabled) for any #template note not already covered by an existing entry
// (matched by resolved note id OR titleMatch), then persist. Discovery only —
// applying labels is Save's job (applyTemplateLabels). Preserves every existing
// entry's flags. Returns { added, total }.
async function scanTemplates() {
    const ctx = await getConfigContext()
    if (!ctx) return { added: 0, total: 0 }
    const settings = await loadSettings(ctx.schemaNoteId, ctx.configNoteId)
    const registry = { ...(settings.templates || {}) }

    // Structural templates are excluded from the managed list (Area/Special).
    const STRUCTURAL_TITLES = ["7. Area", "8. Special"]

    // On the backend: find all #template notes, and for each existing entry the
    // note id it currently resolves to (so we don't re-add one already covered).
    const scan = await api.runOnBackend((entries, structuralTitles) => {
        const all = api.searchForNotes("#template").map(n => ({ noteId: n.noteId, title: n.title }))
        const coveredIds = new Set()
        for (const [, e] of entries) {
            if (e.templateNoteId && api.getNote(e.templateNoteId)) coveredIds.add(e.templateNoteId)
            else if (e.titleMatch) {
                const hits = api.searchForNotes(`#template note.title = "${e.titleMatch}"`)
                if (hits.length) coveredIds.add(hits[0].noteId)
            }
        }
        const structural = new Set(structuralTitles)
        const newOnes = all.filter(t => !coveredIds.has(t.noteId) && !structural.has(t.title))
        return { newOnes }
    }, [Object.entries(registry), STRUCTURAL_TITLES])

    // Append the newly-found templates after the current max order.
    let maxOrder = -1
    for (const e of Object.values(registry)) maxOrder = Math.max(maxOrder, e.order ?? 0)

    let added = 0
    for (const t of scan.newOnes) {
        maxOrder += 1
        registry[t.noteId] = {
            name: t.title, titleMatch: "", templateNoteId: t.noteId,
            enabled: false, actionable: false, order: maxOrder
        }
        added += 1
    }

    settings.templates = registry
    await saveSettings(ctx.schemaNoteId, ctx.configNoteId, settings)

    return { added, total: Object.keys(registry).length }
}

// The Templates settings panel: a Scan button (discover newly-added #template
// notes into the registry) above the SettingsForm `templates` registry editor.
// Edits stage until you click the form's Save, which persists the registry and
// then applies the derived #type / #agendaTaskWidget labels (via onSaved =
// applyTemplateLabels). Scan mutates config directly, so it remounts the form
// (reloadKey bump) to re-read the fresh config afterward.
export function TemplatesPanel({ schemaNoteId, configNoteId }) {
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [reloadKey, setReloadKey] = useState(0)

    async function onScan() {
        setBusy(true)
        setStatus(null)
        try {
            const r = await scanTemplates()
            setReloadKey(k => k + 1)
            setStatus(
                `Scan complete: ${r.added} new template${r.added === 1 ? "" : "s"} found ` +
                `(${r.total} total). Enable the ones you want, then Save.`
            )
        } catch (e) {
            setStatus("Scan failed: " + String(e && e.message ? e.message : e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="organize-templates">
            <p className="organize-templates-blurb">
                The item-type templates the Organize workflow offers, scaffolds a bucket per, and
                derives <code>#type</code> / <code>#agendaTaskWidget</code> from. <strong>Enabled</strong>{" "}
                templates appear in the assign queue and get a scaffolding bucket; <strong>Actionable</strong>{" "}
                templates additionally flow through the priority and start-date queues. <strong>Order</strong>{" "}
                sets the assign/bucket sequence and the numeric prefix of each template's{" "}
                <code>#type</code>. Run <strong>Scan</strong> to pull in any <code>#template</code> note you
                have added, then edit the rows and click <strong>Save</strong> — saving persists your
                choices and applies the derived labels to the notes.
            </p>

            <button className="organize-templates-scan" disabled={busy} onClick={onScan}>
                {busy ? "Scanning..." : "Scan for templates"}
            </button>

            {status && <div className="organize-templates-status">{status}</div>}

            <SettingsForm
                key={reloadKey}
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                only="Templates"
                onSaved={applyTemplateLabels}
            />
        </div>
    )
}
