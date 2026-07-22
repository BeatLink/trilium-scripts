# Organize — design notes

Design doc for the opinionated GTD Organize workflow that ships inside `agenda@beatlink` (the
`organize/` module + the **Organize** render page and the **Workflow Setup** tab in the Agenda
Editor). It bakes a specific notebook structure and triage flow on top of agenda's generic engine,
driven by agenda's own open-ended **dimensions** vocabulary (area, priority, and any you add) plus
[`template-picker@beatlink`](../../template-picker@beatlink/README.md)'s own registry for item type.
It reuses agenda's mechanism (config, filters, colors, kanban, task widget) — it does not fork it.

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

Agenda owns one open-ended **`dimensions`** registry in [`common/schema.json`](../common/schema.json),
loaded by [`../common/dimensions.js`](../common/dimensions.js) → `getDimensions()`. A dimension is one
note label plus its ordered vocabulary of values `[{ key, name, color, actionable, icon }]`; area and
priority ship as defaults, but the set is open-ended. Triage queues, sort ordinals, and the derived
prefix/color/grouping/filter variants all enumerate the registered dimensions, so adding one needs no
code change. `key` is the stored value (stable and order-free, so reordering never rewrites a tagged
note); position IS the order.

Item **type** is deliberately NOT one of these dimensions — it moved out entirely to
[`template-picker@beatlink`](../../template-picker@beatlink/README.md)'s own registry. A note's type is
its `~template` relation, assigned by template-picker's own right-pane widget (or its Missing Templates
page), never a `#type` label agenda writes. Organize reads that registry read-only, via
`getBucketTemplates()` in [`organize.js`](organize.js) (discovered through template-picker's own
`#templatePickerConfig` anchor, the same shape agenda uses for its own `#agendaConfig`) — for bucket
scaffolding and the actionable-item set only. See
[template-picker's README](../../template-picker@beatlink/README.md) for its own registry fields
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
There is no equivalent table for buckets any more — a bucket's identity is its template's own noteId,
which never gets renamed the way a string slug did.

### Notebook structure
Three top-level container singletons — **Inbox** (`bxs-inbox`), **My Day** (`bx-task`), **Agenda**
(`bx-calendar`) — then one note per value of the root dimension (Area, `bxs-circle`), each containing
**one bucket per enabled template-picker entry**, titled by the entry's Name, in its registry order.

Each kind of container has its own structural template, and the public `#area` / `#type` labels are
what tell them apart:

| Note              | Template         | Public labels                          |
|-------------------|------------------|----------------------------------------|
| Area root         | `AreaCollection` | `#area=<slug>` `#type=areacollection`  |
| Per-type bucket   | `TypeCollection` | `#area=<slug>` `#type=typecollection`  |
| Inbox/My Day/Agenda | `Special`      | `#type=special`                        |

A bucket is a *container*, not an instance of the type it holds — so its `#type` is the fixed
`typecollection` marker, never the item template it holds (a bucket's OWN `~template` stays
`TypeCollection` even though it files notes whose `~template` is something else entirely). Which
template a bucket holds is carried by the private identity label
`#agendaOrganizeBucket=<templateNoteId>`, alongside `#agendaOrganizeArea=<areaSlug>`.

## 3. The Organize page (`organizePage.jsx`)

Two tabs: **Triage** (the one-at-a-time queues) and **Dimensions** (`DimensionsPanel` from
[`organizeDimensions.jsx`](organizeDimensions.jsx)). The Dimensions tab edits agenda's OWN
`#agendaConfig` — a single-tab `SettingsForm` scoped `only="Dimensions"`. Editing a value's **Name** or
reordering the list is safe; editing its **Key** orphans every note carrying that value. Item type
isn't here at all — it's edited on template-picker's own settings note.

The Triage tab loads the dimension list plus template-picker's enabled registry
(`getBucketTemplates()`) up front, then `organize.js` does a single backend walk of the Inbox / Area
subtrees, excluding the structural (identity-labelled) notes, tagging each candidate with its
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
3. **Misfiled Notes** — flags a note whose `#area` differs from its ancestor Area, or whose `~template`
   differs from its ancestor bucket's, with Move / Set-area / Set-type fixes (Set-area calls
   `assignDimension` on the root dimension; Set-type calls `assignTemplate` directly, since there's no
   dimension to route it through any more). A note with no `~template` at all is never type-misfiled —
   that's the Missing Templates page's job, not this queue's.
4. **Invalid Buckets** — structural bucket notes (`#agendaOrganizeBucket`) whose area no longer maps to
   a current Area value, or whose bucket value is no longer a currently-enabled template. `
   getInvalidBuckets(rootDim, bucketTemplates)` returns them plus the list of *valid* buckets as merge
   destinations. Unlike the one-at-a-time queues above, this is a **table** (all invalid buckets at
   once — it's a cleanup list, not a triage flow): a row per bucket showing its title/path, why it's
   invalid, its note count, and a merge-target `<select>` + **Merge** / **Delete** actions. Merge
   (`mergeBucketInto`) moves the bucket's children into the selected valid bucket, migrates its body
   under a "Merged from" heading, then deletes the emptied husk on verified-empty; Delete
   cascade-deletes it (the confirm warns when the bucket still holds notes). This is the manual
   counterpart to `mergeStaleBuckets`, which only auto-resolves an area-side fold; a stale *bucket*
   (disabled/deleted template) has no alias to resolve through and always ends up here.

## 4. Provisioning model — runtime find-or-create

The notebook *structure* is provisioned by the **Workflow Setup** button (Agenda Editor → Settings ›
Workflow Setup), not cloned in via the manifest, so it merges with notes the user already created by
hand. `provisionStructure(dimensions)` (`organizeProvision.js`) reduces the Area dimension to a
`{ slug, name, color }` list and pulls the bucket list straight from template-picker's own enabled
registry entries (`{ noteId, name, icon }`, via `getBucketTemplates()`), then hands both to
`organizeStructure.js`'s `buildStructure(areaList, templateList)`; the walk/find-or-create logic is
`organizeProvision.js`.

- **Identity:** carried by three independent labels — this addon's analogue of TAM's `#TAMFILEID`,
  scoped to user notes:
  - `#agendaOrganizeArea=<areaSlug>` — on an Area root, and on every bucket inside it
  - `#agendaOrganizeBucket=<templateNoteId>` — on a bucket, alongside its area label
  - `#agendaOrganizeSpecial=<name>` — on the `inbox` / `my-day` / `agenda` singletons

  So an Area root is *area label, no bucket label*; a bucket is *both*. Keeping the two values on
  separate labels means neither is parsed out of a composite string, which is what made renames and
  area renumbering fragile. A bucket's identity is the template's own noteId — stable by
  construction, unlike the string slug it replaced, so there's no rename/reorder case to migrate for
  buckets any more.
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
  without a `~template` relation. The *item* templates that buckets are named after are
  template-picker's own registry entries, assigned directly on the items (via template-picker's
  widget), never on the buckets.
- **Bucket drift:** disabling or deleting a template-picker entry orphans its bucket — re-running
  Setup no longer provisions anything for it (it's not enumerated any more), and the orphaned bucket
  surfaces in Organize's **Invalid Buckets** table for manual merge/delete, rather than being
  auto-deleted. Reordering template-picker's registry only reorders new buckets' creation order;
  existing buckets are unaffected since they're resolved by identity, not position.
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
(`organizeDimensions.jsx`), and requires `organize.js` + `dimensions.js`. `organize.js` requires
template-picker@beatlink's `templateRegistry.jsx` directly — agenda declares `template-picker@beatlink`
as a manifest `dependencies` entry, and clones its `registry` export (via template-picker's `exports`
map) as a direct child of both `organize-lib` (`organize.js`) and `organize-provision`
(`organizeProvision.js`), since both `require()` it. This is a one-directional cross-addon read: agenda
depends on template-picker, template-picker knows nothing about agenda. Workflow Setup is a tab folded
into the Agenda Editor (`profileEditor.jsx`), which requires `organizeProvision.js` (→ requires
`organizeStructure.js` + `organize.js`, for `getBucketTemplates`) and `dimensions.js`. Per TAM's
direct-child require rule, `dimensions` is a child of every note that requires it (`agenda-settings`,
`lib-config`, `organize-page-src`, `organize-dimensions`, `organize-provision`,
`profile-editor`), `organize-structure` is a child of both `organize-page-src` and `organize-provision`,
and libsettings' `ui` is wired under every note that calls `loadSettings`/`SettingsForm` (`dimensions`,
`organize-dimensions`, `profile-editor`, `agenda-settings`, `lib-config`). Styling is `organize.css`
(`appCss`).
