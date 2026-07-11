# Agenda Now

"Focus window" actions for an agenda/task-management system: launch or focus an always-on-top
Electron popup window showing a target note, append due tasks to it as to-dos, and register its
launcher widget. Depends on [libagendaoverview@beatlink](../libagendaoverview@beatlink/) for
`getTaskList`.

**Electron-only.** `launchAgendaNow` uses `require('electron')`/`@electron/remote` directly — it only
works in the Trilium desktop app, not the web client or mobile. Calling it elsewhere will throw.

## Dependency injection

Like the other agenda libraries, this one takes everything it needs as parameters rather than
resolving its own relations or reading a shared config note:

- **`nowNoteId`** — the note id to show in the popup window / append tasks to.
- **`windowConfig`** — a plain object: `{ width, height, windowGap, alwaysOnTop, hideTitlebar, hideMenubar }`.
- **`profileContext`** / **`constants`** — same as
  [libagendaoverview@beatlink](../libagendaoverview@beatlink/README.md#dependency-injection).
- **`widgetNoteId`** — the note id of the launcher widget to register.

This library has no concept of "settings" or persisted config at all — see below for where those
values should come from.

## Usage

```js
const { launchAgendaNow, addTaskToAgendaNow, addDueTasksToAgendaNow, setupLauncherWidget } = require("libAgendaNow.js")

await launchAgendaNow(nowNoteId, windowConfig)
await addTaskToAgendaNow(nowNoteId, noteId, true)
await addDueTasksToAgendaNow(profileContext, constants, nowNoteId)
await setupLauncherWidget(widgetNoteId)
```

## API

### `launchAgendaNow(nowNoteId, windowConfig)`

Focuses the existing "Agenda Now" window if one is open, or creates and positions a new
always-on-top `BrowserWindow` showing `nowNoteId`, sized/positioned per `windowConfig` and anchored
to the bottom-right corner of the primary display's work area.

### `addTaskToAgendaNow(nowNoteId, noteId, todoEnabled)`

Appends a reference link to `noteId` onto `nowNoteId`'s content — as a disabled checkbox to-do if
`todoEnabled`, otherwise a plain paragraph — unless a reference to it is already present.

### `addDueTasksToAgendaNow(profileContext, constants, nowNoteId)`

Adds every task in `getTaskList` whose start datetime is exactly now onto `nowNoteId` as a to-do.

### `setupLauncherWidget(widgetNoteId)`

Registers `widgetNoteId` as a visible custom-widget launcher named "Agenda Launcher Widget".

## Where do `windowConfig` and the on/off flags come from?

The consuming addon (whatever widget decides *when* to call
`launchAgendaNow`/`addDueTasksToAgendaNow`/etc — this library only implements the actions themselves)
sources all of these from [libsettings@beatlink](../libsettings@beatlink/). Because `libsettings`'
schema has no nested-group field type (only flat fields and repeatable `list`s), `windowConfig`'s
fields live as flat top-level schema keys (`windowWidth`, `windowHeight`, `windowGap`,
`windowAlwaysOnTop`, `windowHideTitlebar`, `windowHideMenubar`) rather than a nested object, and the
consumer reassembles them into the `{ width, height, windowGap, alwaysOnTop, hideTitlebar,
hideMenubar }` object this library expects. See `agenda@beatlink`'s `schema.json` (the **Agenda Now**
tab) and `agendaSettings.jsx`'s `getAgendaSettings()` for the reference wiring.
