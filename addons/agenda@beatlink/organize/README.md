# Organize — design notes

Design doc for the opinionated GTD Organize workflow that ships inside `agenda@beatlink` (the
`organize/` module + the **Organize** render page and the **Workflow Setup** tab in the Agenda
Editor). It bakes a specific notebook structure and triage flow on top of agenda's generic engine,
driven by agenda's own open-ended **dimensions** vocabulary. It reuses agenda's mechanism (config,
filters, colors, kanban, task widget) — it does not fork it.

## 1. Purpose / workflow

An opinionated system that guides a **Collect → Organize → Review → Execute** workflow.

- **Collect** — process your inboxes (email, bookmarks, files, notes, photos, browser tabs, …) into
  the Inbox note. Capture the raw item here; attributes are set later, in Organize. The **Inbox Note**
  is a setting (Agenda Editor → **Collect › Inbox**, `inboxNoteId` in the shared config), preselected
  to Trilium's own inbox (a `#inbox`-tagged note) on first open and exposed via `getAgendaSettings()`
  so collection addons can file into the same place.
- **Organize** — set each item's dimension values (**`#area`**, **`#type`**, **`#priority`**, or any
  you add) and **start date**, and fix misfiled notes. This is the fully-built page
  (`organizePage.jsx`).
- **Review** — Daily: Must Do + overdue, date-sorted. Weekly: sweep by Area to catch drift. These map
  onto agenda's Task View page modes + sorts; no separate code.
- **Execute** — work the daily list. Uses the same agenda views.

## 2. Dimensions

Agenda owns one open-ended **`dimensions`** registry in [`common/schema.json`](../common/schema.json),
loaded by [`../common/dimensions.js`](../common/dimensions.js) → `getDimensions()`. A dimension is one
note label plus its ordered vocabulary of values `[{ key, name, color, templateNoteId, actionable,
icon }]`; area, type and priority ship as defaults, but the set is open-ended. Everything —
Task-pane pickers, triage queues, sort ordinals, and the derived prefix/color/grouping/filter variants
— enumerates the registered dimensions, so adding one needs no code change. `key` is the stored value
(stable and order-free, so reordering never rewrites a tagged note); position IS the order.

`assignDimension(noteId, dim, value)` is the single write path (shared by the Task pane and the triage
queues). It writes `#<label>=<key>`, optionally mirrors `#color` (`writeColor`), and — for the type
dimension — sets `~template` from the value's `templateNoteId`. Per-dimension flags:

| Flag               | Effect |
|--------------------|--------|
| `triage`           | Gives the dimension a "Notes Without X" queue. |
| `actionableOnly`   | Restricts that queue to notes whose `#type` is an **actionable** value (and non-subtasks). |
| `writeColor`       | Also writes `#color` from the chosen value. |
| `picker`           | Shows the dimension's dropdown in the Task pane. |
| `scaffoldsAreas`   | Workflow Setup builds one root note per value (the Area axis). |
| `scaffoldsBuckets` | Workflow Setup builds one bucket per value inside every root (the Type axis). |
| value `actionable` | Items of this type flow through the actionable-only queues. |
| value `templateNoteId` | Assigning the value also sets `~template` to this note. |
| value `icon`       | The bucket's icon (type dimension). |

**Type note ids** can't ship as defaults (install-specific), so the shipped type values leave
`templateNoteId` blank. `matchTemplatesByName()` fills each blank one by matching its Name against a
`#template` note's title; it runs at the end of provisioning (fresh installs self-heal) and behind the
**Match Templates By Name** button in the Dimensions panel. The structural templates (`AreaCollection`,
`TypeCollection`, `Special`) are just not listed as type values, so scaffolding is never assignable.

**Actionable** used to be read off each template note's `#agendaTaskWidget` label; it is now the type
value's own `actionable` flag. `#agendaTaskWidget` still exists but only gates whether the **Task
editor mounts** on a note — two separate concepts that used to be one.

Folds/renames are handled at migration time by `AREA_ALIASES` / `TEMPLATE_ALIASES` in
`organizeProvision.js` (`health`→`fitness`, `productivity`→`tech`), so existing notes re-tag on the
next Setup provision.

### Notebook structure
Three top-level container singletons — **Inbox** (`bxs-inbox`), **My Day** (`bx-task`), **Agenda**
(`bx-calendar`) — then one note per value of the root dimension (Area, `bxs-circle`), each containing
**one bucket per value of the bucket dimension** (Type, in config order), titled by the value's name.

Each kind of container has its own structural template, and the public `#area` / `#type` labels are
what tell them apart:

| Note              | Template         | Public labels                          |
|-------------------|------------------|----------------------------------------|
| Area root         | `AreaCollection` | `#area=<slug>` `#type=areacollection`  |
| Per-type bucket   | `TypeCollection` | `#area=<slug>` `#type=typecollection`  |
| Inbox/My Day/Agenda | `Special`      | `#type=special`                        |

A bucket is a *container*, not an instance of the type it holds — so its `#type` is the fixed
`typecollection` marker, never the slug of its items (`#type=task` keeps meaning "a task"). Which type
a bucket holds is carried by the private identity label `#agendaOrganizeBucket=<templateSlug>`,
alongside `#agendaOrganizeArea=<areaSlug>`.

## 3. The Organize page (`organizePage.jsx`)

Two tabs: **Triage** (the one-at-a-time queues) and **Dimensions** (`DimensionsPanel` from
[`organizeDimensions.jsx`](organizeDimensions.jsx)). The Dimensions tab edits agenda's OWN
`#agendaConfig` — a single-tab `SettingsForm` scoped `only="Dimensions"`, plus the **Match Templates
By Name** button. Editing a value's **Name** or reordering the list is safe; editing its **Key**
orphans every note carrying that value.

The Triage tab loads the dimension list up front, then `organize.js` does a single backend walk of the
Inbox / Area subtrees, excluding the structural (identity-labelled) notes, tagging each candidate with
its per-dimension `assigned` map (`{ [label]: value }`), a `suggested` map (nearest ancestor's value
per dimension), its `#type`, and `isSubtask` / `hasStartDate` / `path` / `preview`. The page keeps that
list in state and filters it per section; a mutation patches the list in place so the acted-on note
leaves its queue. Sections:

1. **One "Notes Without X" queue per triaged dimension**, in config order — buttons are the
   dimension's values (color-coded); the nearest-ancestor value is highlighted as the suggestion;
   clicking calls `assignDimension`. An `actionableOnly` dimension (priority by default) restricts to
   actionable-typed, non-subtask notes. Add a dimension and a fourth queue appears with no code change.
2. **Tasks Without a Start Date** — a two-step date + time picker; writes `#startDateTime`,
   `#startDate`, `#startTime` (agenda's default label names). Subtasks (parent is itself an actionable
   note) are excluded. The Morning / Noon / Evening / Night times come from agenda's config (Agenda
   Editor → **Organize › Times** tab), read via `getAgendaSettings()`.
3. **Misfiled Notes** — flags a note whose `#area` differs from its ancestor Area, or whose `#type`
   differs from its ancestor bucket, with Move / Set-area / Set-type fixes (the last two call
   `assignDimension` on the root/bucket dimension). Stays two-dimensional by design (the tree has one
   root axis and one bucket axis); if more than one dimension scaffolds, the first of each is used.
4. **Invalid Buckets** — structural bucket notes (`#agendaOrganizeBucket`) whose area or type slug no
   longer maps to a current dimension value — the orphan left behind when an Area or Type value is
   deleted or renamed in the Dimensions editor. `getInvalidBuckets(rootDim, bucketDim)` returns them
   plus the list of *valid* buckets as merge destinations. Each card offers **Merge into `<bucket>`**
   for every valid bucket (`mergeBucketInto` moves the invalid bucket's children into the chosen one,
   migrates its body under a "Merged from" heading, then deletes the emptied husk on verified-empty)
   and **Delete** (cascade — the confirm warns when the bucket still holds notes). This is the manual
   counterpart to `mergeStaleBuckets`, which only auto-resolves buckets it can map via an alias; these
   are the residue it reports as `skipped`.

## 4. Provisioning model — runtime find-or-create

The notebook *structure* is provisioned by the **Workflow Setup** button (Agenda Editor → Settings ›
Workflow Setup), not cloned in via the manifest, so it merges with notes the user already created by
hand. `provisionStructure(dimensions)` (`organizeProvision.js`) reduces the two scaffolding dimensions
to `{ slug, name, color }` / `{ slug, name, icon }` lists and hands them to
`organizeStructure.js`'s `buildStructure(areaList, templateList)`; the walk/find-or-create logic is
`organizeProvision.js`.

- **Identity:** carried by three independent labels — this addon's analogue of TAM's `#TAMFILEID`,
  scoped to user notes:
  - `#agendaOrganizeArea=<areaSlug>` — on an Area root, and on every bucket inside it
  - `#agendaOrganizeBucket=<templateSlug>` — on a bucket, alongside its area label
  - `#agendaOrganizeSpecial=<name>` — on the `inbox` / `my-day` / `agenda` singletons

  So an Area root is *area label, no bucket label*; a bucket is *both*. Keeping the two slugs on
  separate labels means neither is parsed out of a composite string, which is what made renames and
  area renumbering fragile.
- **Resolution per node (idempotent, rename-safe):** (1) a note already carrying this exact identity
  → adopt; (2) else a same-titled child under the parent → adopt + tag; (3) else create + tag.
- **Legacy migration:** trees provisioned before the split carry a single `#workflowNote=<key>`.
  `migrateStructuralLabels()` re-stamps them onto the three labels and runs first on every
  provision, so an existing structure is converted in place rather than rebuilt alongside.
- **Derived vs. seed:** icon (`#iconClass`), `#color`, `~template`, an Area root's `#area`, and a
  bucket's `#alwaysExpanded` are re-asserted on *every* run (self-healing). Note content and
  `seedLabels` are written only on creation, so user edits survive.
- **Area-slug migration:** after the walk, `migrateAreaSlugs()` normalizes every note carrying
  `#area` onto the area dimension's stable keys — stripping the legacy `<NN>-` prefix and applying
  `AREA_ALIASES` for folded areas — rewriting `#area` + `#color` when the value changes. Idempotent:
  an already-stable value resolves to itself, so re-running migrates nothing. Reordering areas no
  longer rewrites notes at all; display order comes from the value list's position (see
  `getSortValueMaps` in [`../common/dimensions.js`](../common/dimensions.js)).
- **Structural templates** are resolved live by title (`AreaCollection` for area roots,
  `TypeCollection` for the per-type buckets, `Special` for the three singletons), so provisioning
  degrades gracefully if a template note is missing — the note is still created and tagged, just
  without a `~template` relation. The *item* templates that buckets are named after come from the type
  dimension's `templateNoteId` (filled by `matchTemplatesByName()`), set on the items, not the buckets.
- **`#type` migration:** `migrateTypeSlugs()` strips the legacy `<order>-` prefix from every `#type`
  (`3-task` → `task`), and re-keys the old structural values (`7-area` → `areacollection`,
  `8-special` → `special`). Ordering moved out of the label value into the value list's position,
  so reordering types no longer rewrites tagged notes. Only values resolving to a *current* type value
  or container marker are touched — an unrecognized `#type` is left alone, since it may be a
  vocabulary the user maintains by hand.
- **Bucket drift:** changing a type value's key changes its bucket key/title, so re-running Setup
  provisions the new bucket rather than renaming the old one — old buckets from a prior taxonomy are
  left in place (surfaced, not auto-deleted) for you to clean up. Reordering no longer drifts anything:
  order is the value's position, not part of any key.
- Items filed into a bucket get their `~template` + `#area` set **programmatically at creation** (not
  via inheritable attributes on the bucket), so a note keeps its identity wherever it's later moved.

## 5. Wiring

Organize has **no shipped render page**. `organizePage.jsx` (`organize-page-src`, tagged
`#agendaOrganizeRender`) is a plain code note; the render surface is an **external user-chosen note**.
The **Organize Note** picker on the Agenda Editor's Settings tab persists `organizeNoteId` in the
shared config and, on change, reconciles the chosen note on the backend: sets its `type` to `render`,
its `~renderNote` relation to the `#agendaOrganizeRender` code note, and its `#iconClass` to
`bx bx-sort-down` — reverting the previously-chosen note back to a text note. (See
`reconcileOrganizeNote` in [`../overview/profileEditor.jsx`](../overview/profileEditor.jsx).)

`organizePage.jsx` imports `getAgendaSettings` (`agendaSettings.jsx`) and `DimensionsPanel`
(`organizeDimensions.jsx`), and requires `organize.js` + `dimensions.js`. The vocabulary lives in
agenda's own config, so there are no cross-addon vocabulary imports any more. Workflow Setup is a tab
folded into the Agenda Editor (`profileEditor.jsx`), which requires `organizeProvision.js` (→ requires
`organizeStructure.js` + `dimensions.js`) and `dimensions.js`. Per TAM's direct-child require rule,
`dimensions` is a child of every note that requires it (`agenda-settings`, `lib-config`,
`dimension-picker`, `organize-page-src`, `organize-dimensions`, `organize-provision`, `profile-editor`),
`organize-structure` is a child of both `organize-page-src` and `organize-provision`, and libsettings'
`ui` is wired under every note that calls `loadSettings`/`SettingsForm` (`dimensions`,
`organize-dimensions`, `profile-editor`, `agenda-settings`, `lib-config`). Styling is `organize.css`
(`appCss`).
