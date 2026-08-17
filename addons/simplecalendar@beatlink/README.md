# Simple Calendar

A day/week/month calendar view — the modern, settings-driven replacement for the legacy `Calendar`
addon. Shows either:

- an **external ics feed URL** you paste in, or
- notes matching a **Trilium search query**, mapped to configurable start/due date (and recurrence)
  labels — generated fresh on every request, no separate file to keep in sync.

## Setup

After installing, open the addon's root note (`simplecalendar@beatlink`) to see the calendar, or use
TAM's "Settings" button to configure it:

| Field             | Description                                                        |
|-------------------|----------------------------------------------------------------------|
| `mode`            | `Trilium Search` or `External Feed URL`                             |
| `feedUrl`         | Used when mode is `External Feed URL`                                |
| `searchQuery`     | Trilium search query for notes to show (mode `Trilium Search`)       |
| `startDateLabel`  | Label holding each note's start datetime                             |
| `dueDateLabel`    | Label holding each note's due datetime                               |
| `recurrenceLabel` | Label holding an RRULE string, if any (default `recurrence`)          |

Settings are saved to a persisted note (see TAM's
[Persistence](../trilium-addon-manager@beatlink/ARCHITECTURE.md#persistence) mechanism) and provided by
[libsettings@beatlink](../libsettings@beatlink/).

## How it works

In `Trilium Search` mode, the calendar view fetches `custom/simpleCalendarFeed` — a
`customRequestHandler` endpoint (`simpleCalendarFeed.js`) that reads the current settings, searches
for matching notes, and generates a fresh ics feed on every request via
[libCalendar.js](../libcalendar@beatlink/)'s `generateCalendar`/`respondWithCalendar`. There's no
intermediate `.ical` file to keep in sync — the feed is always current as of the last fetch.

In `External Feed URL` mode, the calendar just points directly at whatever URL you configured; the
endpoint above isn't used.

The calendar grid itself is [libcalendarwidget@beatlink](../libcalendarwidget@beatlink/), a Preact
wrapper around the vendored [FullCalendar](../libfullcalendar@arshaw/).

## Relationship to the legacy `Calendar` addon

This subsumes the legacy addon's functionality with three fixes: no hardcoded
`http://127.0.0.1:PORT/...` URL (the endpoint is fetched as a relative `custom/...` path, which works
regardless of what port Trilium happens to be running on), no redundant triple-triggered regeneration
(hourly cron + require-time side effect + explicit call all firing independently), and vendored
FullCalendar/ical.js instead of runtime CDN fetches — see the calendar-addon comparison discussion in
this repo's history for the full writeup.
