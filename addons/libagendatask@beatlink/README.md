# Agenda Task

Per-task note operations for an agenda/task-management system: marking a task done (advancing
recurring tasks to their next occurrence instead of just archiving them), rescheduling to a new day,
and keeping derived date/time labels in sync with a note's start/due/duration labels. Depends on
[librecurrence@beatlink](../librecurrence@beatlink/) for RRULE handling.

## Constants injection

This library doesn't import or hardcode label names from a shared constants module — every function
that needs to know which labels to read/write takes a `constants` object as a parameter instead. The
intent is to centralize the label vocabulary exactly once, at the top level of whatever program wires
this library together with the rest of the agenda system, and pass it down — rather than have every
library in the system depend on (and version-lock to) one shared constants library.

Every function below expects `constants` to be a plain object with (at least) these keys:

```js
{
    START_DATETIME_LABEL: "startDateTime",
    START_DATE_LABEL:     "startDate",
    START_TIME_LABEL:     "startTime",
    DUE_DATETIME_LABEL:   "dueDateTime",
    DUE_DATE_LABEL:       "endDate",
    DUE_TIME_LABEL:       "endTime",
    DURATION_LABEL:       "duration",
    RECURRENCE_LABEL:     "recurrence"
}
```

## Usage

Install as a dependency and clone the `libAgendaTask.js` note as a child of the script that needs it:

```js
const { complete, rescheduleByDays, updateDependentAttributes, durationStringToHMS } = require("libAgendaTask.js")

await complete(noteId, constants)
```

## API

### `durationStringToHMS(duration)`

Converts an ISO-8601 duration string (e.g. `"PT1H30M"`) into `{ hours, minutes, seconds }`. Doesn't
need `constants` — it's a pure string/duration conversion.

### `humanizeDuration(duration)`

Formats an ISO-8601 duration string into a human-readable string (`"PT1H30M"` -> `"1h 30m"`), showing
only non-zero components. Returns `""` for empty input. Used to fill the `#durationDisplay` label.

### `complete(noteId, constants)`

If the note has both a start datetime and a recurrence rule, advances it to the next occurrence
(clears its "done" markers and bumps the start datetime/recurrence count) — or marks it done if there
is no next occurrence. If the note has no recurrence, just runs `updateDependentAttributes`.

### `rescheduleByDays(noteId, constants, daysToAdd = 0)`

Moves the note's start date to today (or `daysToAdd` days from today), preserving its time-of-day,
then re-syncs dependent attributes.

### `updateDependentAttributes(noteId, constants)`

Recomputes the due datetime from start + duration, the split date/time labels used for calendar
export, the duration suffix shown on the note's title, and the human-readable `#durationDisplay` /
`#recurrenceDisplay` labels (used by the overview's table/grid columns). Called automatically by
`complete` and `rescheduleByDays`, but exported separately for callers that only change one label at a
time (e.g. a picker UI reacting to a single field's `onChange`).

### `refreshDisplayLabels(noteId, constants)`

Stamps only the human-readable `#durationDisplay` / `#recurrenceDisplay` labels (from the note's
`#duration` / `#recurrence`), without touching the title/due-date/calendar labels the way
`updateDependentAttributes` does. Used by the overview to backfill these labels on filed tasks that
were never edited through the picker. No-op writes are skipped, so calling it on every refresh is
cheap.
