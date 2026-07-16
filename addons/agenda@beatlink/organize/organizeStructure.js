// === Trilium Code note ===
// Title: organizeStructure.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by organizeProvision.js / the Setup page).
//
// The opinionated notebook layout this addon provisions. The area vocabulary is
// NOT defined here — it comes from area-picker@beatlink (discovered via
// #areaConfig, see organizeAreas.jsx) and is passed into buildStructure() as an
// [{ slug, name, color }] list. This module supplies the fixed parts (subtype
// buckets, template titles, priority vocabulary) and assembles the full tree.
//
// buildStructure(areaList) returns an array of nodes; organizeProvision.js walks
// it, find-or-creating each note by title at its level and tagging it with
// #workflowNote=<key> so the addon can resolve it later (see README.md).
//
// A node:
//   key         stable identity written as #workflowNote=<key>
//   title       the note title matched on / created with
//   icon        BoxIcons class (without the leading "bx "); re-asserted every run
//   color       CSS color for the note's #color label; re-asserted every run
//               (area-picker convention). Omitted -> no #color managed.
//   template    title of a bundled template to set as a ~template
//               relation, resolved live at provision time; re-asserted every run.
//   seedLabels  [{ name, value }] labels set ONLY when the note is first CREATED
//               (never re-asserted, so user edits to them survive adoption/re-runs)
//   children    nested nodes provisioned under this one
//
// Idempotency: icon, color and template are DERIVED — re-asserted (setLabel /
// setRelation overwrite) on every provision run, including on adopted pre-existing
// notes. seedLabels and note content are only touched at creation.

// The six Type buckets provisioned under every Area (draft's non-structural,
// non-Task set). Task is filed within these by agenda; Area is the container.
// Buckets are groupings OF actionable notes, not actionable themselves, so they
// carry no #agendaTaskWidget — just their id, their area's color, and an icon.
const SUBTYPES = [
    { slug: "ideas",    title: "Ideas",    icon: "bx-bulb" },
    { slug: "goals",    title: "Goals",    icon: "bxs-star-half" },
    { slug: "routines", title: "Routines", icon: "bx-sync" },
    { slug: "projects", title: "Projects", icon: "bx-check-double" },
    { slug: "future",   title: "Future",   icon: "bx-time-five" },
    { slug: "notes",    title: "Notes",    icon: "bx-notepad" }
]

// Bundled template titles. Areas use the Area template;
// the structural container notes (Inbox/My Day/Agenda + every bucket) use the
// neutral Special container template.
const AREA_TEMPLATE_TITLE = "7. Area"
const SPECIAL_TEMPLATE_TITLE = "8. Special"

// Which item templates each Type bucket accepts, keyed by the bucket's slug (the
// trailing segment of its #workflowNote key, e.g. "projects" in
// "area-03-legal-projects"). Used by the Misfiled Notes check: a note whose
// ~template isn't in its bucket's list is type-misfiled. Note the Projects
// bucket accepts BOTH "5. Project" and "3. Task" — Task-templated notes live
// under Projects (there is no separate Task bucket). The first title in each
// list is the bucket's canonical template (what "update type" assigns).
const BUCKET_TEMPLATES = {
    ideas:    ["0. Ideas"],
    goals:    ["1. Goal"],
    routines: ["2. Routine"],
    projects: ["5. Project", "3. Task"],
    future:   ["4. Future"],
    notes:    ["6. Note"]
}

// The actionable item types that should carry a #priority — Routines, Tasks,
// Projects, Future. Ideas/Goals/Notes are excluded (not scheduled work). The
// Organize "Tasks Without Priority" section flags notes on these templates that
// have no #priority yet.
const PRIORITY_TEMPLATE_TITLES = ["2. Routine", "3. Task", "5. Project", "4. Future"]

// The #priority vocabulary (MoSCoW), matching agenda's schema and the
// priority-widget: value -> display, highest first.
const PRIORITY_OPTIONS = [
    { value: "4-critical", label: "Must Do" },
    { value: "3-high",     label: "Should Do" },
    { value: "2-medium",   label: "Could Do" },
    { value: "1-low",      label: "Want To Do" }
]

// Build one Area node (+ its six subtype buckets) from an area-picker area
// { slug, name, color }. `slug` is the #area value (e.g. "03-legal") and the
// area root's #workflowNote key is `area-<slug>`.
function buildAreaNode(area) {
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
        // #viewType/#label:area come from the Area template itself.
        areaValue: area.slug,
        seedLabels: [],
        children: SUBTYPES.map(sub => ({
            key: `${key}-${sub.slug}`,
            title: sub.title,
            icon: sub.icon,
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

// The full structure for a given area list: three top-level container singletons,
// then one node per area. Singletons use the Special container template.
function buildStructure(areaList) {
    return [
        { key: "inbox",  title: "Inbox",  icon: "bxs-inbox",   template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
        { key: "my-day", title: "My Day", icon: "bx-task",     template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
        { key: "agenda", title: "Agenda", icon: "bx-calendar", template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
        ...(areaList || []).map(buildAreaNode)
    ]
}

module.exports = {
    buildStructure, SUBTYPES,
    AREA_TEMPLATE_TITLE, SPECIAL_TEMPLATE_TITLE, BUCKET_TEMPLATES,
    PRIORITY_TEMPLATE_TITLES, PRIORITY_OPTIONS
}
