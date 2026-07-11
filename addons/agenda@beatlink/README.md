# Agenda

A complete task/agenda system, wiring together every `lib*@beatlink` piece built for it into three
widgets plus a single schema-driven editor page:

1. **Overview** (`agendaOverview.jsx`, right-pane) — toggle which searches/filters are active and
   pick the sort/prefix/color for whichever note your profile is filing tasks into; matching notes
   get re-filed as children of that note, and a calendar feed gets exported automatically.
2. **Task** (`agendaTask.jsx`, right-pane) — edit a task's start/due dates, duration, recurrence,
   rank, and quick actions (complete, start today/tomorrow).
3. **My Day** (`myDayWidget.jsx`, `note-detail-pane`) — a focus strip (a manual countdown timer) that
   appears inline at the top of one note's detail pane: whichever note you designate as your **My Day
   Note** in settings. It renders nothing on any other note. While that note is open it also runs the
   optional background loops (append due tasks to the note, send due notifications).
4. **Agenda Editor** (`profileEditor.jsx`, a `render`-type page reachable from TAM's **Settings**
   button or the Overview widget) — `libsettings@beatlink`'s `SettingsForm` dropped in as-is, rendering
   one tab per top-level `schema.json` field's `tab`: **Settings** (the label-name vocabulary),
   **Profiles** (every profile's identity, its filing mode, and its sort/prefix/color/grouping pick),
   **Searches** (the shared search element library *and* every profile's Search Groups, tagged with
   which profile they belong to), **Filters** (same, for Filter Groups), a flat **Sorts / Prefixes
   / Colors / Groupings / Date Rules** element library, one tab each, and **My Day** (the My Day note
   picker plus its timer/due-task/notification flags). A group's usages reference
   elements from the Searches/Filters library by id, each folded to the actual referenced
   search/filter's fields inline via a `reference` field's `inline: true` — so a group and the elements
   it uses live on the same tab, nested, rather than a group living under a separate Profiles tab
   pointing at elements elsewhere. Every registry tab (including Profiles) autosaves each edit
   immediately; only the Settings tab's label-name fields wait on an explicit Save.
5. **Agenda Task View** (`taskView.jsx`, a shipped `render` code note) — shows a profile's task list
   as **Table** (a sortable, column-toggleable grid whose rows expand to show each task note's child
   notes; the default view), **Kanban**
   (columns from the profile's picked `groupings` entry, drag-and-drop between columns to reassign the
   underlying label), or **Calendar** (via `libcalendarwidget@beatlink`, mapped directly from the task
   list rather than the ical feed). A profile switcher appears when more than one profile exists.
   Clicking a card in any view calls `activateNote`, letting the existing right-pane Task widget (not
   this page) handle actual editing. Does **not** replace the Overview widget's re-filing behavior —
   see `fileMode` below.

## Setup

1. Use TAM's **Settings** button (or navigate to this addon's "Agenda Editor" note) to open the
   Agenda Editor. Its Settings tab lets you override any of the label names (`startDateTime`,
   `dueDateTime`, `duration`, `recurrence`, `rank`, etc — defaults match the original system).
2. On the Agenda Editor's Profiles tab, set the shipped "default" profile's **Task Filing Mode**. In
   **File Tasks as Children** mode, point its **File Tasks Under** at whichever note you want tasks
   re-filed into. In **Virtual View Only** mode, point its **Virtual View Note** at any note you want
   to turn into this profile's Task View — Agenda converts that note into a `render` note wired to the
   shipped `taskView.jsx` (only one of the two fields is shown at a time, per the selected mode).
   Optionally pick a **Kanban Grouping**. On the Searches/Filters tabs, enable/build out that
   profile's search and filter groups (referencing the built-in elements there, or new ones you add) —
   each group you add picks which profile it belongs to.
3. Open the profile's claimed note (its **File Tasks Under** target in reparent mode, or its **Virtual
   View Note** in virtual mode) — the Overview widget there lets you toggle individual searches/filters
   and change sort/prefix/color live, without leaving the note. The widget only appears on a claimed
   note (it renders nothing elsewhere); when more than one profile exists, a **Profile** dropdown at
   the top lets you switch which profile you're editing. A virtual profile's **Virtual View Note**
   reflects Overview edits live — it re-renders when the sidebar saves.
4. Any note with a `#startDateTime`-style label matching the profile's searches will show up there,
   sorted/prefixed/colored per the profile's rules.
5. Give a note template the `#agendaTaskWidget` label (with no value) to make the Task widget appear
   on notes cloned from it.
6. On the Agenda Editor's **My Day** tab, point **My Day Note** at whichever note you use as your
   daily focus note (defaults to the shipped "My Day" note). Open that note and the My Day focus strip
   (a manual countdown timer) appears at the top of its detail pane. The tab's flags control the
   timer's sounds and the two background loops (**Add Tasks When Due**, **Send Due Notifications**),
   which run only while that note is open.
7. Each profile's **Task Filing Mode** (Profiles tab) picks how its matching notes are surfaced:
   **"File Tasks as Children"** (default, preserves the original behavior — notes are re-parented
   under **File Tasks Under**, and the Overview widget only shows up when browsing there) or
   **"Virtual View Only"** (no re-parenting; the profile's **Virtual View Note** is converted into a
   `render` note showing the Task View, and the Overview widget shows up when browsing that note). A
   profile's **Kanban Grouping** (also Profiles tab, referencing a **Groupings**
   tab entry) picks which registry drives its Kanban view's columns — build one there the same way you
   build a Prefix or Color entry (by label value, or by date rule), except each column also gets its
   own display name and color. Three groupings ship by default, mirroring the Prefix/Color defaults —
   **By Priority** (the "default" profile's initial pick), **By Area**, and **By Interval** (date
   windows).

## Architecture

This addon owns something every other `lib*@beatlink` piece explicitly does *not*:

- **A `libsettings@beatlink` schema** (`schema.json`/`config.json`, rendered wholesale by the Agenda
  Editor) holding *everything* configurable about this addon: the label-name vocabulary
  (`startDatetimeLabel`, `dueDatetimeLabel`, `durationLabel`, `recurrenceLabel`, `rankLabel`, etc),
  every shared `searches`/`filters`/`sorts`/`prefixes`/`colors`/`groupings`/`dateRules` `registry`, a
  `profiles` `registry` (identity + filing mode + sort/prefix/color/grouping pick),
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
`profileEditorNote`, `taskViewRenderNote`) once on mount and passes the
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
persisted config is frozen — this is exactly how a profile missing `fileMode`/`groupingSelected`
(from before this addon added them) picks up the schema's `"reparent"`/`""` defaults on next load with
no migration step.

The Task View (`taskView.jsx`, a shipped `render` code note) is not bundled onto a fixed page. A
virtual-mode profile names a **Virtual View Note** on the Profiles tab; when the Overview widget
runs `updateTaskLists` for that profile, `libagendaoverview`'s `configureViewNote` sets that note's
type to `render` and points its `~renderNote` relation at the `taskView.jsx` code note (resolved via
the widget's `taskViewRenderNote` relation) — so opening the note shows the Task View. This is
find-or-set and idempotent, run on every update. It reads the same `getSortedTaskList`/`getPrefixes`/`getColors`/
`getGroups`/`getGroupColumns` functions the Overview widget's `updateTaskLists` composes, just without
ever calling `loadNotes` (the re-parenting step) — it's a read-only (except for `setGroupForNote`,
kanban's drag-drop write) alternate presentation over the same profile data, not a second copy of the
matching/sorting logic. `libagendataskcard@beatlink`/`libagendatableview@beatlink`/
`libagendakanbanview@beatlink` are presentation-only, dependency-injected components (props in, no
relation resolution) like every other `lib*@beatlink` UI piece — see their own READMEs for props.

The Task View stays live with the Overview sidebar via a `useTriliumEvent("entitiesReloaded", ...)`
subscription: the sidebar writes profile edits into the shared `config.json` note, and when that
note's content reloads on the frontend, the Task View re-pulls `loadData`/`getAllProfiles` and its
task list (keeping the user's selected profile if it still exists). It watches only its own config
note, via `loadResults.isNoteContentReloaded(configNoteId)`, so unrelated edits don't churn it.

## Known limitations

- **`#agendaTaskWidget` is a fixed label name**, hardcoded in `agendaTask.jsx` rather than sourced
  from the settings schema — it's a "which notes opt into this widget" gate, not a data label, so it
  wasn't included alongside the other label-name settings.
- **A "Virtual View Only" profile files no tasks under any note** — its tasks stay in place. It is
  surfaced through its **Virtual View Note** instead, which Agenda turns into a `render` note showing
  the Task View. The Overview widget appears when browsing that note (matched by `viewNoteId`), same
  as it appears on a reparent profile's **File Tasks Under** target (matched by `parentNoteId`).
- **Kanban drag-and-drop only works for `type:"label"` groupings** — a `type:"dayjs"` grouping's
  columns are date windows (e.g. "Overdue"/"This Week"), not settable values, so dragging a card into
  one wouldn't have anything sensible to write; the Kanban view disables drag entirely for those.
- **The Task View's Table rows are a flat sorted list at top level** — the top-level rows are the
  flat, ordered note-id list the Overview widget's re-parenting flow produces, not a computed
  parent/child ordering. Expanding a row does show that task note's actual child notes as sub-rows
  (from `getChildNotes`), but the top-level ordering itself is the flat profile list.
- **No migration from pre-2.0 installs.** This version replaced the addon's entire bespoke
  `agendaData.json`/`builtinElements.json` data model with a `libsettings@beatlink` schema — an
  install upgrading from an earlier version resets to the shipped schema defaults rather than
  carrying over its old customizations; the old notes are left in place, unused.
