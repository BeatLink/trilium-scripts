# Calendar Widget

Reusable Preact component wrapping [FullCalendar](../libfullcalendar@arshaw/) for TriliumNext widget
UIs — a day/week/month grid, matching the legacy `Calendar` addon's `calendar.html` view but as a
proper Preact component instead of a raw HTML/CDN-script note, and with a portable, configurable
events source instead of a hardcoded `http://127.0.0.1:PORT/...` URL.

Depends on [libfullcalendar@arshaw](../libfullcalendar@arshaw/) (the vendored calendar UI) and
[libical@kewisch](../libical@kewisch/) (the `ICAL` global FullCalendar's iCalendar plugin needs) —
both consumed as static `custom/...` script resources, not `require()`'d, so this addon's manifest
only lists them as `dependencies` (to ensure they're installed) with no child cloning.

## Usage

Install as a dependency and clone the `CalendarWidget.jsx` note as a child of the JSX widget that
needs it:

```jsx
import { CalendarWidget } from "CalendarWidget.jsx"

// From any ics feed URL (including one this Trilium instance serves itself):
<CalendarWidget eventsUrl="custom/simpleCalendarFeed" />

// From a raw ics string already in hand (e.g. libCalendar.js's generateCalendar output):
<CalendarWidget icsString={icsString} />

// From a plain FullCalendar-native events array:
<CalendarWidget events={[{ title: "Meeting", start: "2026-01-01T10:00:00" }]} />
```

Pass exactly one of `events`, `icsString`, or `eventsUrl`.

## Props

| Prop           | Type   | Description                                                        |
|----------------|--------|----------------------------------------------------------------------|
| `events`       | array  | Plain FullCalendar-native event objects                              |
| `icsString`    | string | A raw ics string — wrapped as a `data:` URL and fed through FullCalendar's own iCalendar plugin, so parsing isn't reimplemented here |
| `eventsUrl`    | string | Any ics feed URL, fetched directly by FullCalendar's iCalendar plugin |
| `initialView`  | string | FullCalendar view name (default `"timeGridWeek"`)                    |
| `slotDuration` | string | FullCalendar time-slot duration (default `"00:10:00"`)                |
| `onEventClick` | function | Optional. Called with the clicked FullCalendar `Event` object (wired to FullCalendar's own `eventClick`) |

## How the vendor scripts get loaded

On mount, this component injects `<script>` tags for `custom/libIcal.js`, then
`custom/libFullCalendar.js`, then `custom/libFullCalendarICalendar.js` (in that order — the
iCalendar plugin reads the `ICAL` global at load time, and needs `FullCalendar` to already exist too)
and waits for all three before rendering the calendar. This load is deduplicated across multiple
`CalendarWidget` instances on the same page.
