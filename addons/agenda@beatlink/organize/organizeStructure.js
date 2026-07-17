// === Trilium Code note ===
// Title: organizeStructure.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by organizeProvision.js / the Setup page).
//
// The opinionated notebook layout this addon provisions. Two vocabularies feed
// it, both discovered at runtime rather than hard-coded here:
//   - the AREA list from area-picker@beatlink (via #areaConfig, see
//     organizeAreas.jsx): [{ slug, name, color }].
//   - the TEMPLATE list from agenda's own managed-templates config (via
//     #agendaConfig, see organizeTemplates.jsx): the enabled item templates,
//     [{ noteId, name, slug, order, actionable }] in order.
// This module supplies only the fixed structural parts (the three top-level
// container singletons, the two structural template titles, the priority
// vocabulary) and assembles the full tree.
//
// buildStructure(areaList, templateList) returns an array of nodes;
// organizeProvision.js walks it, find-or-creating each note by title at its
// level and tagging it with #workflowNote=<key> so the addon can resolve it
// later (see README.md).
//
// A node:
//   key         stable identity written as #workflowNote=<key>
//   title       the note title matched on / created with
//   icon        BoxIcons class (without the leading "bx "); re-asserted every run
//   color       CSS color for the note's #color label; re-asserted every run
//               (area-picker convention). Omitted -> no #color managed.
//   template    title of a *structural* bundled template (Area/Special) to set as
//               a ~template relation, resolved live at provision time. Every node
//               is Area- or Special-templated: the per-template buckets are
//               containers (Special), not instances of the type they hold.
//   seedLabels  [{ name, value }] labels set ONLY when the note is first CREATED
//               (never re-asserted, so user edits to them survive adoption/re-runs)
//   children    nested nodes provisioned under this one
//
// Idempotency: icon, color and template are DERIVED — re-asserted (setLabel /
// setRelation overwrite) on every provision run, including on adopted pre-existing
// notes. seedLabels and note content are only touched at creation.

// Structural (non-item) template titles. Areas use the Area template; the
// structural container notes (Inbox/My Day/Agenda + every bucket) use the
// neutral Special container template. These two are NOT part of the managed
// item-template config — they're fixed scaffolding.
const AREA_TEMPLATE_TITLE = "7. Area"
const SPECIAL_TEMPLATE_TITLE = "8. Special"

// The #priority vocabulary (MoSCoW), matching agenda's schema and the
// priority-widget: value -> display, highest first. (Which templates are
// actionable — i.e. get a #priority — now comes from the managed-templates
// config's `actionable` flag, not a hard-coded title list.)
const PRIORITY_OPTIONS = [
    { value: "4-critical", label: "Must Do" },
    { value: "3-high",     label: "Should Do" },
    { value: "2-medium",   label: "Could Do" },
    { value: "1-low",      label: "Want To Do" }
]

// A BoxIcons class for a bucket, chosen from the template slug so the common
// bundled templates keep their familiar icons; anything else gets a neutral one.
const BUCKET_ICONS = {
    ideas:    "bx-bulb",
    goal:     "bxs-star-half",
    routine:  "bx-sync",
    task:     "bx-check",
    project:  "bx-check-double",
    future:   "bx-time-five",
    note:     "bx-notepad"
}
function bucketIcon(slug) {
    return BUCKET_ICONS[slug] || "bx-folder"
}

// Build one Area node (+ one bucket per enabled template) from an area-picker
// area { slug, name, color } and the managed template list. `slug` is the #area
// value (e.g. "03-legal") and the area root's #workflowNote key is `area-<slug>`.
// Each bucket's #workflowNote key is `area-<slug>-<templateSlug>`, its title the
// template's name, and its ~template the area/Special container template (a
// bucket is a container, not an instance of the type it holds).
function buildAreaNode(area, templateList) {
    const key = `area-${area.slug}`
    return {
        key,
        title: area.name,
        icon: "bxs-circle",
        color: area.color,
        template: AREA_TEMPLATE_TITLE,
        // The #area value is note-specific (agenda's filters/colors/kanban key on
        // it) and can't come from the Area template. It's DERIVED (re-asserted
        // every run), not a seed, so an area-picker edit that renumbers a slug
        // self-heals the root notes' #area on the next provision run.
        areaValue: area.slug,
        seedLabels: [],
        children: (templateList || []).map(tpl => ({
            key: `${key}-${tpl.slug}`,
            title: tpl.name,
            icon: bucketIcon(tpl.slug),
            // Buckets inherit their area's color; no other seed labels.
            color: area.color,
            template: SPECIAL_TEMPLATE_TITLE,
            // Pin buckets open so expanded@beatlink keeps their area expanded in
            // the tree. Derived (re-asserted every run) — see provisionNode.
            alwaysExpanded: true,
            seedLabels: [],
            children: []
        }))
    }
}

// The full structure for a given area + template list: three top-level container
// singletons, then one node per area (each with one bucket per enabled template).
// Singletons use the Special container template.
function buildStructure(areaList, templateList) {
    return [
        { key: "inbox",  title: "Inbox",  icon: "bxs-inbox",   template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
        { key: "my-day", title: "My Day", icon: "bx-task",     template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
        { key: "agenda", title: "Agenda", icon: "bx-calendar", template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
        ...(areaList || []).map(area => buildAreaNode(area, templateList))
    ]
}

module.exports = {
    buildStructure,
    AREA_TEMPLATE_TITLE, SPECIAL_TEMPLATE_TITLE,
    PRIORITY_OPTIONS
}
