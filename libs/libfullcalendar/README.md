# FullCalendar

Vendored copy of [FullCalendar](https://fullcalendar.io/)'s standard bundle (core + the iCalendar
event-source plugin), by Adam Shaw and contributors, MIT licensed. A day/week/month calendar grid
UI library, plus a plugin that lets it consume an `.ics` feed URL directly.

Unlike this repo's other vendored libraries (`librrule@jkbrzt`, `libical@kewisch`), these files are
**not** meant to be `require()`'d — FullCalendar is a browser-only UI library with no CommonJS
build, designed to be loaded as a plain `<script>` tag that sets `window.FullCalendar`. So both notes
here are exposed purely as static resources, not as importable modules; nothing clones them as a
child, and `exports` is intentionally empty. Install this addon as a dependency (just to ensure it's
present) and reference its fixed resource URLs directly:

| Resource | URL |
|---|---|
| FullCalendar core | `custom/libFullCalendar.js` |
| iCalendar plugin | `custom/libFullCalendarICalendar.js` |

Both notes use a plain `application/javascript` MIME (no `;env=frontend` suffix). A
`customResourceProvider` serves content with `Content-Type` set verbatim to the note's own MIME, and
a browser refuses to execute a `<script>` whose type carries the non-standard `env=frontend`
parameter — so these notes, which are only ever loaded as script tags and never `require()`d, must
use a clean media type.

The iCalendar plugin expects a global `ICAL` to already exist when *it* loads (it reads `ICAL` as a
plain reference at load time, not lazily) — see
[libical@kewisch](../libical@kewisch/)'s `custom/libIcal.js` resource for that, and load scripts in
this order: `libIcal.js` → `libFullCalendar.js` → `libFullCalendarICalendar.js`.

See [libcalendarwidget@beatlink](../libcalendarwidget@beatlink/) for a Preact component that handles
this loading order and wraps `FullCalendar.Calendar` for you — you likely want that instead of
loading these scripts yourself.
