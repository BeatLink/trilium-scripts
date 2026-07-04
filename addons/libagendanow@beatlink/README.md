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
- **`profileNoteIds`** / **`constants`** — same as
  [libagendaoverview@beatlink](../libagendaoverview@beatlink/README.md#dependency-injection).
- **`widgetNoteId`** — the note id of the launcher widget to register.

This library has no concept of "settings" or persisted config at all — see below for where those
values should come from.

## Usage

```js
const { launchAgendaNow, addTaskToAgendaNow, addDueTasksToAgendaNow, setupLauncherWidget } = require("libAgendaNow.js")

await launchAgendaNow(nowNoteId, windowConfig)
await addTaskToAgendaNow(nowNoteId, noteId, true)
await addDueTasksToAgendaNow(profileNoteIds, constants, nowNoteId)
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

### `addDueTasksToAgendaNow(profileNoteIds, constants, nowNoteId)`

Adds every task in `getTaskList` whose start datetime is exactly now onto `nowNoteId` as a to-do.

### `setupLauncherWidget(widgetNoteId)`

Registers `widgetNoteId` as a visible custom-widget launcher named "Agenda Launcher Widget".

## Where should `windowConfig` and the on/off flags come from?

The original implementation stored `windowConfig` and several boolean flags (`enableLauncher`,
`addTasksWhenDue`, `sendDueNotifications`, `launchOnStart`, `enableSounds`) in one JSON blob read via
a bespoke `libJsonDatabase@beatlink.js` — see the comparison in this repo's history for the full
writeup, but in short: that library is a schema-less, generic get/save-JSON-content pair with no
defaults-merging and no settings-form UI, which [libsettings@beatlink](../libsettings@beatlink/)
already does a strict superset of. The consuming addon (whatever widget decides *when* to call
`launchAgendaNow`/`addDueTasksToAgendaNow`/etc — this library only implements the actions themselves)
should source all of these from `libsettings@beatlink`, with `windowConfig`'s fields flattened into
top-level schema keys (e.g. `windowWidth`, `windowHeight`, `windowGap`, `windowAlwaysOnTop`,
`windowHideTitlebar`, `windowHideMenubar`) rather than as a nested object, since `libsettings`'
schema doesn't yet have a nested-group field type (only flat fields and repeatable `list`s).
