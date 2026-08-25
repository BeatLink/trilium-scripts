# Timer

A countdown timer in its own right-pane panel, shown on every note. Split out of
[`agenda-myday@beatlink`](../agenda-myday@beatlink/README.md), which used to embed it in the My Day
panel; it shares no code, settings note, or labels with the agenda addons and works on its own.

## The panel

Three dropdowns pick hours, minutes and seconds (0-24h, 0-59m, 0-59s). While the timer is idle they
are the whole panel; starting it swaps them for the remaining time as `HH:MM:SS`.

- **Start** is disabled while the picked duration is zero.
- **Pause** freezes the countdown and keeps the remaining time on screen; **Start** resumes it.
- **Reset** returns to the dropdowns.

The remaining time flashes in the accent colour while the timer runs and in red once it expires. It
counts down in the browser (`setInterval`, one tick a second), so it stops with the page: nothing is
persisted and closing Trilium loses a running timer.

## Sounds

Three WAVs ship with the addon as `#customResourceProvider` files, served at
`custom/libtimerSelect.wav`, `custom/libtimerStart.wav` and `custom/libtimerEnd.wav`: a click on each
dropdown change and on pause, a chime on start, and an alarm on expiry and reset. The single
**Enable Timer Sounds** setting mutes all three.

The `Timer` component in `ui/Timer.jsx` takes the three URLs as props, so a caller can point them
elsewhere; the panel in the same file uses the defaults.

## Configuration

One settings note holds a `schema.json` / `defaults.json` / `config.json` set, tagged **`#timerConfig`**
and anchored on the **Timer Settings** page, which is both the anchor and the UI that edits it.
`ui/Settings.jsx` holds both that page and the `getTimerSettings()` the panel reads: it finds the note
at runtime through the label and falls back to the shipped defaults when it isn't discoverable.

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| Enable Timer Sounds | `true` | Play the select / start / end sounds. |

Settings come from [`libsettings@beatlink`](../libsettings@beatlink/README.md).

## Layout

Sources are grouped by kind, and note titles match the file names:

| Folder | Holds |
| ------ | ----- |
| `ui/` | `Timer.jsx` (the component and the right-pane panel it is drawn in), `Settings.jsx` (the settings page plus the accessors the panel reads), `style.css` |
| `config/` | `schema.json`, `defaults.json` |
| `static/` | `select.wav`, `start.wav`, `end.wav` |

Trilium resolves an `import` / `require` by note title within the importer's subtree, not by path, so
the folders are a repo-side convention only.
