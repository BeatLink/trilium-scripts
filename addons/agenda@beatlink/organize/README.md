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
`areas` list (`{ key, title, color }`, `key` = the `#area` slug like `01-career`) via
[`organizeAreas.jsx`](organizeAreas.jsx) → `getAreaSettings()`, which normalizes it to
`{ slug, name, color }`. The assign-area picker, the misfiled check, and Setup provisioning all read
this one list, so editing areas in area-picker's settings changes them everywhere. area-picker ships
the same 13 defaults agenda's four area registries in
[`common/schema.json`](../common/schema.json) use (`filterGroups.area`/`prefixes.area`/`colors.area`/
`groupings.area`) — keep those in sync with area-picker if you change the defaults. Folds/renames are
handled at migration time by `AREA_ALIASES` in `organizeProvision.js` (`health`→`fitness`,
`productivity`→`tech`), so existing notes re-tag on the next Setup provision.

### Types — user-managed templates
The item-type taxonomy is **not hard-coded** — it's the `templates` registry in
[`common/schema.json`](../common/schema.json), edited on the Organize page's **Templates** tab (and
also under the Agenda Editor's **Organize › Templates** tab). Each entry governs one `#template` note:

| Field            | Effect |
|------------------|--------|
| `enabled`        | Offered in the "Notes Without Templates" assign queue **and** given its own scaffolding bucket. |
| `actionable`     | Its notes flow through the priority + start-date queues; the template carries `#agendaTaskWidget`. |
| `order`          | Assign-queue + bucket order, and the numeric prefix of the derived `#type` (`<order>-<slug>`). |

The registry ships **seeded** with agenda's seven bundled item templates (Ideas / Goal / Routine /
Task / Future / Project / Note), reproducing the previous fixed behavior: all enabled; Routine / Task /
Project / Future actionable. The two structural templates (`7. Area`, `8. Special`) are **excluded**
from the managed list — they stay hard-coded scaffolding (see `organizeStructure.js`).

[`organizeTemplates.jsx`](organizeTemplates.jsx) is the module: `getTemplateConfig()` reads the
registry and resolves each entry to a live note (`{ noteId, name, slug, enabled, actionable, order }`,
ordered); **Scan** discovers every `#template` note, adds unseen ones (disabled) to the registry, and
re-derives `#type` / `#agendaTaskWidget` from the current config onto the notes. A seeded entry ships
with `titleMatch` (its bundled title) and blank `templateNoteId`; the first Scan resolves the title to
a real id.

### Notebook structure
Three top-level container singletons — **Inbox** (`bxs-inbox`), **My Day** (`bx-task`), **Agenda**
(`bx-calendar`) — then one note per Area (`bxs-circle`), each containing **one bucket per enabled
template** (in `order`), titled by the template's name. A bucket is a container (Special-templated),
not an instance of the type it holds; its `#workflowNote` key is `area-<areaSlug>-<templateSlug>`.

## 3. The Organize page (`organizePage.jsx`)

Two tabs: **Triage** (the one-at-a-time queues) and **Templates** (the managed-templates panel —
`TemplatesPanel` from `organizeTemplates.jsx`: a Scan button above a single-tab `SettingsForm` editing
the `templates` registry).

The Triage tab loads two vocabularies up front — area-picker's areas (`getAreaSettings()`) and
agenda's enabled templates (`getTemplateConfig()`) — then `organize.js` does a single backend walk of
the Inbox / Area subtrees, excluding the structural `#workflowNote` notes, tagging each candidate with
the flags each section filters on (`hasTemplate` / `templateId` / `hasArea` / `hasPriority` /
`hasStartDate` / `isSubtask` / `suggestedArea` / `path` / `preview`). The page keeps that list in state
and filters it per section; a mutation patches the list in place so the acted-on note leaves its queue.
Sections:

1. **Notes Without Templates** — buttons are the **enabled** managed templates (in `order`), resolved
   from config to real notes; assigns `~template`.
2. **Notes Without Areas** — buttons are area-picker's areas (via `getAreaSettings()`), color-coded;
   the ancestor area is highlighted as the suggestion; assigns `#area` + `#color`.
3. **Tasks Without Priority** — **actionable** templates only (by `templateId` ∈ the actionable set
   from config); MoSCoW buttons (`4-critical`..`1-low`) set `#priority`.
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

- **Identity:** each note is tagged **`#workflowNote=<key>`** (e.g. `inbox`, `area-03-legal`,
  `area-03-legal-goals`) — this addon's analogue of TAM's `#TAMFILEID`, scoped to user notes.
- **Resolution per node (idempotent, rename-safe):** (1) a note already tagged `#workflowNote=<key>`
  → adopt; (2) else a same-titled child under the parent → adopt + tag; (3) else create + tag.
- **Derived vs. seed:** icon (`#iconClass`), `#color`, `~template`, an Area root's `#area`, and a
  bucket's `#alwaysExpanded` are re-asserted on *every* run (self-healing). Note content and
  `seedLabels` are written only on creation, so user edits survive.
- **Area-slug migration:** after the walk, `migrateAreaSlugs()` re-keys every note carrying `#area`
  by its stable name-part, rewriting `#area` + `#color` when the number drifted (e.g. after an area
  reorder). Run the Setup button after any area reorder to apply it.
- **Structural templates** are resolved live by title (`7. Area` for area roots, `8. Special` for all
  containers, including the per-template buckets), so provisioning degrades gracefully if a template
  note is missing — the note is still created and tagged, just without a `~template` relation. The
  *item* templates that buckets are named after come from the managed `templates` config, not here.
- **Bucket drift:** changing a template's name or `order` changes its bucket key/title, so re-running
  Setup provisions the new bucket rather than renaming the old one — old buckets from a prior taxonomy
  are left in place (surfaced, not auto-deleted) for you to clean up.
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
requires `organize.js` + `organizeStructure.js`. Workflow Setup is no longer a separate render page —
it's a tab folded into the Agenda Editor (`profileEditor.jsx`), which imports `organizeAreas.jsx` +
`organizeTemplates.jsx` and requires `organizeProvision.js` (→ requires `organizeStructure.js`). Per
TAM's direct-child require rule, `organize-structure` is a child of every note that requires it
(`organize-page-src`, `organize-provision`), `organize-templates` and `organize-areas` are children of
both entry notes (`organize-page-src`, `profile-editor`), and libsettings' `ui` is wired under every
note that calls `loadSettings`/`SettingsForm` (`organize-areas`, `organize-templates`, `profile-editor`,
`agenda-settings`). `area-picker@beatlink` is an agenda dependency so its `#areaConfig` note resolves.
Styling is `organize.css` (`appCss`).
