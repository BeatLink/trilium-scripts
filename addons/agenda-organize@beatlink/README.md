# Agenda Organize

The opinionated GTD Organize workflow, split out of `agenda@beatlink` into its own addon: the
**Organize** render page and the **Organize Editor** settings page. It bakes a specific triage flow
on top of agenda's generic engine,
driven by the open-ended **dimensions** vocabulary (area, priority, and any you add) plus
[`template-picker@beatlink`](../template-picker@beatlink/README.md)'s own registry for item type.
It reuses agenda's mechanism (config, filters, colors, kanban, task widget) — it does not fork it.

## Configuration and cross-addon reads

This addon owns its own settings note (`organizeSchema.json` / `organizeConfig.json`) tagged
**`#agendaOrganizeConfig`**: the **Organize Note** picker, the four quick-times and the **`dimensions`**
registry. Everything is edited from the **Organize Editor** page.

The **`dimensions`** registry lives in that same note, so nothing here reads another addon's
configuration. [`agenda@beatlink`](../agenda@beatlink/README.md) keeps its own separate registry of the
same shape in `#agendaConfig`, for the Overview's derived prefix/color/grouping/filter variants and its
sort ordinals. The two are edited independently and are free to diverge: a vocabulary you want in both
places is entered in both places.

The **Inbox** is not read from config: `organize.js` finds it by the `#agendaOrganizeSpecial=inbox`
label, which you put on your own Inbox note.

## Where the roots come from

**Nothing provisions them.** The scaffolder addon that used to build the tree is gone; you make the
root notes yourself and tag them with the three structural identity labels this addon reads
(`#agendaOrganizeArea` / `#agendaOrganizeType` / `#agendaOrganizeSpecial` — see
[Root contract](#4-root-contract)). [`template-picker@beatlink`](../template-picker@beatlink/README.md)
ships an empty, unlabelled root container note per bundled template as a starting point; move them
where you want them and add the identity label.

Until roots carry those labels the triage queues are simply empty — the addon reads them, it never
writes them.

The labels keep their `agendaOrganize*` names: renaming them would orphan every root in an existing
tree for no benefit.

## 1. Purpose / workflow

An opinionated system that guides a **Collect → Organize → Review → Execute** workflow.

- **Collect** — process your inboxes (email, bookmarks, files, notes, photos, browser tabs, …) into
  the Inbox note. Capture the raw item here; attributes are set later, in Organize.
- **Organize** — set each item's dimension values (**`#area`**, **`#priority`**, or any you add), its
  **`~template`** (item type, via template-picker's own widget or the Missing Templates page), and
  **start date**, and fix misfiled notes. This is the fully-built page (`organizePage.jsx`).
- **Review** — Daily: Must Do + overdue, date-sorted. Weekly: sweep by Area to catch drift. These map
  onto agenda's Task View page modes + sorts; no separate code.
- **Execute** — work the daily list. Uses the same agenda views.

## 2. Dimensions

This addon owns one open-ended **`dimensions`** registry, declared in
[`organizeSchema.json`](organizeSchema.json) and shipped in [`organizeDefaults.json`](organizeDefaults.json),
loaded by [`dimensions.js`](dimensions.js) → `getDimensions()`. A dimension is one
note label plus its ordered vocabulary of values `[{ key, name, color, actionable, icon }]`; area and
priority ship as defaults, but the set is open-ended. The triage queues enumerate the registered
dimensions, so adding one needs no code change. `key` is the stored value (stable and order-free, so
reordering never rewrites a tagged note); position IS the order.

`agenda@beatlink` declares a registry of the same shape in its own `#agendaConfig`, minus the four
Organize-only flags below, for the Overview's sort ordinals and derived display elements. Neither addon
reads the other's config note.

Item **type** is deliberately NOT one of these dimensions — it moved out entirely to
[`template-picker@beatlink`](../template-picker@beatlink/README.md)'s own registry. A note's type is
its `~template` relation, assigned by template-picker's own right-pane widget (or its Missing Templates
page), never a `#type` label agenda writes. Organize reads that registry read-only, via
`getBucketTemplates()` in [`organize.js`](organize.js) (discovered through template-picker's own
`#templatePickerConfig` anchor, the same shape agenda uses for its own `#agendaConfig`) — to tell a
Type root's identity from a current template and for the actionable-item set. See
[template-picker's README](../template-picker@beatlink/README.md) for its own registry fields
(Name, Template Note, Enabled, Color, Actionable, Bucket Icon).

`assignDimension(noteId, dim, value)` is the single write path for these dimensions (used by
the Organize triage queues). It writes `#<label>=<key>` and optionally mirrors `#color`
(`writeColor`). Per-dimension flags:

| Flag               | Effect |
|--------------------|--------|
| `triage`           | Gives the dimension a "Notes Without X" queue. |
| `actionableOnly`   | Restricts that queue to notes whose `~template` is a template-picker entry marked **Actionable** (and non-subtasks). |
| `writeColor`       | Also writes `#color` from the chosen value. |
| `scaffoldsAreas`   | Marks the axis that gets one root note per value (the Area axis). |

**Actionable** and the per-template **Bucket Icon** live on template-picker's own registry rows now,
not on any dimension value. `#agendaTaskWidget` is a separate, orthogonal label: it gates
whether the Task editor shows at all. It's set as an inheritable label on the template note.
Classification (area, priority, item type) is assigned via each dimension's own dedicated picker
addon, not the Task editor.

Folding or renaming an Area value leaves its old slug on already-tagged notes; nothing re-keys them
automatically any more, so retag them yourself (the **Invalid Roots** table surfaces the stranded
root). Type roots need no equivalent: a Type root's identity is its template's own noteId, which
never gets renamed the way a string slug did.

### Notebook structure

**Two parallel top-level trees, each exactly one level deep**, plus the three container singletons:

```
Inbox / My Day / Agenda
Career/   Home/   Fitness/  …     one root per Area value, items directly inside
Task/     Project/  Note/   …     one root per enabled template, items directly inside
```

Neither tree nests the other: an Area root has no type buckets under it, and a Type root has no area
buckets under it. A filed item lives in **both** trees at once as a Trilium **clone** — one branch
under the Area root matching its `#area`, one under the Type root matching its `~template`. The same
note, two paths to it.

You create the **roots**; cloning an item into its two roots is the Organize page's job, done per
note during triage.

The public `#area` / `#type` labels are what tell the kinds of container apart. Only
`AreaCollection` still ships as a template (with
[`template-picker@beatlink`](../template-picker@beatlink/README.md)); the other two rows are label
conventions with no template behind them any more:

| Note              | Template         | Public labels                          |
|-------------------|------------------|----------------------------------------|
| Area root         | `AreaCollection` | `#area=<slug>` `#type=areacollection`  |
| Type root         | none             | `#type=typecollection` (no `#area`)    |
| Inbox/My Day/Agenda | none           | `#type=special`                        |

A Type root carries **no `#area`** — it spans every area. It is a *container*, not an instance of the
type it holds, so its `#type` is the fixed `typecollection` marker even though it files notes whose
`~template` is something else entirely. Which template it collects is carried by the private
identity label `#agendaOrganizeType=<templateNoteId>`.

The three private identity labels are **mutually exclusive** — `#agendaOrganizeArea=<areaSlug>` on an
Area root, `#agendaOrganizeType=<templateNoteId>` on a Type root, `#agendaOrganizeSpecial=<name>` on a
singleton — so "which kind of root is this?" is a single label read.

## 3. The Organize page (`organizePage.jsx`)

Two tabs: **Triage** (the one-at-a-time queues) and **Dimensions** (`DimensionsPanel` from
[`organizeDimensions.jsx`](organizeDimensions.jsx)). The Dimensions tab edits this addon's own
`#agendaOrganizeConfig` — a single-tab `SettingsForm` scoped `only="Dimensions"`. Editing a value's **Name** or
reordering the list is safe; editing its **Key** orphans every note carrying that value. Item type
isn't here at all — it's edited on template-picker's own settings note.

The Triage tab loads the dimension list plus template-picker's enabled registry
(`getBucketTemplates()`) up front, then `organize.js` does a single backend walk of the Inbox / Area
/ Type subtrees — de-duped by noteId, since a filed item is reachable from two roots — excluding the
structural (identity-labelled) notes, tagging each candidate with its
per-dimension `assigned` map (`{ [label]: value }`), a `suggested` map (nearest ancestor's value per
dimension), its `~template` noteId (`templateId`), and `isSubtask` / `hasStartDate` / `path` /
`preview`. The page keeps that list in state and filters it per section; a mutation patches the list in
place so the acted-on note leaves its queue. Sections:

1. **One "Notes Without X" queue per triaged dimension**, in config order — buttons are the
   dimension's values (color-coded); the nearest-ancestor value is highlighted as the suggestion;
   clicking calls `assignDimension`. An `actionableOnly` dimension (priority by default) restricts to
   notes whose `~template` is marked Actionable in template-picker's registry, and non-subtasks. Add a
   dimension and another queue appears with no code change. There is no "Notes Without Type" queue here
   — that's template-picker's own **Missing Templates** page.
2. **Tasks Without a Start Date** — a two-step date + time picker; writes `#startDateTime`,
   `#startDate`, `#startTime` (agenda's default label names). Subtasks (parent is itself an actionable
   note) are excluded. The Morning / Noon / Evening / Night times come from agenda's config (Agenda
   Editor → **Organize › Times** tab), read via `getAgendaSettings()`.
3. **Misfiled Notes** — each note is checked **once per axis it's filed under**, and the axis of the
   root decides what's compared: under an Area root, its own `#area` must match that root; under a
   Type root, its own `~template` must match that root. Fixes are Move / Set-area / Set-type
   (Set-area calls `assignDimension` on the root dimension; Set-type calls `assignTemplate` directly,
   since there's no dimension to route it through any more). A Move re-parents only the offending
   branch, leaving the note's clone on the *other* axis alone. A note with no value on the axis being
   checked is unclassified, not misfiled — that's the per-dimension queues' job (and, for a missing
   `~template`, the Missing Templates page's). A note filed under only one of the two axes is
   likewise *incompletely* filed rather than misfiled, so it isn't double-reported here.
4. **Invalid Roots** — structural roots whose identity no longer maps to a current vocabulary: an Area
   root (`#agendaOrganizeArea`) whose slug is no longer a current Area value, or a Type root
   (`#agendaOrganizeType`) whose noteId is no longer a currently-enabled template. Each root is judged
   on its **own axis only** — an Area root has no template and a Type root has no area, so neither is
   marked invalid over a value it was never meant to carry. Legacy nested buckets (carrying
   `#agendaOrganizeBucket`) surface here too, on their area half, since the flat structure never
   recreates them and merging one away is exactly the right cleanup.
   `getInvalidBuckets(rootDim, bucketTemplates)` returns them plus the list of *valid* roots as merge
   destinations. Unlike the one-at-a-time queues above, this is a **table** (all invalid roots at
   once — it's a cleanup list, not a triage flow): a row per root showing its title/path, why it's
   invalid, its note count, and a merge-target `<select>` + **Merge** / **Delete** actions. Merge
   (`mergeBucketInto`) moves the root's children into the selected valid root, migrates its body
   under a "Merged from" heading, then deletes the emptied husk on verified-empty; Delete
   cascade-deletes it (the confirm warns when the root still holds notes). Provisioning does no
   automatic folding of its own, so every orphan ends up here for an explicit decision.

## 4. Root contract

**Gone.** There is no provisioner: the scaffolder addon, the find-or-create walk, the identity-label
writes and the legacy `#workflowNote` / area-slug migrations were all removed along with the two
structural templates it shipped.

What matters on this side is only the **contract**, which you now satisfy by hand:

- `#agendaOrganizeArea=<areaSlug>` on an Area root
- `#agendaOrganizeType=<templateNoteId>` on a Type root
- `#agendaOrganizeSpecial=<name>` on the `inbox` / `my-day` / `agenda` singletons

They are mutually exclusive, so "which kind of root is this?" stays a single label read. `organize.js`
keys every queue off them, excludes structural notes from the candidate walk on the same basis, and
surfaces roots whose slug or template id is no longer current in the **Invalid Roots** table.

Nothing here ever creates, moves or deletes a root — the only structural writes this addon makes are
the Invalid Roots table's explicit Merge / Delete actions.

## 5. Wiring

Organize has **no shipped render page**. `organizePage.jsx` (`organize-page-src`, tagged
`#agendaOrganizeRender`) is a plain code note; the render surface is an **external user-chosen note**.
The **Organize Note** picker on the Organize Editor persists `organizeNoteId` in the
shared config and, on change, reconciles the chosen note on the backend: sets its `type` to `render`,
its `~renderNote` relation to the `#agendaOrganizeRender` code note, and its `#iconClass` to
`bx bx-sort-down` — reverting the previously-chosen note back to a text note. (See
`reconcileOrganizeNote` in [`organizeEditor.jsx`](organizeEditor.jsx).)

`organizePage.jsx` imports `DimensionsPanel` (`organizeDimensions.jsx`) and requires `organize.js`,
`dimensions.js` and `organizeSettings.js`. `organize.js` requires
`templateRegistry.jsx` directly — this addon's manifest declares its own `registry` note (same
`sourceUrl` as template-picker@beatlink's `templateRegistry.jsx`, so TAM's sourceUrl dedup clones
it in rather than re-fetching if template-picker is already installed). This is a one-directional
read: the copy tracks template-picker's registry content, but template-picker knows nothing about
Organize.

The Organize Editor (`organizeEditor.jsx`) hosts three tabs — **Times** and **Dimensions** straight
from the schema, plus the **Organize Note** picker as an `extraPanels` entry. There is no Workflow
Setup tab: nothing on this side provisions structure.

Per TAM's direct-child require rule, `dimensions` is a child of every note that requires it
(`organize-page-src`), and libsettings' `ui` is wired under
every note that calls `loadSettings`/`SettingsForm`. Styling is `organize.css` (`appCss`).
