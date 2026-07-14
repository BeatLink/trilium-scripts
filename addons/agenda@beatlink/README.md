# Agenda

A complete task/agenda system, wiring together every `lib*@beatlink` piece built for it into three
widgets plus a single schema-driven editor page:

1. **Overview** (`agendaOverview.jsx`, right-pane) — toggle which searches/filters are active and
   pick the sort/prefix/color for whichever note your profile is filing tasks into; matching notes
   get re-filed as children of that note, and a calendar feed gets exported automatically.
2. **Task** (`agendaTask.jsx`, right-pane) — edit a task's start/due dates, duration, recurrence,
   and quick actions (complete, start today/tomorrow).
3. **My Day** (`myDayWidget.jsx`, `note-detail-pane`) — a focus strip (a manual countdown timer) that
   appears inline at the top of one note's detail pane: whichever note you designate as your **My Day
   Note** in settings. It renders nothing on any other note. While that note is open it also runs the
   optional background loops (append due tasks to the note, send due notifications).
4. **Agenda Editor** (`profileEditor.jsx`, a `render`-type page reachable from TAM's **Settings**
   button or the Overview widget) — `libsettings@beatlink`'s `SettingsForm` dropped in as-is, rendering
   one tab per top-level `schema.json` field's `tab`: **Settings** (the label-name vocabulary),
   **Profiles** (every profile's identity, its collection view, and its sort/prefix/color/grouping pick),
   **Searches** (the shared search element library *and* every profile's Search Groups, tagged with
   which profile they belong to), **Filters** (same, for Filter Groups), a flat **Sorts / Prefixes
   / Colors / Groupings / Date Rules** element library, one tab each, and **My Day** (the My Day note
   picker plus its timer/due-task/notification flags). A group's usages reference
   elements from the Searches/Filters library by id, each folded to the actual referenced
   search/filter's fields inline via a `reference` field's `inline: true` — so a group and the elements
   it uses live on the same tab, nested, rather than a group living under a separate Profiles tab
   pointing at elements elsewhere. Every registry tab (including Profiles) autosaves each edit
   immediately; only the Settings tab's label-name fields wait on an explicit Save.
5. **Overview Note** (a single shared note, not a shipped code note) — the active profile's matching
   tasks are filed as its children and it is turned into a `book`/collection note whose `#viewType`
   is the profile's chosen **Collection View** (list/grid/table/board/calendar/geoMap/dashboard/
   presentation), so opening it shows those tasks in the corresponding built-in Trilium view. The
   Overview widget appears in the right pane while browsing this note.

## Setup

1. Use TAM's **Settings** button (or navigate to this addon's "Agenda Editor" note) to open the
   Agenda Editor. Its Settings tab lets you override any of the label names (`startDateTime`,
   `dueDateTime`, `duration`, `recurrence`, etc — defaults match the original system).
2. On the Agenda Editor's Settings tab, point **Overview Note** at the single note you want the
   agenda filed into (shared across all profiles), and set the **Active Profile**. On the Profiles
   tab, pick each profile's **Collection View** (list/grid/table/board/calendar/geoMap/dashboard/
   presentation — the built-in Trilium view the Overview Note is shown as) and optionally a **Kanban
   Grouping**. On the Searches/Filters tabs, enable/build out that profile's search and filter groups
   (referencing the built-in elements there, or new ones you add) — each group you add picks which
   profile it belongs to.
3. Open the **Overview Note** — Agenda makes it a `book`/collection note showing the active profile's
   matching tasks in the chosen view, and the Overview widget there lets you toggle individual
   searches/filters and change sort/prefix/color live, without leaving the note. The widget only
   appears on the Overview Note (it renders nothing elsewhere); when more than one profile exists, a
   **Profile** dropdown at the top switches the active profile (persisted), re-populating the note.
4. Any note with a `#startDateTime`-style label matching the profile's searches will show up there,
   sorted/prefixed/colored per the profile's rules.
5. Give a note template the `#agendaTaskWidget` label (with no value) to make the Task widget appear
   on notes cloned from it.
6. On the Agenda Editor's **My Day** tab, point **My Day Note** at whichever note you use as your
   daily focus note (defaults to the shipped "My Day" note). Open that note and the My Day focus strip
   (a manual countdown timer) appears at the top of its detail pane. The tab's flags control the
   timer's sounds and the two background loops (**Add Tasks When Due**, **Send Due Notifications**),
   which run only while that note is open.
7. Each profile's **Collection View** (Profiles tab) picks which built-in Trilium view the shared
   Overview Note is shown as (list/grid/table/board/calendar/geoMap/dashboard/presentation) once that
   profile's tasks are filed under it. When the view is **board**, the profile's **Kanban Grouping**
   (also Profiles tab, referencing a **Groupings** tab entry — and editable inline from the Overview
   widget's **Board Columns** dropdown) picks how the board's columns are generated. Every grouping
   type — by label value, by date window, or by recurrence frequency — is projected onto a single
   `#status` helper label the board groups on, so all three work as board columns. Build a grouping
   the same way you build a Prefix or Color entry. Four groupings ship by default — **By Priority**
   (the "default" profile's initial pick), **By Area**, **By Interval** (date windows), and **By
   Recurrence** (Hourly/Daily/Weekly/Monthly/Yearly/One-off). Switching the board's grouping updates
   the columns live, even on an already-open board.

## Architecture

This addon owns something every other `lib*@beatlink` piece explicitly does *not*:

- **A `libsettings@beatlink` schema** (`schema.json`/`config.json`, rendered wholesale by the Agenda
  Editor) holding *everything* configurable about this addon: the label-name vocabulary
  (`startDatetimeLabel`, `dueDatetimeLabel`, `durationLabel`, `recurrenceLabel`, etc),
  every shared `searches`/`filters`/`sorts`/`prefixes`/`colors`/`groupings`/`dateRules` `registry`, a
  `profiles` `registry` (identity + collection view + sort/prefix/color/grouping pick),
  `searchGroups`/`filterGroups` — each its own top-level `registry` (not nested inside `profiles`, so a
  group stays on the same tab as the elements it references), every entry carrying a `profileId` (a
  `reference` → `profiles`) saying which profile it belongs to, and each usage a `reference` into
  `searches`/`filters` with `inline: true` — and the **My Day** tab's fields (`myDayNoteId`, a
  `type: "note"` picker naming the note the My Day widget attaches to, plus the `enableSounds`,
  `addTasksWhenDue`, `sendDueNotifications` flags). See
  [libsettings@beatlink's README](../libsettings@beatlink/README.md) for the full mechanics
  (`registry`/`reference`/`showWhen`/nesting/`autosave`) this schema leans on.
  `agendaSettings.jsx`'s
  `getAgendaSettings()` loads this once per widget and reshapes it into the `constants` object
  (uppercase keys), a `profileContext` (`{ schemaNoteId, configNoteId, profileIds }` — every id
  currently in the `profiles` registry, not a hardcoded single one), and a `myDay` object
  (`{ myDayNoteId, enableSounds, addTasksWhenDue, sendDueNotifications }`) every `lib*@beatlink`
  function expects — those libraries never import settings themselves, they take
  `constants`/`profileContext` as parameters, so this is the *one* place those label names, profiles,
  and My Day behaviors are defined, top-down, rather than each library depending on a shared constants
  module bottom-up.

A Date Rule's actual `[operator, ...args]` comparison tuple, a Sort's actual libmultisort DSL string,
and a label-value prefix/color variant's actual flat `{labelValue: display}` map are all decomposed
in the schema into more directly-editable shapes (dropdowns, row lists, `registry` entries) —
[libagendaoverview@beatlink](../libagendaoverview@beatlink/README.md)'s `loadData` reassembles them
back into the shapes the actual matching/sorting/prefix/color logic has always worked with, so that
logic never had to change at all; only the schema/config layer feeding it did.

Every widget resolves its own relations (`schemaNote`, `settingsNote`, `icalNote`, `nowNote`,
`profileEditorNote`) once on mount and passes the
resolved ids/constants down to whichever shared library functions it calls — none of those relations
live on the shared libraries themselves, since they're shared, stateless, cloned-by-reference notes
with no way to know which addon is asking. `config.json` is persisted across addon updates via an
`AddonData:config` relation owned by the `settings` note — a bare relation-anchor note (no code/UI of
its own; every widget's `settingsNote` relation points at it). `schema.json` itself is **not** an
`AddonData:` target — a normal shipped note, overwritten on every TAM update like any other addon
note, which is what lets a new built-in search/filter/sort/prefix/color/grouping/date-rule/profile
default ship in a future version and reach existing installs automatically (every `registry` field's
`default` is reconciled against the user's own additions/edits/removals on every load, per
libsettings' shipped-vs-persisted-delta mechanics), rather than being silently dropped because the
persisted config is frozen — this is exactly how a profile missing `viewType`/`groupingSelected`
(from before this addon added them) picks up the schema's `"list"`/`""` defaults on next load with
no migration step.

The **Overview Note** is a single note shared across every profile (the top-level `overviewNoteId`
setting), with `activeProfileId` naming which profile currently populates it. On every update the
Overview widget runs `updateTaskLists`, which files only the active profile's matching tasks as
children of that note and calls `libagendaoverview`'s `configureOverviewNote` to make it a
`book`/collection note whose `#viewType` label is the active profile's chosen view — so opening the
note shows those tasks in the corresponding built-in Trilium collection view. This is find-or-set and
idempotent; switching the active profile (from the sidebar dropdown or the settings page)
re-populates the note with the new profile's tasks.

## Known limitations

- **`#agendaTaskWidget` is a fixed label name**, hardcoded in `agendaTask.jsx` rather than sourced
  from the settings schema — it's a "which notes opt into this widget" gate, not a data label, so it
  wasn't included alongside the other label-name settings.
- **One overview note, one active profile at a time** — all profiles share a single Overview Note, so
  only the active profile's tasks are shown/filed at once. Switching profiles re-files the shared
  note rather than maintaining a separate note per profile.
- **No migration from pre-2.0 installs.** This version replaced the addon's entire bespoke
  `agendaData.json`/`builtinElements.json` data model with a `libsettings@beatlink` schema — an
  install upgrading from an earlier version resets to the shipped schema defaults rather than
  carrying over its old customizations; the old notes are left in place, unused.
