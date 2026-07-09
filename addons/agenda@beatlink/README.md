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
   **Profiles** (every profile — its identity, its sort/prefix/color pick, and its own Search Groups/
   Filter Groups, each usage folded to the actual referenced search/filter's fields inline via a
   `reference` field's `inline: true`), and a flat **Searches / Filters / Sorts / Prefixes / Colors /
   Date Rules** element library, one tab each. A profile's Search Groups/Filter Groups reference
   elements from those library tabs by id; editing an element on its own tab updates every profile
   using it. Every registry tab (including Profiles) autosaves each edit immediately; only the
   Settings tab's label-name fields wait on an explicit Save.

## Setup

1. Use TAM's **Settings** button (or navigate to this addon's "Agenda Editor" note) to open the
   Agenda Editor. Its Settings tab lets you override any of the label names (`startDateTime`,
   `dueDateTime`, `duration`, `recurrence`, `rank`, etc — defaults match the original system).
2. On the Agenda Editor's Profiles tab, point the shipped "default" profile's **File Tasks Under** at
   whichever note you want tasks re-filed into, and enable/build out its search and filter groups
   (referencing the built-in elements on the Searches/Filters tabs, or new ones you add there).
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

- **A `libsettings@beatlink` schema** (`schema.json`/`config.json`, rendered wholesale by the Agenda
  Editor) holding *everything* configurable about this addon: the label-name vocabulary
  (`startDatetimeLabel`, `dueDatetimeLabel`, `durationLabel`, `recurrenceLabel`, `rankLabel`, etc),
  every shared `searches`/`filters`/`sorts`/`prefixes`/`colors`/`dateRules` `registry`, and a
  `profiles` `registry` (each profile's own `searchGroups`/`filterGroups` nested inside it, each
  usage a `reference` into `searches`/`filters` with `inline: true`) — see
  [libsettings@beatlink's README](../libsettings@beatlink/README.md) for the full mechanics
  (`registry`/`reference`/`showWhen`/nesting/`autosave`) this schema leans on. `agendaSettings.jsx`'s
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
`agendaNowConfig`, `LauncherWidget`, `profileEditorNote`) once on mount and passes the resolved
ids/constants down to whichever shared library functions it calls — none of those relations live on
the shared libraries themselves, since they're shared, stateless, cloned-by-reference notes with no
way to know which addon is asking. `config.json` is persisted across addon updates via an
`AddonData:config` relation owned by the `settings` note — a bare relation-anchor note (no code/UI of
its own; every widget's `settingsNote` relation points at it). `schema.json` itself is **not** an
`AddonData:` target — a normal shipped note, overwritten on every TAM update like any other addon
note, which is what lets a new built-in search/filter/sort/prefix/color/date-rule/profile default
ship in a future version and reach existing installs automatically (every `registry` field's
`default` is reconciled against the user's own additions/edits/removals on every load, per
libsettings' shipped-vs-persisted-delta mechanics), rather than being silently dropped because the
persisted config is frozen.

## Known limitations

- **`#agendaTaskWidget` is a fixed label name**, hardcoded in `agendaTask.jsx`/`agendaNowWindow.jsx`
  rather than sourced from the settings schema — it's a "which notes opt into this widget" gate, not
  a data label, so it wasn't included alongside the other label-name settings.
- **`agendaNowConfig.json` has no dedicated settings UI** — it's edited as raw JSON directly on its
  note.
- **No migration from pre-2.0 installs.** This version replaced the addon's entire bespoke
  `agendaData.json`/`builtinElements.json` data model with a `libsettings@beatlink` schema — an
  install upgrading from an earlier version resets to the shipped schema defaults rather than
  carrying over its old customizations; the old notes are left in place, unused.
