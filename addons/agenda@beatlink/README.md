# Agenda

A complete task/agenda system, wiring together every `lib*@beatlink` piece built for it into three
widgets:

1. **Overview** (`agendaOverview.jsx`, right-pane) — configure searches/filters/sort/prefix/color
   rules; matching notes get re-filed as children of whichever note you point the profile at, and a
   calendar feed gets exported automatically.
2. **Task** (`agendaTask.jsx`, right-pane) — edit a task's start/due dates, duration, recurrence,
   rank, and quick actions (complete, start today/tomorrow).
3. **Agenda Now** (`agendaNowLauncher.jsx` + `agendaNowWindow.jsx`, Electron-only) — an
   always-on-top focus window with a countdown timer, showing whichever tasks you've added to it.

## Setup

1. Use TAM's **Settings** button (or navigate to this addon's "Settings" note) to open the
   settings screen. There you can override any of the label names (`startDateTime`, `dueDateTime`,
   `duration`, `recurrence`, `rank`, etc — defaults match the original system) and optionally pick a
   different **Profile Note** if you don't want the shipped default profile.
2. Open any note you want tasks re-filed into, then open the **Agenda** right-pane widget's default
   profile (shipped with an empty target) and click **File Tasks Here**.
3. Any note with a `#startDateTime`-style label matching the profile's searches will show up there,
   sorted/prefixed/colored per the profile's rules.
4. Give a note template the `#agendaTaskWidget` label (with no value) to make the Task widget appear
   on notes cloned from it.
5. (Electron desktop app only) Use the "Agenda Now" launcher buttons to add the current note to the
   focus window, or launch the window itself. Configure `agendaNowConfig.json`'s content directly
   (window size/position, which automatic behaviors are enabled) — see below for why this isn't a
   `libsettings@beatlink` schema-driven screen.

## Architecture

This addon owns exactly two things every other `lib*@beatlink` piece explicitly does *not*:

- **A `libsettings@beatlink` schema** (`schema.json`/`config.json`/`settings.jsx`) holding the
  canonical label-name vocabulary (`startDatetimeLabel`, `dueDatetimeLabel`, `durationLabel`,
  `recurrenceLabel`, `rankLabel`, etc) plus a `profileId` note picker. `agendaSettings.jsx` loads
  this once per widget and reshapes it into the `constants` object (uppercase keys) and
  `profileNoteIds` array every `lib*@beatlink` function expects — those libraries never import
  settings themselves, they take `constants`/`profileNoteIds` as parameters, so this is the *one*
  place those label names are defined, top-down, rather than each library depending on a shared
  constants module bottom-up. If `profileId` is left blank, `agendaSettings.jsx` falls back to this
  addon's own shipped `profile.json` (via a `defaultProfileNote` relation on each widget).
- **`profile.json` / `agendaNowConfig.json`** — plain, directly-editable JSON (not additional
  `libsettings@beatlink` schemas). `profile.json`'s shape (nested search/filter/sort/prefix/color
  rule groups) doesn't fit a flat schema, and this addon only supports a single profile — see
  [libagendaoverview@beatlink's README](../libagendaoverview@beatlink/README.md) for the single-profile
  caveat and where a real multi-profile design would go. `agendaNowConfig.json` could be moved to
  `libsettings@beatlink` later (flattening its one nested `newWindowConfig` object, since
  `libsettings`' schema has no nested-group field type yet) but wasn't, to keep this addon's first
  version to the actual 3 widgets rather than also building a second settings screen nobody asked
  for yet.

Every widget resolves its own relations (`schemaNote`, `settingsNote`, `defaultProfileNote`,
`icalNote`, `nowNote`, `agendaNowConfig`, `LauncherWidget`) once on mount and passes the resolved
ids/constants down to whichever shared library functions it calls — none of those relations live on
the shared libraries themselves, since they're shared, stateless, cloned-by-reference notes with no
way to know which addon is asking.

## Known limitations

- **Single profile only** (see above).
- **`#agendaTaskWidget` is a fixed label name**, hardcoded in `agendaTask.jsx`/`agendaNowWindow.jsx`
  rather than sourced from the settings schema — it's a "which notes opt into this widget" gate, not
  a data label, so it wasn't included alongside the other label-name settings.
- **`agendaNowConfig.json` and `profile.json` have no dedicated settings UI** — `profile.json` is
  edited through the Overview widget itself (as in the original); `agendaNowConfig.json` is edited as
  raw JSON directly on its note.
