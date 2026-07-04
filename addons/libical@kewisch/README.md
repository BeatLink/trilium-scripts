# ical.js

Vendored copy of ical.js, by Philipp Kewisch and contributors (Mozilla Public License 2.0 — see the
license header inside `ical.min.js` itself). Implements iCalendar (RFC 5545) parsing and generation
(`ICAL.Component`, `ICAL.Event`, `ICAL.Time`, `ICAL.Recur`, etc). Bundled here verbatim so other
addons in this repo don't each need to vendor their own copy.

This is a raw vendor dependency exposed as-is — there's no BeatLink-authored wrapper, since
consumers (e.g. an agenda/calendar-export feature) use the upstream API directly.

Note this addon is MPL-2.0 licensed (not this repo's usual GPL-3.0-or-later), matching the license
of the vendored code itself.

## Usage

Install as a dependency and clone the `ical.min.js` note as a child of the script that needs it. The
note title is kept literal (matching the upstream filename) so `require()` calls already written
against it elsewhere keep working unchanged:

```js
const ical = require("ical.min.js")
const calendar = new ical.Component(["vcalendar", [], []])
```
