// === Trilium Code note ===
// Title: structure.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by provision.js / the Setup page).
//
// The opinionated notebook layout this addon provisions. Fed by:
//   - the AREA list — the values of agenda's own root dimension (scaffoldsAreas):
//     [{ slug, name, color }].
//   - the TEMPLATE list — template-picker@beatlink's own enabled registry
//     entries: [{ noteId, name, icon }] in order. Item TYPE is no longer an
//     agenda dimension, so there is no bucket slug any more — a bucket's
//     identity IS the template's own noteId.
// This module supplies only the fixed structural parts (the three top-level
// container singletons, the two structural template titles, the container type
// markers) and assembles the full tree.
//
// SHAPE: two PARALLEL top-level trees, each exactly one level deep.
//
//   Inbox / My Day / Agenda      the singletons
//   Career/  Home/  ...          one root per area value, items directly inside
//   Task/    Project/  ...       one root per enabled template, items directly inside
//
// An item note lives in BOTH trees at once as a Trilium clone: one branch under
// the area root matching its #area, one under the type root matching its
// ~template. Neither tree nests the other -- an area root has no type buckets
// under it and a type root has no area buckets under it.
//
// This module only ever provisions the ROOTS. Cloning individual items into
// them is the Organize page's job, done per note during triage; nothing here
// creates, moves or reconciles item branches.
//
// buildStructure(areaList, templateList) returns an array of nodes;
// provision.js walks it, find-or-creating each note by title at its
// level and tagging it with its identity labels so the addon can resolve it
// later (see README.md).
//
// Identity is carried by three INDEPENDENT labels, one per kind of root:
//   #agendaOrganizeArea=<areaSlug>        on an area root
//   #agendaOrganizeType=<templateNoteId>  on a type root
//   #agendaOrganizeSpecial=<name>         on the Inbox / My Day / Agenda singletons
// The three are mutually exclusive: no structural note ever carries more than
// one, so "which kind of root is this?" is a single label read. (The retired
// #agendaOrganizeBucket marked a per-area type bucket back when the type axis
// nested INSIDE the area axis; the flat shape has no such note.)
//
// Those are the addon's PRIVATE identity labels, used to resolve notes during
// provisioning. Separately, the same notes carry the PUBLIC #area / #type labels
// that agenda's views and the user's own searches key on — an area root is
// "#area=<slug> #type=areacollection", a type root "#type=typecollection" with
// no #area at all (it spans every area). The two sets are kept distinct on
// purpose: swapping a root's backing template moves the private identity, but
// the public container markers stay fixed.
//
// A node:
//   key         stable identity for logging/diffing (not written to the note)
//   area        #agendaOrganizeArea value, when this node is an area root
//   typeRoot    #agendaOrganizeType value (a template noteId), when this node is
//               a type root
//   special     #agendaOrganizeSpecial value, for the top-level singletons
//   title       the note title matched on / created with
//   icon        BoxIcons class (without the leading "bx "); re-asserted every run
//   color       CSS color for the note's #color label; re-asserted every run
//               (area-picker convention). Omitted -> no #color managed.
//   areaValue   #area value; re-asserted every run. Omitted -> no #area managed.
//   typeValue   #type value; re-asserted every run. For structural notes this is
//               a container marker (areacollection / typecollection), never the
//               noteId of an item template. Omitted -> no #type managed.
//   template    title of a *structural* bundled template (AreaCollection /
//               TypeCollection / Special) to set as a ~template relation, resolved
//               live at provision time: area roots are AreaCollection, type roots
//               are TypeCollection, the singletons are Special. A type root is a
//               container, not an instance of the type it holds.
//   seedLabels  [{ name, value }] labels set ONLY when the note is first CREATED
//               (never re-asserted, so user edits to them survive adoption/re-runs)
//   children    nested nodes provisioned under this one
//
// Idempotency: icon, color and template are DERIVED — re-asserted (setLabel /
// setRelation overwrite) on every provision run, including on adopted pre-existing
// notes. seedLabels and note content are only touched at creation.

// Structural (non-item) template titles, one per kind of container:
//   AreaCollection — a top-level area root (holds the items of one area, any type)
//   TypeCollection — a top-level type root (holds the items of one type, any area)
//   Special        — the Inbox / My Day / Agenda singletons, which belong to no area
// The two collection templates are told apart by the labels their notes carry:
// an AreaCollection has #area plus #type=areacollection, a TypeCollection has
// #type=typecollection and no #area (it spans every area).
// None of the three is meant to be assigned as an item's own type. Two of them
// ship with this addon; AreaCollection ships with template-picker@beatlink,
// where its registry row must stay DISABLED or Setup would scaffold a type root
// for a container template. All three are resolved by title, not by location.
const AREA_TEMPLATE_TITLE = "AreaCollection"
const TYPE_TEMPLATE_TITLE = "TypeCollection"
const SPECIAL_TEMPLATE_TITLE = "Special"

// The #type values marking a note as a container rather than an item. They sit in
// the same namespace as a template's own #type (if any) and must never collide
// with one, so a view filtering on an item type never picks up the scaffolding
// that holds it. These match the #type the manifest stamps on the template
// notes themselves.
const AREA_COLLECTION_TYPE = "areacollection"
const TYPE_COLLECTION_TYPE = "typecollection"
const SPECIAL_TYPE = "special"

// A BoxIcons class for a type root comes from the template's own `icon`
// (configured per row in template-picker's registry); anything blank gets a
// neutral folder.
function typeRootIcon(tpl) {
    return tpl.icon || "bx-folder"
}

// Build one top-level Area root from a root value { slug, name, color }. It
// carries #agendaOrganizeArea=<slug> and holds this area's items directly — no
// per-type buckets underneath, so no children.
function buildAreaNode(area) {
    return {
        key: `area-${area.slug}`,
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
        // "#area, #type=areacollection"; a TypeCollection carries no #area at
        // all. Derived (re-asserted every run).
        typeValue: AREA_COLLECTION_TYPE,
        // Pin open so expanded@beatlink keeps the root expanded in the tree.
        // Derived (re-asserted every run) — see provisionNode.
        alwaysExpanded: true,
        seedLabels: [],
        children: []
    }
}

// Build one top-level Type root from a template-picker registry entry
// { noteId, name, icon }. It carries #agendaOrganizeType=<templateNoteId> and
// holds this type's items directly, across every area — so no children, and no
// #area label (it belongs to all of them).
//
// Its own ~template stays TypeCollection: a type root is a CONTAINER, not an
// instance of the type it holds, even though it files notes whose ~template is
// that type. Which template it collects is carried by #agendaOrganizeType.
function buildTypeNode(tpl) {
    return {
        key: `type-${tpl.noteId}`,
        typeRoot: tpl.noteId,
        title: tpl.name,
        icon: typeRootIcon(tpl),
        template: TYPE_TEMPLATE_TITLE,
        typeValue: TYPE_COLLECTION_TYPE,
        alwaysExpanded: true,
        seedLabels: [],
        children: []
    }
}

// The full structure for a given area + template list: three top-level container
// singletons, then one top-level root per area, then one top-level root per
// enabled template. Every node is a top-level container with no children —
// items are cloned into them by the Organize page, two branches per item (its
// area root and its type root). Singletons use the Special container template.
function buildStructure(areaList, templateList) {
    return [
        { key: "inbox",  special: "inbox",  title: "Inbox",  icon: "bxs-inbox",   template: SPECIAL_TEMPLATE_TITLE, typeValue: SPECIAL_TYPE, seedLabels: [], children: [] },
        { key: "my-day", special: "my-day", title: "My Day", icon: "bx-task",     template: SPECIAL_TEMPLATE_TITLE, typeValue: SPECIAL_TYPE, seedLabels: [], children: [] },
        { key: "agenda", special: "agenda", title: "Agenda", icon: "bx-calendar", template: SPECIAL_TEMPLATE_TITLE, typeValue: SPECIAL_TYPE, seedLabels: [], children: [] },
        ...(areaList || []).map(buildAreaNode),
        ...(templateList || []).map(buildTypeNode)
    ]
}

module.exports = {
    buildStructure,
    AREA_TEMPLATE_TITLE, TYPE_TEMPLATE_TITLE, SPECIAL_TEMPLATE_TITLE,
    AREA_COLLECTION_TYPE, TYPE_COLLECTION_TYPE, SPECIAL_TYPE
}
