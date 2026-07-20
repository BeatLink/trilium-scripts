# Organize — design notes

Design doc for the opinionated GTD Organize workflow that ships inside `agenda@beatlink` (the
`organize/` module + the **Organize** render page and the **Workflow Setup** tab in the Agenda
Editor). It bakes a specific notebook structure and triage flow on top of agenda's generic engine,
with a **user-managed template taxonomy**. It reuses agenda's mechanism (config, filters, colors,
kanban, task widget) — it does not fork it.

## 1. Purpose / workflow

An opinionated system that guides a **Collect → Organize → Review → Execute** workflow.

- **Collect** — process your inboxes (email, bookmarks, files, notes, photos, browser tabs, …) into
  the Inbox note. Capture the raw item here; attributes are set later, in Organize. The **Inbox Note**
  is a setting (Agenda Editor → **Collect › Inbox**, `inboxNoteId` in the shared config), preselected
  to Trilium's own inbox (a `#inbox`-tagged note) on first open and exposed via `getAgendaSettings()`
  so collection addons can file into the same place.
- **Organize** — set each item's **type** (template), **`#area`**, **`#priority`** (MoSCoW), and
  **start date**, and fix misfiled notes. This is the fully-built page (`organizePage.jsx`).
- **Review** — Daily: Must Do + overdue, date-sorted. Weekly: sweep by Area to catch drift. These map
  onto agenda's Task View page modes + sorts; no separate code.
- **Execute** — work the daily list. Uses the same agenda views.

## 2. Taxonomy

### Areas
The area vocabulary comes from **[`area-picker@beatlink`](../../area-picker@beatlink/)**, not this
module. Organize discovers area-picker's settings note by its `#areaConfig` label and loads its
`areas` list (`{ key, title, color }`, `key` = the `#area` slug like `career` — stable and
order-free, so reordering areas never rewrites a tagged note) via
[`organizeAreas.jsx`](organizeAreas.jsx) → `getAreaSettings()`, which normalizes it to
`{ slug, name, color }`. The assign-area picker, the misfiled check, and Setup provisioning all read
this one list, so editing areas in area-picker's settings changes them everywhere. area-picker ships
the same 13 defaults agenda's four area registries in
[`common/schema.json`](../common/schema.json) use (`filterGroups.area`/`prefixes.area`/`colors.area`/
`groupings.area`) — keep those in sync with area-picker if you change the defaults. Folds/renames are
handled at migration time by `AREA_ALIASES` in `organizeProvision.js` (`health`→`fitness`,
`productivity`→`tech`), so existing notes re-tag on the next Setup provision.

### Types — template-picker's registry
The item-type taxonomy comes from **[`template-picker@beatlink`](../../template-picker@beatlink/)**,
not this module — the same shared-vocabulary arrangement Areas use. Organize discovers its settings
note by `#templatePickerConfig` and reads the `templates` registry via
[`organizeTemplates.jsx`](organizeTemplates.jsx) → `getTemplateConfig()`. The **Templates** tab
(Organize page, and the Agenda Editor's **Organize › Templates**) edits *template-picker's* config
directly, so the picker dropdown and the workflow can never drift. Scan lives in template-picker's own
settings page.

Two properties agenda needs are read off each **template note's own labels**, not from config, so the
note is the single source of truth:

| Source                     | Effect |
|----------------------------|--------|
| registry `enabled`         | Offered in the "Notes Without Templates" assign queue **and** given its own scaffolding bucket. |
| registry row position      | Assign-queue + bucket order, and the order these types sort in across agenda's views (via `getSortValueMaps`). |
| `#agendaTaskWidget` (note) | **Actionable**: its notes flow through the priority + start-date queues and mount the Task editor. |
| `#label:priority` (note)   | Its notes carry a priority at all. |

Making a type actionable is therefore one label on the template note, not a config row to keep in
sync. `applyTemplateLabels()` (the Templates form's `onSaved`) re-derives only `#type` — it never
writes `#agendaTaskWidget` or `#label:priority`, since agenda *reads* those and writing them back
would clear the user's choice. The structural templates (`AreaCollection`, `TypeCollection`,
`Special`) are filtered out of the vocabulary by title so scaffolding is never assignable.

### Priorities
The priority vocabulary comes from **[`priority-widget@beatlink`](../../priority-widget@beatlink/)**,
discovered by `#priorityConfig` and read by [`organizePriority.js`](organizePriority.js) →
`getPriorityOptions()`. The active profile supplies **both** the ordered levels and the **label name**
they are written to (`priority` for the bundled MoSCoW/Standard profiles, `color` for the Color one),
so the triage queue always writes where the picker widget reads. `agenda` no longer carries its own
MoSCoW list.

### Notebook structure
Three top-level container singletons — **Inbox** (`bxs-inbox`), **My Day** (`bx-task`), **Agenda**
(`bx-calendar`) — then one note per Area (`bxs-circle`), each containing **one bucket per enabled
template** (in registry order), titled by the template's name.

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

Three tabs: **Triage** (the one-at-a-time queues), **Areas** (the life-area vocabulary), and
**Templates** (`TemplatesPanel` from `organizeTemplates.jsx`). Areas and Templates are the same thin
shape: each resolves *another addon's* schema/config note ids and hands them to the single-tab
`SettingsForm` that addon's own settings page uses, so the vocabulary has exactly one home. When the
owning addon isn't installed, the tab explains that instead of erroring.

**Templates** edits template-picker's registry (`only="Templates"`), with
`onSaved=applyTemplateLabels` so Save persists the rows and re-derives agenda's `#type`. Scan lives in
template-picker's own settings page, so there's no Scan button here.

The **Areas** tab (`AreasPanel` from `organizeAreas.jsx`) edits **area-picker's** config via
`#areaConfig` discovery (`only="Areas"`). Editing an area's **Title** is safe (buckets re-key by name
on the next provision run); editing its **Key** orphans every note carrying that `#area` value.

The Triage tab loads three vocabularies up front — area-picker's areas (`getAreaSettings()`),
template-picker's enabled templates (`getTemplateConfig()`), and priority-widget's active profile
(`getPriorityOptions()`) — then `organize.js` does a single backend walk of
the Inbox / Area subtrees, excluding the structural (identity-labelled) notes, tagging each candidate with
the flags each section filters on (`hasTemplate` / `templateId` / `hasArea` / `hasPriority` /
`hasStartDate` / `isSubtask` / `suggestedArea` / `path` / `preview`). The page keeps that list in state
and filters it per section; a mutation patches the list in place so the acted-on note leaves its queue.
Sections:

1. **Notes Without Templates** — buttons are the **enabled** templates (in registry order), resolved
   from template-picker's config to real notes; assigns `~template`.
2. **Notes Without Areas** — buttons are area-picker's areas (via `getAreaSettings()`), color-coded;
   the ancestor area is highlighted as the suggestion; assigns `#area` + `#color`.
3. **Tasks Without Priority** — **actionable** templates only (those whose template note carries
   `#agendaTaskWidget`); buttons are the active priority profile's levels, written to that profile's
   own label. The profile resolves *before* the candidate walk, because its label is what
   `hasPriority` tests — scanning with the wrong one would re-queue already-prioritized notes.
4. **Tasks Without a Start Date** — a two-step date + time picker; writes `#startDateTime`,
   `#startDate`, `#startTime` (agenda's default label names). Subtasks (parent is itself an actionable
   note) are excluded. The Morning / Noon / Evening / Night times come from agenda's config (Agenda
   Editor → **Organize › Times** tab), read via `getAgendaSettings()`.
5. **Misfiled Notes** — flags a note whose `#area` differs from its ancestor Area, or whose template's
   slug differs from its ancestor bucket's template slug (bucket = template), with Move / Set-area /
   Set-type fixes.

## 4. Provisioning model — runtime find-or-create

The notebook *structure* is provisioned by the **Workflow Setup** button (Agenda Editor → Settings ›
Workflow Setup), not cloned in via the manifest, so it merges with notes the user already created by
hand. `organizeStructure.js`'s `buildStructure(areaList, templateList)` assembles the tree from
area-picker's area list **and** agenda's enabled template list (both loaded by the button's handler via
`getAreaSettings()` / `getTemplateConfig()`); the walk/find-or-create logic is `organizeProvision.js`.

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
  `#area` onto area-picker's stable keys — stripping the legacy `<NN>-` prefix and applying
  `AREA_ALIASES` for folded areas — rewriting `#area` + `#color` when the value changes. Idempotent:
  an already-stable value resolves to itself, so re-running migrates nothing. Reordering areas no
  longer rewrites notes at all; display order comes from the config list's position (see
  `getSortValueMaps` in [`../overview/libAgendaConfig.js`](../overview/libAgendaConfig.js)).
- **Structural templates** are resolved live by title (`AreaCollection` for area roots,
  `TypeCollection` for the per-type buckets, `Special` for the three singletons), so provisioning
  degrades gracefully if a template note is missing — the note is still created and tagged, just
  without a `~template` relation. The *item* templates that buckets are named after come from
  template-picker's registry, not here.
- **`#type` migration:** `migrateTypeSlugs()` strips the legacy `<order>-` prefix from every `#type`
  (`3-task` → `task`), and re-keys the old structural values (`7-area` → `areacollection`,
  `8-special` → `special`). Ordering moved out of the label value into the registry's row position,
  so reordering types no longer rewrites tagged notes. Only values resolving to a *current* template
  slug or container marker are touched — an unrecognized `#type` is left alone, since it may be a
  vocabulary the user maintains by hand.
- **Bucket drift:** changing a template's name changes its bucket key/title, so re-running Setup
  provisions the new bucket rather than renaming the old one — old buckets from a prior taxonomy are
  left in place (surfaced, not auto-deleted) for you to clean up. Reordering no longer drifts anything:
  order is the registry's row position, not part of any key.
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

`organizePage.jsx` imports `getAgendaSettings` (`agendaSettings.jsx`), `getAreaSettings`
(`organizeAreas.jsx`), and `getTemplateConfig` + `TemplatesPanel` (`organizeTemplates.jsx`), and
requires `organize.js`, `organizeStructure.js` + `organizePriority.js`. `organizeTemplates.jsx` in
turn imports `getTemplates` from template-picker's `templateRegistry.jsx`, wired as a cross-addon
child (`template-picker@beatlink` export `registry`) under every note that imports it.
Workflow Setup is no longer a separate render page —
it's a tab folded into the Agenda Editor (`profileEditor.jsx`), which imports `organizeAreas.jsx` +
`organizeTemplates.jsx` and requires `organizeProvision.js` (→ requires `organizeStructure.js`). Per
TAM's direct-child require rule, `organize-structure` is a child of every note that requires it
(`organize-page-src`, `organize-provision`), `organize-templates` and `organize-areas` are children of
both entry notes (`organize-page-src`, `profile-editor`), and libsettings' `ui` is wired under every
note that calls `loadSettings`/`SettingsForm` (`organize-areas`, `organize-templates`, `profile-editor`,
`agenda-settings`). `area-picker@beatlink` is an agenda dependency so its `#areaConfig` note resolves.
Styling is `organize.css` (`appCss`).
