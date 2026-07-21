// === Trilium Code note ===
// Title: organizeStructure.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by organizeProvision.js / the Setup page).
//
// The opinionated notebook layout this addon provisions. Two of agenda's own
// `dimensions` feed it (provisionStructure derives these shapes from the config):
//   - the AREA list — the values of the root dimension (scaffoldsAreas):
//     [{ slug, name, color }].
//   - the TEMPLATE list — the values of the bucket dimension (scaffoldsBuckets):
//     [{ slug, name, icon, noteId }] in order.
// This module supplies only the fixed structural parts (the three top-level
// container singletons, the two structural template titles, the container type
// markers) and assembles the full tree.
//
// buildStructure(areaList, templateList) returns an array of nodes;
// organizeProvision.js walks it, find-or-creating each note by title at its
// level and tagging it with its identity labels so the addon can resolve it
// later (see README.md).
//
// Identity is carried by three INDEPENDENT labels rather than one composite key:
//   #agendaOrganizeArea=<areaSlug>       on an area root AND on every bucket in it
//   #agendaOrganizeBucket=<templateSlug> on a bucket (alongside the area label)
//   #agendaOrganizeSpecial=<name>        on the Inbox / My Day / Agenda singletons
// So an area root is "has area, no bucket", a bucket is "has both", and the two
// slugs are read directly instead of being parsed back out of one string.
//
// Those are the addon's PRIVATE identity labels, used to resolve notes during
// provisioning. Separately, the same notes carry the PUBLIC #area / #type labels
// that agenda's views and the user's own searches key on — an area root is
// "#area=<slug> #type=areacollection", a bucket "#area=<slug> #type=typecollection".
// The two sets are kept distinct on purpose: renaming a template moves the
// private bucket slug, but the public container markers stay fixed.
//
// A node:
//   key         stable identity for logging/diffing (not written to the note)
//   area        #agendaOrganizeArea value, when this node belongs to an area
//   bucket      #agendaOrganizeBucket value, when this node is a bucket
//   special     #agendaOrganizeSpecial value, for the top-level singletons
//   title       the note title matched on / created with
//   icon        BoxIcons class (without the leading "bx "); re-asserted every run
//   color       CSS color for the note's #color label; re-asserted every run
//               (area-picker convention). Omitted -> no #color managed.
//   areaValue   #area value; re-asserted every run. Omitted -> no #area managed.
//   typeValue   #type value; re-asserted every run. For structural notes this is
//               a container marker (areacollection / typecollection), never the
//               slug of an item type. Omitted -> no #type managed.
//   template    title of a *structural* bundled template (AreaCollection /
//               TypeCollection / Special) to set as a ~template relation, resolved
//               live at provision time: area roots are AreaCollection, per-type
//               buckets are TypeCollection, the singletons are Special. A bucket
//               is a container, not an instance of the type it holds.
//   seedLabels  [{ name, value }] labels set ONLY when the note is first CREATED
//               (never re-asserted, so user edits to them survive adoption/re-runs)
//   children    nested nodes provisioned under this one
//
// Idempotency: icon, color and template are DERIVED — re-asserted (setLabel /
// setRelation overwrite) on every provision run, including on adopted pre-existing
// notes. seedLabels and note content are only touched at creation.

// Structural (non-item) template titles, one per kind of container:
//   AreaCollection — an area root (holds one bucket per bucket value)
//   TypeCollection — a per-type bucket inside an area (holds items of one type)
//   Special        — the Inbox / My Day / Agenda singletons, which belong to no area
// The two collection templates are told apart by the labels their notes carry:
// an AreaCollection has #area alone, a TypeCollection has #area plus #type.
// None of the three are part of the type dimension — they're fixed scaffolding,
// never offered as an assignable type value.
const AREA_TEMPLATE_TITLE = "AreaCollection"
const TYPE_TEMPLATE_TITLE = "TypeCollection"
const SPECIAL_TEMPLATE_TITLE = "Special"

// The #type values marking a note as a container rather than an item. They sit in
// the same namespace as the item slugs (#type=task, #type=goal) and must never
// collide with one, so a view filtering on an item type never picks up the
// scaffolding that holds it. These match the #type the manifest stamps on the
// template notes themselves.
const AREA_COLLECTION_TYPE = "areacollection"
const TYPE_COLLECTION_TYPE = "typecollection"
const SPECIAL_TYPE = "special"

// A BoxIcons class for a bucket comes from the bucket value's own `icon`
// (configured per value in the Dimensions editor); anything blank gets a neutral
// folder.
function bucketIcon(tpl) {
    return tpl.icon || "bx-folder"
}

// Build one Area node (+ one bucket per bucket value) from a root value
// { slug, name, color } and the bucket value list. `slug` is the #area
// value (e.g. "03-legal"); the area root carries #agendaOrganizeArea=<slug> and
// each bucket carries that SAME area label plus #agendaOrganizeBucket=<tplSlug>,
// its title the template's name, and its ~template the area/Special container
// template (a bucket is a container, not an instance of the type it holds).
function buildAreaNode(area, templateList) {
    const key = `area-${area.slug}`
    return {
        key,
        area: area.slug,
        title: area.name,
        icon: "bxs-circle",
        color: area.color,
        template: AREA_TEMPLATE_TITLE,
        // The #area value is note-specific (agenda's filters/colors/kanban key on
        // it) and can't come from the Area template. It's DERIVED (re-asserted
        // every run), not a seed, so an area-picker edit that renumbers a slug
        // self-heals the root notes' #area on the next provision run.
        areaValue: area.slug,
        // Marks the root as a container, paired with #area. An AreaCollection is
        // "#area, #type=areacollection"; a TypeCollection adds nothing to #area
        // but differs in #type. Derived (re-asserted every run).
        typeValue: AREA_COLLECTION_TYPE,
        seedLabels: [],
        children: (templateList || []).map(tpl => ({
            key: `${key}-${tpl.slug}`,
            area: area.slug,
            bucket: tpl.slug,
            title: tpl.name,
            icon: bucketIcon(tpl),
            // Buckets inherit their area's color; no other seed labels.
            color: area.color,
            template: TYPE_TEMPLATE_TITLE,
            // #type is what separates a bucket from its area root: both carry
            // #area, only the bucket carries #type. Its value is the fixed
            // container marker, NOT the slug of the type it holds — a bucket is a
            // container, not an instance, so #type=task must keep meaning "a task"
            // and never "the place tasks live". Which type a bucket holds is
            // already carried by #agendaOrganizeBucket=<tplSlug>. Derived
            // (re-asserted every run).
            typeValue: TYPE_COLLECTION_TYPE,
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
        { key: "inbox",  special: "inbox",  title: "Inbox",  icon: "bxs-inbox",   template: SPECIAL_TEMPLATE_TITLE, typeValue: SPECIAL_TYPE, seedLabels: [], children: [] },
        { key: "my-day", special: "my-day", title: "My Day", icon: "bx-task",     template: SPECIAL_TEMPLATE_TITLE, typeValue: SPECIAL_TYPE, seedLabels: [], children: [] },
        { key: "agenda", special: "agenda", title: "Agenda", icon: "bx-calendar", template: SPECIAL_TEMPLATE_TITLE, typeValue: SPECIAL_TYPE, seedLabels: [], children: [] },
        ...(areaList || []).map(area => buildAreaNode(area, templateList))
    ]
}

module.exports = {
    buildStructure,
    AREA_TEMPLATE_TITLE, TYPE_TEMPLATE_TITLE, SPECIAL_TEMPLATE_TITLE,
    AREA_COLLECTION_TYPE, TYPE_COLLECTION_TYPE, SPECIAL_TYPE
}
