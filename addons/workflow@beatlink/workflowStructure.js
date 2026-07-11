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
//   key        stable identity written as #workflowNote=<key>
//   title      the note title matched on / created with
//   icon       BoxIcons class (without the leading "bx ")
//   labels     [{ name, value }] extra labels set only when the note is CREATED
//              (never overwritten on an adopted, already-existing note)
//   children   nested nodes provisioned under this one

// The 15 areas of life, in the order fixed in develop.md, numbered 01-15.
const AREAS = [
    "Career", "Finances", "Legal", "Home", "Car", "Tech", "Fitness", "Grooming",
    "Sexual", "Social", "Health", "Mental", "Identity", "Fun", "Productivity"
]

// The six Type buckets provisioned under every Area (draft's non-structural,
// non-Task set). Task is filed within these by agenda; Area is the container.
// `taskWidget: true` marks buckets whose notes are actionable.
const SUBTYPES = [
    { slug: "ideas",    title: "Ideas",    icon: "bx-bulb",         taskWidget: false },
    { slug: "goals",    title: "Goals",    icon: "bxs-star-half",   taskWidget: false },
    { slug: "routines", title: "Routines", icon: "bx-sync",         taskWidget: true },
    { slug: "projects", title: "Projects", icon: "bx-check-double", taskWidget: true },
    { slug: "future",   title: "Future",   icon: "bx-hourglass",    taskWidget: true },
    { slug: "notes",    title: "Notes",    icon: "bx-note",         taskWidget: false }
]

// zero-padded area number: 1 -> "01"
function pad2(n) {
    return String(n).padStart(2, "0")
}

function buildAreaNode(name, index) {
    const num = pad2(index + 1)
    const slug = `${num}-${name.toLowerCase()}`
    const key = `area-${slug}`
    return {
        key,
        title: name,
        icon: "bxs-circle",
        // Created area notes get their #area value + list view, matching the
        // Area template convention. Not reapplied to adopted notes.
        labels: [
            { name: "area", value: slug },
            { name: "viewType", value: "list" }
        ],
        children: SUBTYPES.map(sub => ({
            key: `${key}-${sub.slug}`,
            title: sub.title,
            icon: sub.icon,
            labels: sub.taskWidget ? [{ name: "agendaTaskWidget", value: "" }] : [],
            children: []
        }))
    }
}

// The full structure: three top-level singletons, then one node per area.
const STRUCTURE = [
    { key: "inbox",  title: "Inbox",  icon: "bx-inbox",    labels: [], children: [] },
    { key: "my-day", title: "My Day", icon: "bx-task",     labels: [], children: [] },
    { key: "agenda", title: "Agenda", icon: "bx-calendar", labels: [], children: [] },
    ...AREAS.map(buildAreaNode)
]

module.exports = { STRUCTURE, AREAS, SUBTYPES }
