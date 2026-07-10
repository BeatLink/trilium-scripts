# Agenda

A complete task/agenda system, wiring together every `lib*@beatlink` piece built for it into three
widgets plus a single schema-driven editor page:

1. **Overview** (`agendaOverview.jsx`, right-pane) — toggle which searches/filters are active and
   pick the sort/prefix/color for whichever note your profile is filing tasks into; matching notes
   get re-filed as children of that note, and a calendar feed gets exported automatically.
2. **Task** (`agendaTask.jsx`, right-pane) — edit a task's start/due dates, duration, recurrence,
   rank, and quick actions (complete, start today/tomorrow).
3. **Agenda Now** (`agendaNowLauncher.jsx` + `agendaNowWindow.jsx`, Electron-only) — an
   always-on-top focus window with a countdown timer, showing whichever tasks you've added to it.
4. **Agenda Editor** (`profileEditor.jsx`, a `render`-type page reachable from TAM's **Settings**
   button or the Overview widget) — `libsettings@beatlink`'s `SettingsForm` dropped in as-is, rendering
   one tab per top-level `schema.json` field's `tab`: **Settings** (the label-name vocabulary),
   **Profiles** (every profile's identity, its filing mode, and its sort/prefix/color/grouping pick),
   **Searches** (the shared search element library *and* every profile's Search Groups, tagged with
   which profile they belong to), **Filters** (same, for Filter Groups), and a flat **Sorts / Prefixes
   / Colors / Groupings / Date Rules** element library, one tab each. A group's usages reference
   elements from the Searches/Filters library by id, each folded to the actual referenced
   search/filter's fields inline via a `reference` field's `inline: true` — so a group and the elements
   it uses live on the same tab, nested, rather than a group living under a separate Profiles tab
   pointing at elements elsewhere. Every registry tab (including Profiles) autosaves each edit
   immediately; only the Settings tab's label-name fields wait on an explicit Save.
5. **Agenda Task View** (`taskView.jsx`, a `render`-type page reachable from the Overview widget's
   **Open Task View** button) — shows a profile's task list as **Tree** (a flat sorted list), **Kanban**
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
2. On the Agenda Editor's Profiles tab, point the shipped "default" profile's **File Tasks Under** at
   whichever note you want tasks re-filed into (only used when **Task Filing Mode** is "File Tasks as
   Children" — see below), and optionally pick a **Kanban Grouping**. On the Searches/Filters tabs,
   enable/build out that profile's search and filter groups (referencing the built-in elements there,
   or new ones you add) — each group you add picks which profile it belongs to.
3. Open any note filed under that target — the Overview widget there lets you toggle individual
   searches/filters and change sort/prefix/color live, without leaving the note, and has an **Open
   Task View** button.
4. Any note with a `#startDateTime`-style label matching the profile's searches will show up there,
   sorted/prefixed/colored per the profile's rules.
5. Give a note template the `#agendaTaskWidget` label (with no value) to make the Task widget appear
   on notes cloned from it.
6. (Electron desktop app only) Use the "Agenda Now" launcher buttons to add the current note to the
   focus window, or launch the window itself. Configure `agendaNowConfig.json`'s content directly
   (window size/position, which automatic behaviors are enabled) — see below for why this isn't a
   `libsettings@beatlink` schema-driven screen.
7. Each profile's **Task Filing Mode** (Profiles tab) picks how its matching notes are surfaced:
   **"File Tasks as Children"** (default, preserves the original behavior — notes are re-parented
   under **File Tasks Under**, and the Overview widget only shows up when browsing there) or
   **"Virtual View Only"** (no re-parenting; the profile's tasks are only browsable via the Agenda
   Task View page). A profile's **Kanban Grouping** (also Profiles tab, referencing a **Groupings**
   tab entry) picks which registry drives its Kanban view's columns — build one there the same way you
   build a Prefix or Color entry (by label value, or by date rule), except each column also gets its
   own display name and color.

## Architecture

This addon owns exactly two things every other `lib*@beatlink` piece explicitly does *not*:

- **A `libsettings@beatlink` schema** (`schema.json`/`config.json`, rendered wholesale by the Agenda
  Editor) holding *everything* configurable about this addon: the label-name vocabulary
  (`startDatetimeLabel`, `dueDatetimeLabel`, `durationLabel`, `recurrenceLabel`, `rankLabel`, etc),
  every shared `searches`/`filters`/`sorts`/`prefixes`/`colors`/`groupings`/`dateRules` `registry`, a
  `profiles` `registry` (identity + filing mode + sort/prefix/color/grouping pick), and
  `searchGroups`/`filterGroups` — each its own top-level `registry` (not nested inside `profiles`, so a
  group stays on the same tab as the elements it references), every entry carrying a `profileId` (a
  `reference` → `profiles`) saying which profile it belongs to, and each usage a `reference` into
  `searches`/`filters` with `inline: true` — see
  [libsettings@beatlink's README](../libsettings@beatlink/README.md) for the full mechanics
  (`registry`/`reference`/`showWhen`/nesting/`autosave`) this schema leans on.
  `agendaSettings.jsx`'s
  `getAgendaSettings()` loads this once per widget and reshapes it into the `constants` object
  (uppercase keys) and a `profileContext` (`{ schemaNoteId, configNoteId, profileIds }` — every id
  currently in the `profiles` registry, not a hardcoded single one) every `lib*@beatlink` function
  expects — those libraries never import settings themselves, they take `constants`/`profileContext`
  as parameters, so this is the *one* place those label names and profiles are defined, top-down,
  rather than each library depending on a shared constants module bottom-up.
- **`agendaNowConfig.json`** — a plain JSON note (not a `libsettings@beatlink` schema), edited as raw
  JSON directly on its own note rather than through the Agenda Editor. It could be moved to
  `libsettings@beatlink` later (flattening its one nested `newWindowConfig` object) but wasn't, to
  keep this addon's scope to the actual widgets rather than also building a second settings screen
  nobody asked for yet.

A Date Rule's actual `[operator, ...args]` comparison tuple, a Sort's actual libmultisort DSL string,
and a label-value prefix/color variant's actual flat `{labelValue: display}` map are all decomposed
in the schema into more directly-editable shapes (dropdowns, row lists, `registry` entries) —
[libagendaoverview@beatlink](../libagendaoverview@beatlink/README.md)'s `loadData` reassembles them
back into the shapes the actual matching/sorting/prefix/color logic has always worked with, so that
logic never had to change at all; only the schema/config layer feeding it did.

Every widget resolves its own relations (`schemaNote`, `settingsNote`, `icalNote`, `nowNote`,
`agendaNowConfig`, `LauncherWidget`, `profileEditorNote`, `taskViewNote`) once on mount and passes the
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

The Task View page (`taskView.jsx`) reads the same `getSortedTaskList`/`getPrefixes`/`getColors`/
`getGroups`/`getGroupColumns` functions the Overview widget's `updateTaskLists` composes, just without
ever calling `loadNotes` (the re-parenting step) — it's a read-only (except for `setGroupForNote`,
kanban's drag-drop write) alternate presentation over the same profile data, not a second copy of the
matching/sorting logic. `libagendataskcard@beatlink`/`libagendatreeview@beatlink`/
`libagendakanbanview@beatlink` are presentation-only, dependency-injected components (props in, no
relation resolution) like every other `lib*@beatlink` UI piece — see their own READMEs for props.

## Known limitations

- **`#agendaTaskWidget` is a fixed label name**, hardcoded in `agendaTask.jsx`/`agendaNowWindow.jsx`
  rather than sourced from the settings schema — it's a "which notes opt into this widget" gate, not
  a data label, so it wasn't included alongside the other label-name settings.
- **`agendaNowConfig.json` has no dedicated settings UI** — it's edited as raw JSON directly on its
  note.
- **A "Virtual View Only" profile's tasks don't appear via the right-pane Overview widget** — that
  widget is bound to whichever note the user is browsing, and a virtual-mode profile's tasks are never
  filed under any note for it to render on. The Agenda Task View page is the only way to browse a
  virtual-mode profile's tasks.
- **Kanban drag-and-drop only works for `type:"label"` groupings** — a `type:"dayjs"` grouping's
  columns are date windows (e.g. "Overdue"/"This Week"), not settable values, so dragging a card into
  one wouldn't have anything sensible to write; the Kanban view disables drag entirely for those.
- **The Task View's Tree mode is a flat sorted list, not a real note hierarchy** — it renders the same
  flat, ordered note-id list the Overview widget's re-parenting flow already flattens into one parent
  today; it doesn't compute or display actual parent/child nesting.
- **No migration from pre-2.0 installs.** This version replaced the addon's entire bespoke
  `agendaData.json`/`builtinElements.json` data model with a `libsettings@beatlink` schema — an
  install upgrading from an earlier version resets to the shipped schema defaults rather than
  carrying over its old customizations; the old notes are left in place, unused.
