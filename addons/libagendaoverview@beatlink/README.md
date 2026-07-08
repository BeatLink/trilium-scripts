# Agenda Overview

Search/filter/sort/prefix/color engine for an agenda/task-management system. All of a caller's
searches, filters, sorts, prefixes, and colors live as named, reusable "elements" in one shared
registry, and each "profile" only stores references into that registry — this library resolves a
profile into a final note list and re-files those notes as children of the profile's target note.
Also exports due tasks as an iCal feed.

Depends on [libagendatask@beatlink](../libagendatask@beatlink/) (rescheduling),
[libnotification@beatlink](../libnotification@beatlink/) (due-task notifications),
[libcalendar@beatlink](../libcalendar@beatlink/) (iCal generation — this used to build its own ics
string inline; that logic now lives in one place, shared with
[simplecalendar@beatlink](../simplecalendar@beatlink/)), and
[libmultisort@beatlink](../libmultisort@beatlink/) (sorting).

## Dependency injection

Like [libagendatask@beatlink](../libagendatask@beatlink/), this library doesn't resolve its own
relations or import a shared constants module — the caller supplies:

- **`profileContext`** — `{ dataNoteId, profileIds }`. `dataNoteId` is the single JSON note holding
  every element registry plus every profile (however the caller resolves it — see
  [agenda@beatlink](../agenda@beatlink/)'s use of an `AddonData:profile` relation, indirected through
  its own settings note so the relation survives persistence). `profileIds` is an array of keys into
  `data.profiles`.
- **`constants`** — the same label-name object described in
  [libagendatask@beatlink's README](../libagendatask@beatlink/README.md#constants-injection) (this
  library and the `libAgendaTask.js` calls it makes both read from it).
- **`icalNoteId`** — the note id of the `.ical`-mime file note to write the generated calendar feed
  to.

## Data note shape

```json
{
    "searches": { "<elementId>": { "name": "Label", "rule": "<Trilium search query>" } },
    "dateRules": {
        "<elementId>": { "name": "Label", "rule": ["isBefore", "startOfToday"] }
    },
    "filters": {
        "<elementId>": { "name": "Label", "type": "search", "rule": "<Trilium search query>" },
        "<dayjsElementId>": {
            "name": "Label", "type": "dayjs",
            "datetimeLabel": "startDateTime", "useNumberOfDays": false,
            "dateRuleId": "<key into dateRules>"
        }
    },
    "sorts":    { "<elementId>": { "name": "Label", "rule": "priority:desc;startDateTime" } },
    "prefixes": {
        "<elementId>": {
            "name": "Label", "type": "label"|"dayjs",
            "label": "<note label name>", "children": { "<labelValue>": "<prefix string>" },
            "dateLabel": "<note label name>", "useNumberOfDays": false,
            "intervals": { "<intervalKey>": { "dateRuleId": "<key into dateRules>", "formatString": "MMM D, HH:mm" } }
        }
    },
    "colors": {
        "<elementId>": {
            "name": "Label", "type": "label"|"dayjs",
            "label": "<note label name>", "children": { "<labelValue>": "<CSS color>" },
            "dateLabel": "<note label name>", "useNumberOfDays": false,
            "intervals": { "<intervalKey>": { "dateRuleId": "<key into dateRules>", "color": "<CSS color>" } }
        }
    },
    "profiles": {
        "<profileId>": {
            "name": "default",
            "parentNoteId": "<noteId of the overview's target note>",
            "searchGroups": {
                "children": {
                    "<groupKey>": {
                        "name": "Group Label",
                        "children": { "<usageKey>": { "elementId": "<key into searches>", "enabled": true } }
                    }
                }
            },
            "filterGroups": {
                "children": {
                    "<groupKey>": {
                        "name": "Group Label",
                        "children": { "<usageKey>": { "elementId": "<key into filters>", "enabled": true } }
                    }
                }
            },
            "sorts":    { "selected": "<key into sorts>" },
            "prefixes": { "selected": "<key into prefixes>" },
            "colors":   { "selected": "<key into colors>" }
        }
    }
}
```

Every `searchGroups` usage resolves (via `elementId`) to a `searches` element — a Trilium search
query, OR'd within a group and AND'd across groups with everything in `filterGroups`. Each `filters`
element carries its own `type` — `"search"` runs its own search query; `"dayjs"` tests a note's
`datetimeLabel` against a shared `dateRules` element's relative-date criteria (`isNull`,
`isBefore`/`isAfter`/`isBetween`/`isSame` etc against named reference points: `now`, `startOfToday`,
`endOfToday`, `endOfTomorrow`, `endOfThisWeek`, `endOfThisMonth`, `endOfThisYear`) — a filter element
is self-contained precisely so it stays meaningful wherever it's referenced, independent of any
specific profile's group. `dateRules` exists as its own registry (rather than each filter/interval
embedding its own criteria tuple) because the exact same comparison — "overdue," "later today," etc
— is typically needed by a filter *and* a prefix interval *and* a color interval simultaneously;
referencing one shared `dateRuleId` means editing what "overdue" means updates all three at once. The
selected `sorts` element's `rule` is a [libmultisort](../libmultisort@beatlink/) sort string. The
selected `prefixes`/`colors` element maps either a note label's value (`type: "label"`) or a
`matchesDayJsCriteria` match against a referenced `dateRules` element (`type: "dayjs"`, each interval
holding its own `dateRuleId`) to a prefix string / CSS color name — evaluated in `intervals`'
insertion order, first match wins.

Older installs' data note held exactly one profile's fields at the top level, with every
search/filter rule inlined directly rather than referenced — `loadData` detects that shape (no
`profiles` key) and migrates it in place, promoting every inlined rule into the appropriate registry
and rewriting the profile to hold references, the first time it's loaded after an update.

**Only one profile per `parentNoteId` is supported** — `getMatchingProfile` returns the first profile
whose `parentNoteId` matches, and `getTaskList` (and everything built on it — due notifications,
reschedule-all, iCal export) only ever processes the *first* profile in `profileContext.profileIds`,
even though `updateTaskLists` refreshes every profile listed. This mirrors the original single-profile
system this was extracted from; a real multi-profile design (along the lines of
[libsettings](../libsettings@beatlink/)'s `list` schema type) is a deliberate later decision, not
something this extraction changed.

## Usage

```js
const {
    loadData, saveData, getMatchingProfile, saveProfile, updateTaskLists, getTaskList,
    sendNotificationForDueTasks, rescheduleAllTasks, setCalendarEvents
} = require("libAgendaOverview.js")

await updateTaskLists(profileContext, constants, icalNoteId)
```

## API

### `loadData(dataNoteId)`

Parses the data note's JSON content, migrating it in place (and persisting the migration) if it's
still in the old single-profile shape. Returns the full `{searches, filters, sorts, prefixes, colors,
profiles}` document.

### `saveData(dataNoteId, data)`

Writes the full document back to the data note as JSON.

### `getMatchingProfile(profileContext, overviewNoteId)`

Returns the parsed profile object (with `id`/`dataNoteId` set) whose `parentNoteId` equals
`overviewNoteId` — used by the overview widget to find its own profile among all of them.

### `saveProfile(profile)`

Writes a (possibly edited) profile object — as returned by `getMatchingProfile`/`getAllProfiles`,
carrying its own `id`/`dataNoteId` — back into the data note's `profiles` map.

### `updateTaskLists(profileContext, constants, icalNoteId)`

For every profile: runs its searches/filters/sort/prefix/color rules, re-files the resulting notes
as children of `profile.parentNoteId`, and refreshes the iCal feed.

### `getTaskList(profileContext)`

Returns the filtered (searched + filtered, not yet sorted) note id list for the first profile only —
see the single-profile caveat above.

### `sendNotificationForDueTasks(profileContext, constants)`

Sends a desktop notification for every task in `getTaskList` whose start datetime is exactly now.

### `rescheduleAllTasks(profileContext, constants, icalNoteId, days = 0)`

Reschedules every task in `getTaskList` to `days` days from now (same day by default), then refreshes
the task lists.

### `setCalendarEvents(profileContext, constants, icalNoteId)`

Resolves `getTaskList`'s note ids to notes, builds an iCal feed via
[libCalendar.js](../libcalendar@beatlink/)'s `generateCalendar`, and writes it to `icalNoteId`.
