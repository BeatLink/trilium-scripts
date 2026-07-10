# Agenda Overview

Search/filter/sort/prefix/color engine for an agenda/task-management system. All of a caller's
searches, filters, sorts, prefixes, colors, and date rules live as named, reusable "elements" in
[libsettings@beatlink](../libsettings@beatlink/) `registry` fields declared in the caller's own
`schema.json`, and each "profile" (also a `registry`, so multiple profiles are supported) only
stores references into those registries — this library resolves a profile into a final note list
and re-files those notes as children of the profile's target note. Also exports due tasks as an iCal
feed.

Depends on [libagendatask@beatlink](../libagendatask@beatlink/) (rescheduling),
[libnotification@beatlink](../libnotification@beatlink/) (due-task notifications),
[libcalendar@beatlink](../libcalendar@beatlink/) (iCal generation — this used to build its own ics
string inline; that logic now lives in one place, shared with
[simplecalendar@beatlink](../simplecalendar@beatlink/)), [libmultisort@beatlink](../libmultisort@beatlink/)
(sorting), and [libsettings@beatlink](../libsettings@beatlink/) (the schema-driven settings engine
every registry/profile is declared through).

## Dependency injection

Like [libagendatask@beatlink](../libagendatask@beatlink/), this library doesn't resolve its own
relations or import a shared constants module — the caller supplies:

- **`profileContext`** — `{ schemaNoteId, configNoteId, profileIds }`. `schemaNoteId`/`configNoteId`
  are the caller's own libsettings `schema.json`/`config.json` note ids (however the caller resolves
  them — see [agenda@beatlink](../agenda@beatlink/)'s `agendaSettings.jsx`). `profileIds` is an array
  of keys into the schema's `profiles` registry.
- **`constants`** — the same label-name object described in
  [libagendatask@beatlink's README](../libagendatask@beatlink/README.md#constants-injection) (this
  library and the `libAgendaTask.js` calls it makes both read from it).
- **`icalNoteId`** — the note id of the `.ical`-mime file note to write the generated calendar feed
  to.

## Schema shape this library expects

This library doesn't own a schema — the caller's own `schema.json` declares nine top-level
`registry` fields (`searches`, `searchGroups`, `filters`, `filterGroups`, `sorts`, `prefixes`,
`colors`, `groupings`, `dateRules`) and a `profiles` registry, using libsettings' `reference`/
`showWhen`/nesting features (see [agenda@beatlink](../agenda@beatlink/)'s `schema.json` for the real,
fully-worked example this was extracted from). A few fields are decomposed in the schema for
editability and reassembled by this library's `loadData` before use, since the schema's job is to be
a good editing surface, not to match what the matching/sorting logic below actually wants:

- **A Date Rule's comparison** — the schema stores `operator`/`moment1`/`moment2`/`bracket` (plain
  dropdowns, via `showWhen`) instead of a raw `["isBefore", "startOfToday"]`-style tuple.
  `matchesDayJsCriteria` still only ever sees the reassembled tuple.
- **A Sort's rule** — the schema stores a `criteria` list (`attribute`/`desc`/`caseInsensitive` rows)
  instead of a [libmultisort](../libmultisort@beatlink/) DSL string (`"priority:desc;startDateTime"`).
  `sortNoteIds` still only ever sees the reassembled string.
- **A label-value prefix/color variant's `children`** — the schema stores it as a `registry`
  (itemSchema `labelValue`+`display`, since a `registry`'s own key is opaque bookkeeping, never the
  meaningful label value) instead of a flat `{labelValue: display}` map. `getPrefixes`/`getColors`
  still only ever see the reassembled flat map.
- **A grouping variant's `children`/`intervals`** — shaped like a prefix/color variant (`type:
  "label"|"dayjs"`), but each child/interval also carries a `color` alongside `display` (a kanban
  column needs both at once, unlike prefixes/colors, which are edited as two separate registries).
  `getGroups`/`getGroupColumns` work off the same reassembled shape `reshapeGrouping` produces — for
  `type:"label"`, `{labelValue: {display, color}}`; for `type:"dayjs"`, `intervals` kept keyed by
  their own registry id, since that key doubles as the interval's group key.
- **A profile's sort/prefix/color pick** — the schema stores `sortSelected`/`prefixSelected`/
  `colorSelected` (plain `reference` fields) on the profile itself — reassembled into the
  `{selected: ...}` shape the matching logic already expected before this library moved onto
  libsettings.
- **A profile's search/filter groups** — `searchGroups`/`filterGroups` are *not* nested inside
  `profiles` (each is its own top-level registry, shown on the Searches/Filters tab respectively,
  right next to the `searches`/`filters` library it references — not buried inside a Profiles tab, so
  a group's own elements stay reachable from the same tab that defines them). Each group entry
  instead carries a `profileId` (a `reference` → `profiles`) saying which profile it belongs to.
  `groupsForProfile` filters a registry down to one profile's own groups and reshapes into the
  `{groupId: {name, children}}` shape `getNotesForSearchGroups`/`getFilteredNotes` already iterate;
  `mergeProfileGroups` is the inverse, used by `saveProfile` to write a profile's edited groups back
  without disturbing any other profile's groups in the same registry.

`dateRules` exists as its own registry (rather than each filter/interval embedding its own criteria)
because the exact same comparison — "overdue," "later today," etc — is typically needed by a filter
*and* a prefix interval *and* a color interval simultaneously; a `filters`/`prefixes`/`colors` entry
references one shared `dateRuleId` (a libsettings `reference` field) so editing what "overdue" means,
which note-label it tests, and whether it uses whole-day (`useNumberOfDays`) granularity updates every
place that means the same thing at once.

**Multiple profiles are supported** — `updateTaskLists` refreshes every profile in
`profileContext.profileIds`, and `getMatchingProfile` finds whichever one's `parentNoteId` matches a
given overview widget instance's target note. `getTaskList` (and everything built on it — due
notifications, reschedule-all, iCal export) still only ever processes the *first* matching profile,
by design — those are inherently single-profile-at-a-time operations (a notification/reschedule/iCal
export has to pick one task list to act on).

## Usage

```js
const {
    loadData, getMatchingProfile, saveProfile, updateTaskLists, getTaskList, getSortedTaskList,
    getGroups, getGroupColumns, setGroupForNote,
    sendNotificationForDueTasks, rescheduleAllTasks, setCalendarEvents
} = require("libAgendaOverview.js")

await updateTaskLists(profileContext, constants, icalNoteId)
```

## API

### `loadData(schemaNoteId, configNoteId)`

Reads the caller's schema-driven settings (via `libSettingsUI.jsx`'s `loadSettings`) and reassembles
the decomposed fields described above. Returns `{searches, filters, sorts, prefixes, colors,
groupings, dateRules, profiles}` in the shape the rest of this module (and this README's older
revisions) has always worked with.

### `getMatchingProfile(profileContext, overviewNoteId)`

Returns the parsed profile object (with `id`/`schemaNoteId`/`configNoteId` set) whose `parentNoteId`
equals `overviewNoteId` — used by the overview widget to find its own profile among all of them.

### `saveProfile(profile)`

Writes a (possibly edited) profile object — as returned by `getMatchingProfile`/`getAllProfiles`,
carrying its own `id`/`schemaNoteId`/`configNoteId` — back into the schema: identity fields and
`sortSelected`/`prefixSelected`/`colorSelected` land in the `profiles` registry, while
`searchGroups`/`filterGroups` are merged back into their own top-level registries via
`mergeProfileGroups` (preserving every other profile's groups untouched) before calling
`libSettingsUI.jsx`'s `saveSettings`.

### `updateTaskLists(profileContext, constants, icalNoteId)`

For every profile: runs its searches/filters/sort/prefix/color rules; if `profile.fileMode` isn't
`"virtual"`, also re-files the resulting notes as children of `profile.parentNoteId` (the default,
preserving pre-`fileMode` behavior for every existing profile). Refreshes the iCal feed
unconditionally either way, so a virtual-mode profile's calendar export still works.

### `getTaskList(profileContext)`

Returns the filtered (searched + filtered, not yet sorted) note id list for the first matching
profile only — see the single-profile-at-a-time caveat above.

### `getSortedTaskList(profileContext, profileId = null)`

Like `getTaskList`, but also runs the result through `sortNoteIds` (this exists as a separate
function rather than a change to `getTaskList` so no existing caller's behavior changes). Pass
`profileId` to pick a specific profile among `profileContext.profileIds` instead of always taking the
first match — for a caller (like a tree/kanban/calendar view page) that lets the user switch between
profiles.

### `getGroups(dateRules, groupingInfo, notesList)`

Returns `{noteId: groupKey|null}` for a `groupings` registry entry (`data.groupings[id]`, from
`loadData`) — the same matching logic as `getPrefixes`/`getColors`, but returning the raw group key
(a label value, or a dayjs interval's own registry id) rather than a resolved display string. `null`
means the note didn't match any column.

### `getGroupColumns(groupingInfo)`

Returns `[{key, display, color}]` for a `groupings` registry entry, in registry insertion order — the
ordered column definitions for rendering a kanban board's headers, independent of any note list.

### `setGroupForNote(groupingInfo, noteId, targetGroupKey)`

Writes `noteId`'s underlying label (`groupingInfo.label`) to `targetGroupKey` — the write side of a
kanban drag-and-drop. Only meaningful for `type:"label"` groupings; a no-op for `type:"dayjs"` (a
date-window column isn't a settable value — callers must disable drag entirely for those groupings
rather than relying on this silently doing nothing).

### `sendNotificationForDueTasks(profileContext, constants)`

Sends a desktop notification for every task in `getTaskList` whose start datetime is exactly now.

### `rescheduleAllTasks(profileContext, constants, icalNoteId, days = 0)`

Reschedules every task in `getTaskList` to `days` days from now (same day by default), then refreshes
the task lists.

### `setCalendarEvents(profileContext, constants, icalNoteId)`

Resolves `getTaskList`'s note ids to notes, builds an iCal feed via
[libCalendar.js](../libcalendar@beatlink/)'s `generateCalendar`, and writes it to `icalNoteId`.
