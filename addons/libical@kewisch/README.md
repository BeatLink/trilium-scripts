# ical.js

Vendored copy of ical.js, by Philipp Kewisch and contributors (Mozilla Public License 2.0 — see the
license header inside `ical.min.js` itself). Implements iCalendar (RFC 5545) parsing and generation
(`ICAL.Component`, `ICAL.Event`, `ICAL.Time`, `ICAL.Recur`, etc). Bundled here verbatim so other
addons in this repo don't each need to vendor their own copy.

This is a raw vendor dependency exposed as-is — there's no BeatLink-authored wrapper, since
consumers (e.g. an agenda/calendar-export feature) use the upstream API directly.

Note this addon is MPL-2.0 licensed (not this repo's usual GPL-3.0-or-later), matching the license
of the vendored code itself.

## Two ways to consume it

The vendored file is a UMD bundle — it works both as a CommonJS module (`require`) and as a plain
browser global (`ICAL`), so this one note serves two different use cases without duplicating the
~90KB blob:

### As a `require()`'d module (`env=hybrid`)

Install as a dependency and clone the `ical.min.js` note as a child of the script that needs it —
this works from *either* a frontend or backend script note, since ical.js itself has no
environment-specific globals. The note title is kept literal (matching the upstream filename) so
`require()` calls already written against it elsewhere keep working unchanged:

```js
const ical = require("ical.min.js")
const calendar = new ical.Component(["vcalendar", [], []])
```

### As a browser-global script tag

The same note also carries a `customResourceProvider: libIcal.js` label, so it's fetchable as a
plain script at `custom/libIcal.js` — useful for third-party browser libraries (e.g. a calendar
widget's iCalendar plugin) that expect a global `ICAL` to already exist before they load, rather
than an importable module. See [libcalendarwidget@beatlink](../libcalendarwidget@beatlink/) for a
real consumer of this second form.
