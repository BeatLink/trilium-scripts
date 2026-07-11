// === Trilium Code note ===
// Title: workflowStructure.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by workflowProvision.js / the Setup page).
//
// The single source of truth for the opinionated notebook layout this addon
// provisions. Each entry is a plain object; workflowProvision.js walks this
// tree, find-or-creating each note by title at its level and tagging it with
// #workflowNote=<key> so the addon can resolve it later (see develop.md).
//
// A node:
//   key         stable identity written as #workflowNote=<key>
//   title       the note title matched on / created with
//   icon        BoxIcons class (without the leading "bx "); re-asserted every run
//   color       CSS color for the note's #color label; re-asserted every run
//               (area-picker convention). Omitted -> no #color managed.
//   template    title of a templates@beatlink template to set as a ~template
//               relation, resolved live at provision time; re-asserted every run.
//   seedLabels  [{ name, value }] labels set ONLY when the note is first CREATED
//               (never re-asserted, so user edits to them survive adoption/re-runs)
//   children    nested nodes provisioned under this one
//
// Idempotency: icon, color and template are DERIVED — re-asserted (setLabel /
// setRelation overwrite) on every provision run, including on adopted pre-existing
// notes. seedLabels and note content are only touched at creation.

// The 15 areas of life, in the order fixed in develop.md, numbered 01-15, each
// with its #color. Colors reuse agenda's colors.area palette for the 14 shared
// areas; Legal (new here) = red, grouping it with Career/Finances.
const AREAS = [
    { name: "Career",       color: "red" },
    { name: "Finances",     color: "red" },
    { name: "Legal",        color: "red" },
    { name: "Home",         color: "darkorange" },
    { name: "Car",          color: "darkorange" },
    { name: "Tech",         color: "cyan" },
    { name: "Fitness",      color: "gold" },
    { name: "Grooming",     color: "gold" },
    { name: "Sexual",       color: "gold" },
    { name: "Social",       color: "lime" },
    { name: "Health",       color: "lime" },
    { name: "Mental",       color: "lime" },
    { name: "Identity",     color: "lime" },
    { name: "Fun",          color: "magenta" },
    { name: "Productivity", color: "lime" }
]

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

// Template titles shipped by templates@beatlink. Areas use the Area template;
// the structural container notes (Inbox/My Day/Agenda + every bucket) use the
// neutral Special container template.
const AREA_TEMPLATE_TITLE = "7. Area"
const SPECIAL_TEMPLATE_TITLE = "8. Special"

// zero-padded area number: 1 -> "01"
function pad2(n) {
    return String(n).padStart(2, "0")
}

// The #area label value for an area at a given 0-based index: "03-legal".
function areaSlug(area, index) {
    return `${pad2(index + 1)}-${area.name.toLowerCase()}`
}

// Flat area vocabulary { slug, name, color } — the single source used both to
// provision Area notes and to offer areas in the Organize "assign area" queue.
const AREA_LIST = AREAS.map((area, i) => ({
    slug: areaSlug(area, i),
    name: area.name,
    color: area.color
}))

function buildAreaNode(area, index) {
    const slug = areaSlug(area, index)
    const key = `area-${slug}`
    return {
        key,
        title: area.name,
        icon: "bxs-circle",
        color: area.color,
        template: AREA_TEMPLATE_TITLE,
        // The #area value is note-specific (agenda's filters/colors/kanban key
        // on it) and can't come from the Area template — set on creation only.
        // #viewType/#label:area come from the Area template itself.
        seedLabels: [
            { name: "area", value: slug }
        ],
        children: SUBTYPES.map(sub => ({
            key: `${key}-${sub.slug}`,
            title: sub.title,
            icon: sub.icon,
            // Buckets inherit their area's color; no other seed labels.
            color: area.color,
            template: SPECIAL_TEMPLATE_TITLE,
            seedLabels: [],
            children: []
        }))
    }
}

// The full structure: three top-level container singletons, then one node per
// area. Singletons use the Special container template.
const STRUCTURE = [
    { key: "inbox",  title: "Inbox",  icon: "bxs-inbox",   template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
    { key: "my-day", title: "My Day", icon: "bx-task",     template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
    { key: "agenda", title: "Agenda", icon: "bx-calendar", template: SPECIAL_TEMPLATE_TITLE, seedLabels: [], children: [] },
    ...AREAS.map(buildAreaNode)
]

module.exports = { STRUCTURE, AREAS, AREA_LIST, SUBTYPES, AREA_TEMPLATE_TITLE, SPECIAL_TEMPLATE_TITLE }
