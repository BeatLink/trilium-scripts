# Agenda Organize

The opinionated GTD Organize workflow, split out of `agenda@beatlink` into its own addon: the
**Organize** render page, the **Workflow Setup** provisioner, and the **Organize Editor** settings
page. It bakes a specific notebook structure and triage flow on top of agenda's generic engine,
driven by the open-ended **dimensions** vocabulary (area, priority, and any you add) plus
[`template-picker@beatlink`](../template-picker@beatlink/README.md)'s own registry for item type.
It reuses agenda's mechanism (config, filters, colors, kanban, task widget) — it does not fork it.

## Configuration and cross-addon reads

This addon owns its own settings note (`organizeSchema.json` / `organizeConfig.json`) tagged
**`#agendaOrganizeConfig`**: the **Organize Note** picker and the four quick-times. Everything is
edited from the **Organize Editor** page.

The **`dimensions`** registry deliberately stays in [`agenda@beatlink`](../agenda@beatlink/README.md)'s
`#agendaConfig` and is read cross-addon (see `organizeSettings.js`). Agenda's Overview derives its
prefix/color/grouping/filter variants from the same list these triage queues write to, so a local
copy would silently drift out of sync — one registry, read from whoever owns it. The Dimensions tab
renders an explanatory note when agenda isn't installed, and the scaffolding plus start-date triage
still work without it.

The **Inbox** is not read from config: `organize.js` finds it by the `#agendaOrganizeSpecial=inbox`
label that this addon's own Workflow Setup provisions.

## 1. Purpose / workflow

An opinionated system that guides a **Collect → Organize → Review → Execute** workflow.

- **Collect** — process your inboxes (email, bookmarks, files, notes, photos, browser tabs, …) into
  the Inbox note. Capture the raw item here; attributes are set later, in Organize. The **Inbox Note**
  is a setting (Agenda Editor → **Collect › Inbox**, `inboxNoteId` in the shared config), preselected
  to Trilium's own inbox (a `#inbox`-tagged note) on first open and exposed via `getAgendaSettings()`
  so collection addons can file into the same place.
- **Organize** — set each item's dimension values (**`#area`**, **`#priority`**, or any you add), its
  **`~template`** (item type, via template-picker's own widget or the Missing Templates page), and
  **start date**, and fix misfiled notes. This is the fully-built page (`organizePage.jsx`).
- **Review** — Daily: Must Do + overdue, date-sorted. Weekly: sweep by Area to catch drift. These map
  onto agenda's Task View page modes + sorts; no separate code.
- **Execute** — work the daily list. Uses the same agenda views.

## 2. Dimensions

Agenda owns one open-ended **`dimensions`** registry in [`agenda@beatlink`'s `common/schema.json`](../agenda@beatlink/common/schema.json),
loaded by [`dimensions.js`](../agenda@beatlink/common/dimensions.js) → `getDimensions()`. A dimension is one
note label plus its ordered vocabulary of values `[{ key, name, color, actionable, icon }]`; area and
priority ship as defaults, but the set is open-ended. Triage queues, sort ordinals, and the derived
prefix/color/grouping/filter variants all enumerate the registered dimensions, so adding one needs no
code change. `key` is the stored value (stable and order-free, so reordering never rewrites a tagged
note); position IS the order.

Item **type** is deliberately NOT one of these dimensions — it moved out entirely to
[`template-picker@beatlink`](../template-picker@beatlink/README.md)'s own registry. A note's type is
its `~template` relation, assigned by template-picker's own right-pane widget (or its Missing Templates
page), never a `#type` label agenda writes. Organize reads that registry read-only, via
`getBucketTemplates()` in [`organize.js`](organize.js) (discovered through template-picker's own
`#templatePickerConfig` anchor, the same shape agenda uses for its own `#agendaConfig`) — for bucket
scaffolding and the actionable-item set only. See
[template-picker's README](../template-picker@beatlink/README.md) for its own registry fields
(Name, Template Note, Enabled, Color, Actionable, Bucket Icon).

`assignDimension(noteId, dim, value)` is the single write path for agenda's own dimensions (used by
the Organize triage queues). It writes `#<label>=<key>` and optionally mirrors `#color`
(`writeColor`). Per-dimension flags:

| Flag               | Effect |
|--------------------|--------|
| `triage`           | Gives the dimension a "Notes Without X" queue. |
| `actionableOnly`   | Restricts that queue to notes whose `~template` is a template-picker entry marked **Actionable** (and non-subtasks). |
| `writeColor`       | Also writes `#color` from the chosen value. |
| `scaffoldsAreas`   | Workflow Setup builds one root note per value (the Area axis). |

**Actionable** and the per-template **Bucket Icon** live on template-picker's own registry rows now,
not on any agenda dimension value. `#agendaTaskWidget` is a separate, orthogonal label: it gates
whether the Task editor shows at all. It's set as an inheritable label on the template note.
Classification (area, priority, item type) is assigned via each dimension's own dedicated picker
addon, not the Task editor.

Area folds/renames are handled at migration time by `AREA_ALIASES` in `organizeProvision.js`
(`health`→`fitness`, `productivity`→`tech`), so existing notes re-tag on the next Setup provision.
There is no equivalent table for Type roots — a Type root's identity is its template's own noteId,
which never gets renamed the way a string slug did.

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

Setup provisions the **roots only**. Cloning an item into its two roots is the Organize page's job,
done per note during triage; provisioning never creates, moves, or reconciles item branches, so
re-running it can't disturb anything you've filed.

Each kind of container has its own structural template, and the public `#area` / `#type` labels are
what tell them apart:

| Note              | Template         | Public labels                          |
|-------------------|------------------|----------------------------------------|
| Area root         | `AreaCollection` | `#area=<slug>` `#type=areacollection`  |
| Type root         | `TypeCollection` | `#type=typecollection` (no `#area`)    |
| Inbox/My Day/Agenda | `Special`      | `#type=special`                        |

A Type root carries **no `#area`** — it spans every area. It is a *container*, not an instance of the
type it holds, so its `#type` is the fixed `typecollection` marker and its OWN `~template` stays
`TypeCollection`, even though it files notes whose `~template` is something else entirely. Which
template it collects is carried by the private identity label `#agendaOrganizeType=<templateNoteId>`.

The three private identity labels are **mutually exclusive** — `#agendaOrganizeArea=<areaSlug>` on an
Area root, `#agendaOrganizeType=<templateNoteId>` on a Type root, `#agendaOrganizeSpecial=<name>` on a
singleton — so "which kind of root is this?" is a single label read.

## 3. The Organize page (`organizePage.jsx`)

Two tabs: **Triage** (the one-at-a-time queues) and **Dimensions** (`DimensionsPanel` from
[`organizeDimensions.jsx`](organizeDimensions.jsx)). The Dimensions tab edits
`agenda@beatlink`'s `#agendaConfig` cross-addon (see the note at the top of this file) — a single-tab
`SettingsForm` scoped `only="Dimensions"`. Editing a value's **Name** or
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

## 4. Provisioning model — runtime find-or-create

The notebook *structure* is provisioned by the **Workflow Setup** button (Organize Editor → Organize ›
Workflow Setup), not cloned in via the manifest, so it merges with notes the user already created by
hand. `provisionStructure(dimensions)` (`organizeProvision.js`) reduces the Area dimension to a
`{ slug, name, color }` list and pulls the template list straight from template-picker's own enabled
registry entries (`{ noteId, name, icon }`, via `getBucketTemplates()`), then hands both to
`organizeStructure.js`'s `buildStructure(areaList, templateList)`; the walk/find-or-create logic is
`organizeProvision.js`.

**Containers only.** Provisioning creates the top-level roots and nothing else. Filing items into
them — the two clones per note — is the Organize page's per-note job, so provisioning never creates,
moves, reconciles or deletes an item branch. Re-running Setup cannot disturb anything you've filed.

- **Identity:** carried by three **mutually exclusive** labels — this addon's analogue of TAM's
  `#TAMFILEID`, scoped to user notes:
  - `#agendaOrganizeArea=<areaSlug>` — on an Area root
  - `#agendaOrganizeType=<templateNoteId>` — on a Type root
  - `#agendaOrganizeSpecial=<name>` — on the `inbox` / `my-day` / `agenda` singletons

  No structural note ever carries more than one, so "which kind of root is this?" is a single label
  read. Neither value is parsed out of a composite string, which is what made renames and area
  renumbering fragile. A Type root's identity is the template's own noteId — stable by construction,
  unlike the string slug it replaced, so there's no rename/reorder case to migrate for it.

  The retired `#agendaOrganizeBucket` marked a per-area type bucket back when the type axis nested
  *inside* the area axis. Nothing writes it any more; it's still *read* in two places, since a legacy
  bucket also carries an area label and must not be mistaken for an Area root: the area-root lookup
  excludes it, and the Invalid Roots table surfaces it for cleanup.
- **Resolution per node (idempotent, rename-safe):** (1) a note already carrying this exact identity
  → adopt; (2) else a same-titled child under the parent → adopt + tag; (3) else create + tag.
- **Legacy migration:** trees provisioned before the split carry a single `#workflowNote=<key>`.
  `migrateStructuralLabels()` re-stamps them onto the identity labels and runs first on every
  provision, so an existing structure is converted in place rather than rebuilt alongside. The old
  *bucket* key shape (`area-<slug>-<templateSlug>`) has no equivalent under the flat structure — a
  note nested inside an area root is not one of today's top-level roots, and stamping it with either
  identity label would make provisioning adopt a nested note as a root. Those keys are reported as
  `unparsed` and left completely untouched, legacy label intact, so the notes stay where they are.
- **Derived vs. seed:** icon (`#iconClass`), `#color`, `~template`, an Area root's `#area`, and each
  root's `#alwaysExpanded` are re-asserted on *every* run (self-healing). Note content and
  `seedLabels` are written only on creation, so user edits survive.
- **Area-slug migration:** after the walk, `migrateAreaSlugs()` normalizes every note carrying
  `#area` onto the area dimension's stable keys — stripping the legacy `<NN>-` prefix and applying
  `AREA_ALIASES` for folded areas — rewriting `#area` + `#color` when the value changes. Idempotent:
  an already-stable value resolves to itself, so re-running migrates nothing. Reordering areas no
  longer rewrites notes at all; display order comes from the value list's position (see
  `getSortValueMaps` in [`dimensions.js`](../agenda@beatlink/common/dimensions.js)).
- **Structural templates** are resolved live by title (`AreaCollection` for Area roots,
  `TypeCollection` for Type roots, `Special` for the three singletons), so provisioning degrades
  gracefully if a template note is missing — the note is still created and tagged, just without a
  `~template` relation. The *item* templates that Type roots are named after are template-picker's
  own registry entries, assigned directly on the items (via template-picker's widget), never on the
  roots.
- **Provisioning never deletes.** It creates, adopts and re-asserts derived attributes; that's all.
  Every orphan and duplicate is surfaced in the **Invalid Roots** table for an explicit
  merge-or-delete decision instead of being folded automatically. (The previous nested shape needed
  an auto-folding pass to reconcile duplicate `(area, bucket)` buckets; with one root per identity
  at the top level there is nothing left for it to reconcile.)
- **Root drift:** disabling or deleting a template-picker entry orphans its Type root — re-running
  Setup no longer provisions anything for it (it's not enumerated any more), and the orphan surfaces
  in Organize's **Invalid Roots** table for manual merge/delete. Reordering template-picker's
  registry only reorders new roots' creation order; existing roots are unaffected since they're
  resolved by identity, not position. The same holds for an Area value removed from the dimension.
- Items get their `~template` + `#area` set **programmatically at creation** (not via inheritable
  attributes on a root), so a note keeps its identity wherever it's later filed — which is what lets
  the same note sit in an Area root and a Type root without either one defining it.

## 5. Wiring

Organize has **no shipped render page**. `organizePage.jsx` (`organize-page-src`, tagged
`#agendaOrganizeRender`) is a plain code note; the render surface is an **external user-chosen note**.
The **Organize Note** picker on the Organize Editor persists `organizeNoteId` in the
shared config and, on change, reconciles the chosen note on the backend: sets its `type` to `render`,
its `~renderNote` relation to the `#agendaOrganizeRender` code note, and its `#iconClass` to
`bx bx-sort-down` — reverting the previously-chosen note back to a text note. (See
`reconcileOrganizeNote` in [`organizeEditor.jsx`](organizeEditor.jsx).)

`organizePage.jsx` imports `getAgendaSettings` (`agendaSettings.jsx`) and `DimensionsPanel`
(`organizeDimensions.jsx`), and requires `organize.js` + `dimensions.js`. `organize.js` requires
`templateRegistry.jsx` directly — agenda's own manifest declares its own `registry` note (same
`sourceUrl` as template-picker@beatlink's `templateRegistry.jsx`, so TAM's sourceUrl dedup clones
it in rather than re-fetching if template-picker is already installed), wired as a direct child of
both `organize-lib` (`organize.js`) and `organize-provision` (`organizeProvision.js`), since both
`require()` it. This is a one-directional read: agenda's copy tracks template-picker's registry
content, but template-picker knows nothing about agenda. Workflow Setup is a tab folded
into the Organize Editor (`organizeEditor.jsx`), which requires `organizeProvision.js` (→ requires
`organizeStructure.js` + `organize.js`, for `getBucketTemplates`) and `dimensions.js`. Per TAM's
direct-child require rule, `dimensions` is a child of every note that requires it (`agenda-settings`,
`lib-config`, `organize-page-src`, `organize-dimensions`, `organize-provision`,
`profile-editor`), `organize-structure` is a child of both `organize-page-src` and `organize-provision`,
and libsettings' `ui` is wired under every note that calls `loadSettings`/`SettingsForm` (`dimensions`,
`organize-dimensions`, `profile-editor`, `agenda-settings`, `lib-config`). Styling is `organize.css`
(`appCss`).
