# Agenda

A complete task/agenda system, wiring together every `lib*@beatlink` piece built for it into three
widgets plus a single tabbed editor page:

1. **Overview** (`agendaOverview.jsx`, right-pane) — toggle which searches/filters are active and
   pick the sort/prefix/color for whichever note your profile is filing tasks into; matching notes
   get re-filed as children of that note, and a calendar feed gets exported automatically.
2. **Task** (`agendaTask.jsx`, right-pane) — edit a task's start/due dates, duration, recurrence,
   rank, and quick actions (complete, start today/tomorrow).
3. **Agenda Now** (`agendaNowLauncher.jsx` + `agendaNowWindow.jsx`, Electron-only) — an
   always-on-top focus window with a countdown timer, showing whichever tasks you've added to it.
4. **Agenda Editor** (`profileEditor.jsx`, a `render`-type page reachable from TAM's **Settings**
   button or the Overview widget) — a single tabbed page with seven tabs. Its **Settings** tab is
   just `SettingsForm` (the `libsettings@beatlink` schema/config UI) dropped in as-is. Its
   **Profile** tab builds a profile's search/filter groups and picks its sort/prefix/color, by
   referencing elements from the other tabs rather than hand-editing JSON. Its **Searches / Filters
   / Sorts / Prefixes / Colors / Date Rules** tabs are the Element Library, where every such element
   actually gets defined. Profiles never embed a rule's definition; they only reference an element
   by id, so editing an element on its tab updates every profile using it. Date rules are one level
   deeper than the rest: a dayjs-type filter and a prefix/color interval both reference a shared
   date rule (e.g. "Overdue") rather than each embedding their own copy of the same
   `["isBefore","startOfToday"]`-style criteria tuple. The Settings tab and the Profile tab each
   save explicitly (their own Save button); every element tab autosaves each edit immediately.

## Setup

1. Use TAM's **Settings** button (or navigate to this addon's "Agenda Editor" note) to open the
   Agenda Editor. Its Settings tab lets you override any of the label names (`startDateTime`,
   `dueDateTime`, `duration`, `recurrence`, `rank`, etc — defaults match the original system).
2. On the Agenda Editor's Profile tab, point the shipped "default" profile's **File Tasks Under** at
   whichever note you want tasks re-filed into, and enable/build out its search and filter groups
   (referencing the built-in elements, or new ones you add on the editor's other tabs).
3. Open any note filed under that target — the Overview widget there lets you toggle individual
   searches/filters and change sort/prefix/color live, without leaving the note.
4. Any note with a `#startDateTime`-style label matching the profile's searches will show up there,
   sorted/prefixed/colored per the profile's rules.
5. Give a note template the `#agendaTaskWidget` label (with no value) to make the Task widget appear
   on notes cloned from it.
6. (Electron desktop app only) Use the "Agenda Now" launcher buttons to add the current note to the
   focus window, or launch the window itself. Configure `agendaNowConfig.json`'s content directly
   (window size/position, which automatic behaviors are enabled) — see below for why this isn't a
   `libsettings@beatlink` schema-driven screen.

## Architecture

This addon owns exactly two things every other `lib*@beatlink` piece explicitly does *not*:

- **A `libsettings@beatlink` schema** (`schema.json`/`config.json`, rendered by the Agenda Editor's
  Settings tab) holding the canonical label-name vocabulary (`startDatetimeLabel`, `dueDatetimeLabel`,
  `durationLabel`, `recurrenceLabel`, `rankLabel`, etc) plus an optional `profileId` string override.
  `agendaSettings.jsx`'s `getAgendaSettings()` loads this once per widget and reshapes it into the
  `constants` object (uppercase keys) and a `profileContext` (`{ dataNoteId, builtinElementsNoteId,
  profileIds }`) every `lib*@beatlink` function expects — those libraries never import settings
  themselves, they take `constants`/`profileContext` as parameters, so this is the *one* place those
  label names are defined, top-down, rather than each library depending on a shared constants module
  bottom-up. `getAgendaSettings()` also hands back the raw `schemaNoteId`/`configNoteId` for the
  Agenda Editor's own Settings tab to render `SettingsForm` with directly. If `profileId` is left
  blank, the shipped `"default"` profile is used.
- **`agendaData.json` / `builtinElements.json` / `agendaNowConfig.json`** — plain JSON notes (not
  additional `libsettings@beatlink` schemas), edited through the Agenda Editor's tabs rather than by
  hand. `agendaData.json` holds every user-added or user-edited search/filter/
  sort/prefix/color element, a `removedBuiltinIds` set recording any built-in the user deleted, and
  every profile that references them; `builtinElements.json` holds only the addon's own shipped
  built-in elements. Its shape doesn't fit a flat schema, and this addon only supports a single active
  profile at a time — see [libagendaoverview@beatlink's README](../libagendaoverview@beatlink/README.md)
  for the exact shape, the built-in/user-data split, the single-profile caveat, and where a real
  multi-profile design would go. `agendaNowConfig.json` could be moved to `libsettings@beatlink` later
  (flattening its one nested `newWindowConfig` object, since `libsettings`' schema has no nested-group
  field type yet) but wasn't, to keep this addon's scope to the actual widgets rather than also
  building a second settings screen nobody asked for yet.

`agendaData.json` is persisted across addon updates via an `AddonData:profile` relation owned by the
`settings` note — a bare relation-anchor note (no code/UI of its own; every widget's `settingsNote`
relation points at it) — mirroring `AddonData:config`'s existing pattern, and **not** a direct
relation from every widget straight to the data note. Every widget instead resolves `settingsNote`
first, then reads `AddonData:profile` off of *that* note, live, whenever it needs the data note's id.
This
indirection matters: TAM's persistence mechanism duplicates a note into permanent storage and rewires
only the relation literally named `AddonData:<key>` to point at the copy — any other relation that
had pointed straight at the original note would be left dangling once the original is deleted.
`builtinElements.json`, by contrast, is **not** an `AddonData:` target — it's a plain
`builtinElementsNote` relation, so TAM overwrites its content on every update like any other addon
note. That's the whole point of splitting it out: shipping a new built-in search/filter/sort/prefix/
color in a future `agenda@beatlink` version now reaches already-installed users automatically (merged
in by `loadData`), instead of being silently dropped because the persisted data note is frozen. Every
widget resolves its other relations (`schemaNote`, `settingsNote`, `icalNote`, `nowNote`,
`agendaNowConfig`, `LauncherWidget`, `profileEditorNote`) once on mount and
passes the resolved ids/constants down to whichever shared library functions it calls — none of those
relations live on the shared libraries themselves, since they're shared, stateless, cloned-by-reference
notes with no way to know which addon is asking.

## Known limitations

- **Single profile only** (see above).
- **`#agendaTaskWidget` is a fixed label name**, hardcoded in `agendaTask.jsx`/`agendaNowWindow.jsx`
  rather than sourced from the settings schema — it's a "which notes opt into this widget" gate, not
  a data label, so it wasn't included alongside the other label-name settings.
- **`agendaNowConfig.json` has no dedicated settings UI** — it's edited as raw JSON directly on its
  note.
