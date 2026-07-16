# Organize — design notes

Design doc for the opinionated GTD Organize workflow that ships inside `agenda@beatlink` (the
`organize/` module + the **Organize** and **Workflow Setup** render pages). It bakes a specific
taxonomy, notebook structure, and triage flow on top of agenda's generic engine. It reuses agenda's
mechanism (config, filters, colors, kanban, task widget) — it does not fork it.

## 1. Purpose / workflow

An opinionated system that guides a **Collect → Organize → Review → Execute** workflow.

- **Collect** — process your inboxes (email, bookmarks, files, notes, photos, browser tabs, …) into
  the Inbox note. Capture the raw item here; attributes are set later, in Organize.
- **Organize** — set each item's **type** (template), **`#area`**, **`#priority`** (MoSCoW), and
  **start date**, and fix misfiled notes. This is the fully-built page (`organizePage.jsx`).
- **Review** — Daily: Must Do + overdue, date-sorted. Weekly: sweep by Area to catch drift. These map
  onto agenda's Task View page modes + sorts; no separate code.
- **Execute** — work the daily list. Uses the same agenda views.

## 2. Taxonomy

### Areas (13)
Career, Finances, Legal, Home, Car, Tech, Fitness, Grooming, Sexual, Social, Mental, Identity, Fun.
`#area` values are `01-career` … `13-fun`. **Health was folded into Fitness and Productivity into
Tech.** The 13-area list is kept in sync across `organizeStructure.js` (`AREAS`) and `agenda`'s four
area registries in [`common/schema.json`](../common/schema.json)
(`filterGroups.area`/`prefixes.area`/`colors.area`/`groupings.area`) — edit both when areas change.
Folds are handled at migration time by `AREA_ALIASES` in `organizeProvision.js` (`health`→`fitness`,
`productivity`→`tech`), so existing notes re-tag on the next Setup provision.

### Types (8)
The 7 from [`templates@beatlink`](../../templates@beatlink/) — Goal, Routine, Task, Future, Project,
Note, Area — **plus Ideas** (`0. Ideas`).

| Type     | Icon              | Notes |
|----------|-------------------|-------|
| Ideas    | `bx-bulb`         | Raw, unevaluated thoughts. Non-actionable. |
| Goals    | `bxs-star-half`   | Large, long-term life initiatives. |
| Routines | `bx-sync`         | Ongoing maintenance activities, indefinite. |
| Projects | `bx-check-double` | One-off outcomes; comprise subprojects + tasks; usually dated. |
| Task     | `bx-check`        | Standard single task (agenda's core actionable unit). |
| Future   | `bx-time-five`    | Deferred / someday-maybe / blocked items. |
| Notes    | `bx-notepad`      | Non-actionable reference material. |
| Area     | `bxs-circle`      | Structural container for an area of life. |

Task / Routine / Future / Project templates are actionable and carry `#agendaTaskWidget`; Ideas /
Notes are non-actionable. The subtype *bucket* notes under each area are containers, not items, so
they carry no `#agendaTaskWidget` — only the actual notes filed inside them do, via their template.

### Notebook structure
Three top-level container singletons — **Inbox** (`bxs-inbox`), **My Day** (`bx-task`), **Agenda**
(`bx-calendar`) — then one note per Area (`bxs-circle`), each containing six Type buckets: Ideas /
Goals / Routines / Projects / Future / Notes.

## 3. The Organize page (`organizePage.jsx`)

A one-at-a-time triage queue. `organize.js` does a single backend walk of the Inbox / Area subtrees,
excluding the structural `#workflowNote` notes, and tags each candidate with the flags each section
filters on (`hasTemplate` / `hasArea` / `hasPriority` / `hasStartDate` / `isSubtask` / `suggestedArea`
/ `path` / `preview`). The page keeps that list in state and filters it per section; a mutation
patches the list in place so the acted-on note leaves its queue. Sections:

1. **Notes Without Templates** — buttons are the item templates (`0. Ideas`..`6. Note`), resolved
   live by title; assigns `~template`.
2. **Notes Without Areas** — buttons are the 13 areas (`AREA_LIST`), color-coded; the ancestor area
   is highlighted as the suggestion; assigns `#area` + `#color`.
3. **Tasks Without Priority** — actionable types only (`PRIORITY_TEMPLATE_TITLES`); MoSCoW buttons
   (`4-critical`..`1-low`) set `#priority`.
4. **Tasks Without a Start Date** — a two-step date + time picker; writes `#startDateTime`,
   `#startDate`, `#startTime` (agenda's default label names). The Morning / Noon / Evening / Night
   times come from agenda's config (Agenda Editor → **Times** tab), read via `getAgendaSettings()`.
5. **Misfiled Notes** — flags a note whose `#area` differs from its ancestor Area, or whose
   `~template` isn't accepted by its ancestor bucket (`BUCKET_TEMPLATES`), with Move / Set-area /
   Set-type fixes.

## 4. Provisioning model — runtime find-or-create

The notebook *structure* is provisioned by the **Workflow Setup** page button, not cloned in via the
manifest, so it merges with notes the user already created by hand. The structure is data
(`organizeStructure.js`); the logic is `organizeProvision.js`.

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
- **Templates** are resolved live by title (`7. Area` for areas, `8. Special` for containers), so
  provisioning degrades gracefully if `templates@beatlink` is absent — the note is still created and
  tagged, just without a `~template` relation.
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

`organizePage.jsx` imports `getAgendaSettings` from `agendaSettings.jsx` and requires `organize.js` +
`organizeStructure.js`. The Setup page (`setup-page` → `setup-src`) requires `organizeProvision.js`,
which requires `organizeStructure.js`. Per TAM's direct-child require rule, `organize-structure` is
wired as a child of every note that requires it (`organize-page-src`, `organize-lib`,
`organize-provision`). Styling is `organize.css` (`appCss`).
