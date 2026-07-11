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
| Ideas    | `bx-bulb`         | Raw, unevaluated thoughts. Non-actionable — **no** `#agendaTaskWidget`. Ships as `0. Ideas` in templates@beatlink. |
| Goals    | `bxs-star-half`   | Large, long-term life initiatives. |
| Routines | `bx-sync`         | Ongoing maintenance activities, indefinite. |
| Projects | `bx-check-double` | One-off outcomes; comprise subprojects + tasks; usually dated. |
| Task     | `bx-check`        | Standard single task (agenda's core actionable unit). |
| Future   | `bx-time-five`    | Deferred / someday-maybe / blocked items. |
| Notes    | `bx-notepad`      | Non-actionable reference material. |
| Area     | `bxs-circle`      | Structural container for an area of life (list view). |

Ideas and Notes are non-actionable (no task widget). The Task/Routine/Future/Project *templates* are
actionable and carry `#agendaTaskWidget`. (Note: the subtype *bucket* notes provisioned under each
area are containers, not items, so they do **not** carry `#agendaTaskWidget` — only the actual
task/routine/etc. notes filed inside them do, via their template.)

### Scope
- Provisioning addon **+** config/schema preset. The `lib*@beatlink` engines stay generic; this addon
  is the opinionated assembly layer.
- Collect widgets are **deferred** (Phase 5). Inbox is structure-only in v1.

### Notebook top-level structure
| Note   | Icon         |
|--------|--------------|
| Inbox  | `bxs-inbox`  |
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
  (`lst-tab`/`lst-tab-active`, matching taskView's mode buttons), one per phase. **Organize** is wired
  (see below); Collect / Review / Execute are placeholders. As those are built, each tab composes the
  relevant agenda pieces (e.g. Review/Execute embed the Task View list) rather than reimplementing them.
- **Organize tab.** `workflowOrganizePanel.jsx` (id `organize-panel`, a child of `window`) + backend
  helpers in `workflowOrganize.js` (id `organize`). The tab is a stack of triage sections, each under
  its own `<h3>` — more are planned. Both current sections share a **generic `TriageQueue` component**:
  it walks its items one at a time, showing the note's title (a link — click to open it), its tree-path
  breadcrumb (via `getParentNotes()` up to root), a short HTML-stripped **content preview**, and a row
  of **one-click option buttons**. Clicking an option auto-advances; **Back/Forward** move without
  changing anything; **Delete** removes the note (guarded by `window.confirm`, `note.deleteNote()`).
  - **Data flow:** `getOrganizeCandidates()` collects every non-structural note under the Inbox / Area
    subtrees **once** (a single backend round-trip; `runOnBackend` closures can't share helpers, so one
    walk feeds both queues), each tagged `hasTemplate` / `hasArea` / `suggestedArea` / `path` /
    `preview`. The panel keeps that list in state and filters it per section; a mutation patches the
    shared list in place so the acted-on note leaves the relevant queue.
  - **Notes Without Templates** — items with no `~template`. Buttons are the item-type templates
    (`0. Ideas`, `1. Goal`..`6. Note`; Area/Special excluded), resolved live by title
    (`getItemTemplates`); clicking assigns `~template` (`setRelation`, like
    [template-picker](../template-picker@beatlink/templatePickerPreact.jsx)).
  - **Notes Without Areas** — items with no `#area`. Buttons are the 15 areas from
    `workflowStructure.js`'s `AREA_LIST` (single source of truth), color-coded; clicking sets `#area` +
    `#color` (like [area-picker](../area-picker@beatlink/areaPickerPreact.jsx)) via `assignArea`. If the
    note already sits inside an Area subtree, that ancestor area's button is **highlighted** as the
    suggestion (`suggestedArea` = nearest ancestor's `#area`).
  - **Tasks Without Priority** — actionable items (templated `2. Routine` / `3. Task` / `5. Project` /
    `4. Future`, per `workflowStructure.js`'s `PRIORITY_TEMPLATE_TITLES`) with no `#priority`. Buttons
    are the four MoSCoW options (`PRIORITY_OPTIONS`: `4-critical` Must Do … `1-low` Want To Do);
    clicking sets `#priority` via `assignPriority` (same value convention as
    [priority-widget](../priority-widget@beatlink/) and agenda). Ideas/Goals/Notes are excluded (not
    scheduled work). Uses `candidates`' `templateTitle` + `hasPriority` fields.
  - **Tasks Without a Start Date** — same actionable types with no `#startDateTime`. A two-step
    `DueDatePicker`: a **date** row (Today / Tomorrow / Next Week / Next Weekend = upcoming Saturday /
    Next Month, computed with `api.dayjs`, plus a native date input) and a **time** row (Morning / Noon
    / Evening / Night from settings, plus a native time input). The note stays until **both** date and
    time are chosen; then `assignStartDate` writes the three coordinated labels agenda reads —
    `#startDateTime` (`YYYY-MM-DDTHH:mm`), `#startDate`, `#startTime` (agenda's default label names) —
    and it auto-advances. A running preview shows the combined datetime. Uses `candidates`'
    `hasStartDate`.
  - **Misfiled Notes** — `getMisfiledNotes()` walks the Area subtrees (not Inbox — unfiled) and flags a
    note whose **`#area` differs from its ancestor Area**, or whose **`~template` isn't accepted by its
    ancestor bucket** (per `workflowStructure.js`'s `BUCKET_TEMPLATES`: bucket slug → accepted template
    titles; the Projects bucket accepts both `5. Project` and `3. Task`, since Tasks live under
    Projects). A "Misfiled:" reason line explains the mismatch, then up to three fix buttons appear:
    **Move to <area › bucket>** (`refileNote` = `toggleNoteInParent` add-new + remove-old, like
    [libAgendaOverview](../libagendaoverview@beatlink/libAgendaOverview.js); best-effort target — area
    root if type unknown, current area if `#area` unknown), **Set area to <slug>** (retag `#area` to the
    branch, trusting the tree), and **Set type to <template>** (reset `~template` to the bucket's
    canonical type). Only the applicable buttons show.
  - Scope for the two "without" sections excludes the structural `#workflowNote` notes; Misfiled scans
    only inside Area subtrees.
  - **Wiring gotcha:** `workflowOrganize.js` requires `workflowStructure.js`, so `structure` is cloned
    under `organize` in the manifest (a second `children` entry) — require resolves within the
    requirer's subtree, not globally. `validate` flags this if missed.
- **UI: the Setup page.** A second `render` page (`Workflow Setup`, id `setup-page`) →
  `workflowSetup.jsx` (id `setup`), separate from the main window. One button provisions the notebook
  structure at runtime (see below). Shares `workflowWindow.css`.
- **UI + infra: the Settings page.** `Workflow Settings` (`render`, id `settings-page`) →
  `workflowSettings.jsx` (id `settings`) drops in libsettings' `SettingsForm` over
  `workflowSchema.json` (id `schema`) + `workflowConfig.json` (id `config`) — same minimal pattern as
  [area-picker's settings](../area-picker@beatlink/settings.jsx). Today it holds the configurable
  **morning / noon / evening / night** times (defaults 08:00 / 12:00 / 17:00 / 20:00) used by the No
  Due Date section. `config` persists via a `settings → AddonData:config → config` relation. The main
  `window-page` also carries `schemaNote` + `configNote` relations so the Organize panel's
  `loadTimeSettings()` (via `api.startNote`) can read the times; it falls back to the defaults if
  libsettings/settings can't be resolved. Adds `libsettings@beatlink` as a dependency, wired as a
  `child: "ui"` under both `settings` and `organize-panel` (both import `libSettingsUI.jsx`).

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
  tag it; (3) else create + tag.
- **Derived vs. seed attributes.** Icon (`#iconClass`), color (`#color`), the `~template` relation, an
  Area note's **`#area` value**, and buckets' **`#alwaysExpanded`** are **derived** — re-asserted on
  *every* run, on adopted and created notes alike, so the structure self-heals and re-running fixes
  drift. (`#area` on Area roots is derived,
  not a seed, specifically so reordering the areas — which renumbers slugs — updates the root notes on
  the next provision.) Note **content** is written *only* on creation, so user edits survive.
- **Area-slug migration.** Slugs are `<NN>-<name>` and the number shifts when areas are reordered
  (e.g. Fun `14-fun` → `15-fun`), which would otherwise leave notes tagged with a stale `#area` (and
  make them show as "misfiled" / offer the wrong area). After the structure walk, `migrateAreaSlugs()`
  re-keys **every** note carrying `#area` by its stable name-part: it looks up the current slug for
  that name in `AREA_LIST` and rewrites `#area` + `#color` when the number drifted. Names not in
  `AREA_LIST` are left alone. The Setup page reports how many notes were migrated. Run the Setup
  provision button after any area reorder to apply it.
- **Colors** reuse agenda's `colors.area` palette (Legal=red, new). Each Area note gets
  `#color=<area color>`; each subtype bucket inherits its parent area's color. Inbox/My Day/Agenda
  have no color.
- **Templates** (resolved live by title from `templates@beatlink`, so provisioning degrades gracefully
  if it's absent): the 15 Area notes → `7. Area`; Inbox/My Day/Agenda and every subtype bucket →
  `8. Special` (the neutral container template). `templates@beatlink` is a declared dependency so TAM
  syncs it first, making the templates resolvable.
- **Buckets are containers, not items:** the six subtype notes under each area carry their id, their
  area's color, an icon, and **`#alwaysExpanded`** (so [expanded@beatlink](../expanded@beatlink/) keeps
  their area expanded in the tree) — no `#agendaTaskWidget` (they group actionable notes but aren't
  actionable themselves). `#alwaysExpanded` is derived (re-asserted every run).
- **Items are created programmatically, not by inheritance.** When the workflow adds an item into a
  bucket (a Task, Idea, Note, etc. — a later Organize/Collect phase), it sets that item's `~template`
  and `#area` **programmatically at creation**, resolved from the bucket's `#workflowNote` identity.
  We deliberately rejected `~child:template` + inheritable `#area` on the buckets: Trilium/TAM support
  both (`(inheritable)` suffix → real `isInheritable`; `~child:template` templates children), but
  attribute *inheritance is tied to tree position* — a note moved out of its bucket's subtree would
  silently lose its inherited type/area, and an inheritable `#area` on a container risks double-counting
  in agenda's area views. Programmatic assignment has neither failure mode and keeps the item's
  identity self-contained wherever it's later filed. Consequence: **no changes to `templates@beatlink`
  are needed** for bucket auto-typing — buckets stay on `8. Special`.
- `.js` libs (`workflowStructure.js`, `workflowProvision.js`) are plain CommonJS
  (`module.exports`/`require`), `env=frontend`; the backend work runs inside `api.runOnBackend`
  closures (which may reference only `api`), mirroring
  [web-preview's saveUrlToInbox](../web-preview@beatlink/libWebPreview.js) and area-picker's
  [saveArea](../area-picker@beatlink/areaPickerPreact.jsx) (`#area` + `#color`).
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
- [x] **Phase 2 (moved up) — Provisioning via Setup page.** `workflowStructure.js` (the layout data),
      `workflowProvision.js` (runtime find-or-create-by-title + `#workflowNote` tagging under `root`),
      and the `Workflow Setup` render page (`workflowSetup.jsx`) with a Provision button + result log.
      Passes `validate` + `tam_to_zip`. Not yet live-tested (Phase 4).
- [ ] **Phase 1 — Preset.** Author `config.json` (15 areas + Ideas search rule, optionally
      Context/Effort/Status filters), the Ideas template HTML, and extend the manifest to wire the
      preset + Ideas template. Run `validate`.
- [~] **Phase 3 — Tab wiring.** Fill in the window's panels.
      - [x] **Organize** — one-at-a-time triage sections: **Notes Without Templates**, **Notes Without
        Areas**, **Tasks Without Priority**, **Tasks Without a Start Date** (date+time picker,
        configurable times), **Misfiled Notes** (area/type mismatch vs branch, with move/relabel
        fixes).
      - [ ] **Review**/**Execute** embed the agenda Task View list (filtered per phase).
      - [ ] **Collect** points at the Inbox. Compose agenda pieces, don't reimplement.
- [ ] **Phase 4 — Live test.** Install agenda + templates + workflow in a test instance
      (`nix develop` → `trilium_seed` → `trilium_server start`). Confirm the notebook provisions, the
      preset drives the 15-area filters/colors/kanban, and each Workflow tab works end to end.
- [ ] **Phase 5 — Collect widgets (deferred).** Build inbox-triage widget(s) for the Collect phase
      (set area/type/priority/dates and file into the tree from the Inbox).
- [ ] **Phase 6 — Docs.** README, `generate_pages`, catalog entry.
