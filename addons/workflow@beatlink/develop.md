# workflow@beatlink — Design & Roadmap

Working design doc for an opinionated, turnkey knowledgebase + task-management addon for TriliumNext.
This is a **long-term implementation**; this file is the living design. No addon code exists yet — the
manifest, config preset, and templates are built out over the phases in the roadmap below.

## 1. Purpose / workflow

An opinionated system that guides a **Collect → Organize → Review → Execute** workflow. Unlike the
generic, composable `agenda@beatlink` engine, this addon bakes in a specific taxonomy, notebook
structure, and review cadence.

The primary UI is a single **Workflow window** — a `render`-type page with four tabs, one per phase
(Collect / Organize / Review / Execute). Each tab hosts the tools for that phase. The window shell +
tab scaffolding exist today; each panel is wired to the agenda engine + provisioned notebook over the
roadmap phases below.

### 1. Collect
Process your inboxes into the Inbox note: email, bookmarks, digital files, notes, chat messages,
photos, physical documents, work systems, browser tabs.

### 2. Organize
Set the **area** and **type** of each collected item, plus **priority**, **status**, **context**,
**effort**, and **dates**. (This is where all attributes get set — not during Collect. Collect just
gets the raw item into the Inbox.)

- **Areas** — the area of life the item belongs to (see §2).
- **Types** — Ideas / Goals / Routines / Projects / Future / Notes (plus structural Task / Area; see §2).
- **Priority (MoSCoW)** — Must Do / Should Do / Could Do / Want to Do → `#priority`
  `4-critical` / `3-high` / `2-medium` / `1-low`.
- **Status** — Todo / In progress / Blocked / Done.
- **Context** — `@computer`, `@errands`, `@calls`, `@home`.
- **Effort** — quick win vs. deep work / time estimate.

### 3. Review
- **Daily review** — filter to Must Do plus anything overdue, sorted by date. The day's worklist.
- **Weekly review** — sweep by Area, to catch drift in quiet areas (e.g. Legal, Health) that never
  surface in the Must-Do list on their own.
- **Review views** — All Tasks / By Type / By Priority / By Date.

### 4. Execute
Work from the daily list (Must Do + overdue, date-sorted). Context and Effort are applied here as
filters on top of the already-prioritized list, to match what you can actually do right now.
Blocked items stay visible in Organize/weekly review but drop out of the daily execution list until
unblocked. Update Status as work progresses.

## 2. Locked decisions

Decided with the user during planning.

### Areas (15)
Career, Finances, Legal, Home, Car, Tech, Fitness, Grooming, Sexual, Social, Health, Mental, Identity,
Fun, **and Productivity** (added on top of the draft's 14). `#area` values are renumbered `01-…`
through `15-…`. This differs from `agenda@beatlink`'s shipped 14 (which omits Legal); the preset here
overrides the area enumeration everywhere it appears.

### Types (8)
The 7 from `templates@beatlink` — Goal, Routine, Task, Future, Project, Note, Area — **plus Ideas**.

| Type     | Icon              | Notes |
|----------|-------------------|-------|
| Ideas    | `bx-bulb`         | Raw, unevaluated thoughts. Non-actionable — **no** `#agendaTaskWidget`. New in this addon. |
| Goals    | `bxs-star-half`   | Large, long-term life initiatives. |
| Routines | `bx-sync`         | Ongoing maintenance activities, indefinite. |
| Projects | `bx-check-double` | One-off outcomes; comprise subprojects + tasks; usually dated. |
| Task     | `bx-check`        | Standard single task (agenda's core actionable unit). |
| Future   | `bx-hourglass`    | Deferred / someday-maybe / blocked items. |
| Notes    | `bx-note`         | Non-actionable reference material. |
| Area     | `bxs-circle`      | Structural container for an area of life (list view). |

Ideas and Notes are non-actionable (no task widget). Task/Routine/Future/Project are actionable and
carry `#agendaTaskWidget`.

### Scope
- Provisioning addon **+** config/schema preset. The `lib*@beatlink` engines stay generic; this addon
  is the opinionated assembly layer.
- Collect widgets are **deferred** (Phase 5). Inbox is structure-only in v1.

### Notebook top-level structure
| Note   | Icon         |
|--------|--------------|
| Inbox  | `bx-inbox`   |
| My Day | `bx-task`    |
| Agenda | `bx-calendar`|

Followed by one note per Area (`bxs-circle`), each containing a child per relevant Type
(Ideas / Goals / Routines / Projects / Future / Notes).

## 3. Architecture (reuse, don't reimplement)

~90% of the mechanism already ships. This addon assembles it; it does not fork the engines.

- **`workflow@beatlink`** is a `widget`-type assembly addon depending on `agenda@beatlink` +
  `templates@beatlink`.
- **UI: the Workflow window.** A `render`-type page note (`Workflow`, manifest id `window-page`) wired
  via a `renderNote` relation to `workflowWindow.jsx` (manifest id `window`), styled by
  `workflowWindow.css` (`appCss`). This follows agenda's render-page pattern exactly
  ([agenda's profile-editor-page → profileEditor.jsx](../agenda@beatlink/_tam_manifest_.json),
  [taskView.jsx](../agenda@beatlink/taskView.jsx)). The component holds four tabs
  (`lst-tab`/`lst-tab-active`, matching taskView's mode buttons), one per phase; each phase is a
  placeholder panel today. As phases are built, each tab composes the relevant agenda pieces (e.g.
  Review/Execute embed the Task View list; Organize embeds the pickers) rather than reimplementing
  them.
- **UI: the Setup page.** A second `render` page (`Workflow Setup`, id `setup-page`) →
  `workflowSetup.jsx` (id `setup`), separate from the main window. One button provisions the notebook
  structure at runtime (see below). Shares `workflowWindow.css`.

### Provisioning model — runtime find-or-create, not manifest clone-in

Unlike agenda/templates (which clone their notes in via the manifest), the notebook *structure* is
provisioned by a **button on the Setup page**, so it merges with notes the user already created by
hand. The structure is data (`workflowStructure.js`), the logic is `workflowProvision.js`:

- **Anchor:** top-level notes (Inbox, My Day, Agenda, 15 Areas) are direct children of Trilium
  `root`; each Area's six subtype notes (Ideas / Goals / Routines / Projects / Future / Notes) are
  children of that Area.
- **Identity:** each note is tagged **`#workflowNote=<key>`** (e.g. `inbox`, `area-03-legal`,
  `area-03-legal-goals`) — this addon's analogue of TAM's `#TAMFILEID`, but applied to user notes and
  scoped to this addon so it never collides with TAM's uninstall sweep.
- **Resolution order per node (idempotent, rename-safe):** (1) a note already tagged
  `#workflowNote=<key>` → adopt as-is; (2) else a same-titled child under the target parent → adopt +
  tag it; (3) else create + tag. Adoption never overwrites content or existing labels; a node's
  `#area`/`#iconClass`/`#agendaTaskWidget` labels are applied only on creation.
- `.js` libs (`workflowStructure.js`, `workflowProvision.js`) are plain CommonJS
  (`module.exports`/`require`), `env=frontend`; the backend work runs inside `api.runOnBackend`
  closures (which may reference only `api`), mirroring
  [web-preview's saveUrlToInbox](../web-preview@beatlink/libWebPreview.js).
- **Notebook provisioning** uses the proven three-array manifest pattern (`notes` / `children` /
  `labels` + `AddonData:` relations) from
  [templates@beatlink/_tam_manifest_.json](../templates@beatlink/_tam_manifest_.json) and the richer
  cross-addon wiring in [agenda@beatlink/_tam_manifest_.json](../agenda@beatlink/_tam_manifest_.json).
- **Config preset over schema fork.** Ship a tuned `config.json` that agenda's `libsettings`
  `loadSettings` merges against schema defaults. Every registry is add/remove/reconcile, so the preset
  only overrides what differs from
  [agenda@beatlink/schema.json](../agenda@beatlink/schema.json):
  - the 15-area enumeration in `filterGroups.area`, `prefixes.area`, `colors.area`, `groupings.area`;
  - an **Ideas** rule in `searchGroups` alongside Goal/Routine/Task/Future (keep the existing
    `not(note.parents.relations.template.title=…)` de-dup guard).
  - Optionally: **Context** (`#context` = `@computer/@errands/@calls/@home`) and **Effort** (`#effort`)
    filter groups.
  - Everything else — priority MoSCoW, `dateRules`, `sorts`, the `default` profile — already implements
    the Daily (Must Do + overdue, date-sorted) and Weekly (by Area) reviews. Reuse as-is.
- **Review views** (All Tasks / By Type / By Priority / By Date) map directly onto agenda's Task View
  page modes (Table / Kanban / Calendar) + the profile's sort options. No new view code.

## 4. Open items / risks

- **Agenda has `exports: {}`.** Per `.claude/rules/tam-gotchas.md`, the manifest `dependencies` array
  is metadata only — an addon's notes install only when another addon wires one of its `exports` via a
  `children[]`/`relations[]` entry. Agenda exports nothing, so its widget notes can't be cloned in.
  Likely path: this addon provisions the notebook + config preset and **relies on agenda being
  installed separately**, wiring the `My Day`/`Agenda`/task notes with agenda-recognized
  labels/relations (`#agendaTaskWidget`, `#widget`, `AddonData:config`) rather than trying to import
  agenda's widgets. Reconsider only if that proves insufficient.
- **Area icon:** draft says `bx-circle`; `templates@beatlink` ships `bxs-circle`. Pick one (default to
  the shipped `bxs-circle` for consistency).
- **Context / Effort filters:** add to `filterGroups` now, or defer alongside Collect. New label
  conventions (`#context`, `#effort`) — document wherever chosen.
- **Manifest size:** 15 areas × 6 type-children ≈ 120 note entries. Generate the
  `notes`/`children`/`labels` arrays programmatically (scratch script), then commit the generated JSON.
  Use stable manifest ids (`area-01-career`, `area-01-career-ideas`, …).
- **Status attribute:** the workflow defines Todo/In progress/Blocked/Done but agenda's shipped schema
  has no `#status` filter group. Decide whether to add one (likely yes, for the Blocked-hides-from-daily
  behavior) — new `#status` convention.

## 5. Phased roadmap

- [x] **Phase 0 — Scaffold.** Folder + this `develop.md` + the Workflow window shell:
      `workflowWindow.jsx` (4-tab render component, placeholder panels), `workflowWindow.css`, and a
      minimal `_tam_manifest_.json` wiring the `render` page → JSX → CSS. Passes `validate`.
- [ ] **Phase 1 — Preset.** Author `config.json` (15 areas + Ideas search rule, optionally
      Context/Effort/Status filters), the Ideas template HTML, and extend the manifest to wire the
      preset + Ideas template. Run `validate`.
- [ ] **Phase 2 — Provisioning.** Generate the `notes`/`children`/`labels` for Inbox / My Day / Agenda
      + 15 Area notes each with their Type children and icons; wire `AddonData:` relations and
      `myDayNoteId`. Run `validate` + `tam_to_zip`.
- [ ] **Phase 3 — Tab wiring.** Fill in the window's panels: **Review**/**Execute** embed the agenda
      Task View list (filtered per phase); **Organize** surfaces the area/type/priority/date pickers
      for the selected item; **Collect** points at the Inbox. Compose agenda pieces, don't reimplement.
- [ ] **Phase 4 — Live test.** Install agenda + templates + workflow in a test instance
      (`nix develop` → `trilium_seed` → `trilium_server start`). Confirm the notebook provisions, the
      preset drives the 15-area filters/colors/kanban, and each Workflow tab works end to end.
- [ ] **Phase 5 — Collect widgets (deferred).** Build inbox-triage widget(s) for the Collect phase
      (set area/type/priority/dates and file into the tree from the Inbox).
- [ ] **Phase 6 — Docs.** README, `generate_pages`, catalog entry.
