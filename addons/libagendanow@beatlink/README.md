# Agenda Now

"My Day" task-filing actions for an agenda/task-management system: append a note to a target "My Day"
note as a to-do, and append every task that is due right now. Depends on
[libagendaoverview@beatlink](../libagendaoverview@beatlink/) for `getTaskList`.

Runs on the backend via `api.runOnBackend` — works in any Trilium client (desktop, web, mobile).

## Dependency injection

Like the other agenda libraries, this one takes everything it needs as parameters rather than
resolving its own relations or reading a shared config note:

- **`nowNoteId`** — the note id to append tasks to (the user's "My Day" note).
- **`profileContext`** / **`constants`** — same as
  [libagendaoverview@beatlink](../libagendaoverview@beatlink/README.md#dependency-injection).

This library has no concept of "settings" or persisted config at all — see below for where those
values should come from.

## Usage

```js
const { addTaskToAgendaNow, addDueTasksToAgendaNow } = require("libAgendaNow.js")

await addTaskToAgendaNow(nowNoteId, noteId, true)
await addDueTasksToAgendaNow(profileContext, constants, nowNoteId)
```

## API

### `addTaskToAgendaNow(nowNoteId, noteId, todoEnabled)`

Appends a reference link to `noteId` onto `nowNoteId`'s content — as a disabled checkbox to-do if
`todoEnabled`, otherwise a plain paragraph — unless a reference to it is already present.

### `addDueTasksToAgendaNow(profileContext, constants, nowNoteId)`

Adds every task in `getTaskList` whose start datetime is exactly now onto `nowNoteId` as a to-do.

## Where do `nowNoteId` and the on/off flags come from?

The consuming addon (whatever widget decides *when* to call `addDueTasksToAgendaNow`/etc — this
library only implements the actions themselves) sources these from
[libsettings@beatlink](../libsettings@beatlink/). See `agenda@beatlink`'s `schema.json` (the **My
Day** tab, e.g. `myDayNoteId`) and `agendaSettings.jsx`'s `getAgendaSettings()` for the reference
wiring.
