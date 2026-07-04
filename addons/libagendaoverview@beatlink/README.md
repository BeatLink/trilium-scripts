# Agenda Overview

Search/filter/sort/prefix/color engine for an agenda/task-management system. Each "profile" is a
JSON note describing: which searches to run, which filters must all match, how to sort the results,
and how to prefix/color each resulting note — this library resolves a profile into a final note list
and re-files those notes as children of the profile's target note. Also exports due tasks as an iCal
feed.

Depends on [libagendatask@beatlink](../libagendatask@beatlink/) (rescheduling),
[libnotification@beatlink](../libnotification@beatlink/) (due-task notifications),
[libcalendar@beatlink](../libcalendar@beatlink/) (iCal generation — this used to build its own ics
string inline; that logic now lives in one place, shared with
[simplecalendar@beatlink](../simplecalendar@beatlink/)), and
[libmultisort@beatlink](../libmultisort@beatlink/) (sorting).

## Dependency injection

Like [libagendatask@beatlink](../libagendatask@beatlink/), this library doesn't resolve its own
relations or import a shared constants module — the caller supplies:

- **`profileNoteIds`** — an array of note ids, each pointing at a profile JSON note (however the
  caller resolves those, e.g. its own `"profile"` relation(s)).
- **`constants`** — the same label-name object described in
  [libagendatask@beatlink's README](../libagendatask@beatlink/README.md#constants-injection) (this
  library and the `libAgendaTask.js` calls it makes both read from it).
- **`icalNoteId`** — the note id of the `.ical`-mime file note to write the generated calendar feed
  to.

## Profile JSON shape

```json
{
    "name": "default",
    "parentNoteId": "<noteId of the overview's target note>",
    "searchGroups": {
        "children": {
            "<groupKey>": {
                "name": "Group Label",
                "children": {
                    "<searchKey>": { "name": "Label", "rule": "<Trilium search query>", "enabled": true }
                }
            }
        }
    },
    "filterGroups": {
        "children": {
            "<groupKey>": {
                "name": "Group Label",
                "type": "search",
                "children": { "<filterKey>": { "name": "Label", "rule": "<Trilium search query>", "enabled": true } }
            },
            "<dayjsGroupKey>": {
                "name": "Group Label",
                "type": "dayjs",
                "datetimeLabel": "startDateTime",
                "useNumberOfDays": false,
                "children": { "<filterKey>": { "name": "Label", "rule": ["isBefore", "startOfToday"], "enabled": true } }
            }
        }
    },
    "sorts":    { "selected": "<key>", "children": { "<key>": { "name": "Label", "rule": "priority:desc;startDateTime" } } },
    "prefixes": { "selected": "<key>", "children": { "<key>": { "type": "label"|"dayjs", ... } } },
    "colors":   { "selected": "<key>", "children": { "<key>": { "type": "label"|"dayjs", ... } } }
}
```

Every `searchGroups` entry is a Trilium search query, OR'd within a group and AND'd across groups
with everything in `filterGroups` (a `"search"`-type filter group runs its own search query;
a `"dayjs"`-type filter group tests a note's `datetimeLabel` against relative-date criteria —
`isNull`, `isBefore`/`isAfter`/`isBetween`/`isSame` etc against named reference points: `now`,
`startOfToday`, `endOfToday`, `endOfTomorrow`, `endOfThisWeek`, `endOfThisMonth`, `endOfThisYear`).
The selected `sorts` entry's `rule` is a [libmultisort](../libmultisort@beatlink/) sort string. The
selected `prefixes`/`colors` entry maps either a note label's value (`type: "label"`) or a
`matchesDayJsCriteria` match (`type: "dayjs"`) to a prefix string / CSS color name.

**Only one profile per `parentNoteId` is supported** — `getMatchingProfile` returns the first profile
whose `parentNoteId` matches, and `getTaskList` (and everything built on it — due notifications,
reschedule-all, iCal export) only ever processes the *first* profile in `profileNoteIds`, even though
`updateTaskLists` refreshes every profile in the array. This mirrors the original single-profile
system this was extracted from; a real multi-profile design (along the lines of
[libsettings](../libsettings@beatlink/)'s `list` schema type) is a deliberate later decision, not
something this extraction changed.

## Usage

```js
const {
    getMatchingProfile, saveProfile, updateTaskLists, getTaskList,
    sendNotificationForDueTasks, rescheduleAllTasks, setCalendarEvents
} = require("libAgendaOverview.js")

await updateTaskLists(profileNoteIds, constants, icalNoteId)
```

## API

### `getMatchingProfile(profileNoteIds, overviewNoteId)`

Returns the parsed profile object (with `noteId` set) whose `parentNoteId` equals `overviewNoteId` —
used by the overview widget to find its own profile among all of them.

### `saveProfile(profile)`

Writes a (possibly edited) profile object back to its own note as JSON.

### `updateTaskLists(profileNoteIds, constants, icalNoteId)`

For every profile: runs its searches/filters/sort/prefix/color rules, re-files the resulting notes
as children of `profile.parentNoteId`, and refreshes the iCal feed.

### `getTaskList(profileNoteIds)`

Returns the filtered (searched + filtered, not yet sorted) note id list for the first profile only —
see the single-profile caveat above.

### `sendNotificationForDueTasks(profileNoteIds, constants)`

Sends a desktop notification for every task in `getTaskList` whose start datetime is exactly now.

### `rescheduleAllTasks(profileNoteIds, constants, icalNoteId, days = 0)`

Reschedules every task in `getTaskList` to `days` days from now (same day by default), then refreshes
the task lists.

### `setCalendarEvents(profileNoteIds, constants, icalNoteId)`

Resolves `getTaskList`'s note ids to notes, builds an iCal feed via
[libCalendar.js](../libcalendar@beatlink/)'s `generateCalendar`, and writes it to `icalNoteId`.
