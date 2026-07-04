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

1. Open any note you want tasks re-filed into, then open the **Agenda** right-pane widget's default
   profile (shipped with an empty target) and click **File Tasks Here**.
2. Any note with a `#startDateTime`-style label matching the profile's searches will show up there,
   sorted/prefixed/colored per the profile's rules.
3. Give a note template the `#agendaTaskWidget` label (with no value) to make the Task widget appear
   on notes cloned from it.
4. (Electron desktop app only) Use the "Agenda Now" launcher buttons to add the current note to the
   focus window, or launch the window itself. Configure `agendaNowConfig.json`'s content directly
   (window size/position, which automatic behaviors are enabled) — see below for why this isn't a
   `libsettings@beatlink` schema-driven screen.

## Architecture

This addon owns exactly two things every other `lib*@beatlink` piece explicitly does *not*:

- **`agendaConstants.js`** — the canonical label-name vocabulary (`startDateTime`, `dueDateTime`,
  `duration`, `recurrence`, `rank`, etc), required directly by every widget here. The shared
  libraries (`libagendatask@beatlink`, `libagendaoverview@beatlink`, `libagendanow@beatlink`) never
  import this themselves — they take a `constants` object as a parameter, so this is the *one* place
  those label names are defined, top-down, rather than each library depending on a shared constants
  module bottom-up.
- **`profile.json` / `agendaNowConfig.json`** — plain, directly-editable JSON (not
  `libsettings@beatlink` schemas). `profile.json`'s shape (nested search/filter/sort/prefix/color
  rule groups) doesn't fit a flat schema, and this addon only supports a single profile — see
  [libagendaoverview@beatlink's README](../libagendaoverview@beatlink/README.md) for the single-profile
  caveat and where a real multi-profile design would go. `agendaNowConfig.json` could be moved to
  `libsettings@beatlink` later (flattening its one nested `newWindowConfig` object, since
  `libsettings`' schema has no nested-group field type yet) but wasn't, to keep this addon's first
  version to the actual 3 widgets rather than also building a settings screen nobody asked for yet.

Every widget resolves its own relations (`profile`, `icalNote`, `nowNote`, `agendaNowConfig`,
`LauncherWidget`) once on mount and passes the resolved ids down to whichever shared library
functions it calls — none of those relations live on the shared libraries themselves, since they're
shared, stateless, cloned-by-reference notes with no way to know which addon is asking.

## Known limitations

- **Single profile only** (see above).
- **`#agendaTaskWidget` is a fixed label name**, hardcoded in `agendaTask.jsx`/`agendaNowWindow.jsx`
  rather than sourced from `agendaConstants.js` — it's a "which notes opt into this widget" gate, not
  a data label, so it wasn't included in the constants object modeled on the original `libConstants.js`.
- **`agendaNowConfig.json` and `profile.json` have no dedicated settings UI** — `profile.json` is
  edited through the Overview widget itself (as in the original); `agendaNowConfig.json` is edited as
  raw JSON directly on its note.
