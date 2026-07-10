# ical.js

Vendored copy of ical.js, by Philipp Kewisch and contributors (Mozilla Public License 2.0 — see the
license header inside `ical.min.js` itself). Implements iCalendar (RFC 5545) parsing and generation
(`ICAL.Component`, `ICAL.Event`, `ICAL.Time`, `ICAL.Recur`, etc). Bundled here verbatim so other
addons in this repo don't each need to vendor their own copy.

This is a raw vendor dependency exposed as-is — there's no BeatLink-authored wrapper, since
consumers (e.g. an agenda/calendar-export feature) use the upstream API directly.

Note this addon is MPL-2.0 licensed (not this repo's usual GPL-3.0-or-later), matching the license
of the vendored code itself.

## Two exports, same source file

Trilium's script bundler only lets a note `require()` another note when both are the same
environment (`env=frontend` or `env=backend`) — there's no such thing as an environment-agnostic
note. So this library ships the *same* `ical.min.js` content twice, as two separate notes pointing
at the one file on disk (no source duplication, just note duplication, which is unavoidable):

| Export     | Note title               | `env`      | For                                              |
|------------|--------------------------|------------|---------------------------------------------------|
| `lib`      | `ical.min.js`            | `frontend` | frontend scripts (e.g. `libcalendar@beatlink`'s frontend variant) |
| `backend`  | `ical.min.js`            | `backend`  | backend scripts (e.g. `libcalendar@beatlink`'s backend variant)  |
| `resource` | `ical.min.js (resource)` | none       | the `custom/libIcal.js` browser-global script tag (see below)    |

Clone whichever export matches your own note's environment as a child, then `require()` it by its
literal title (kept identical to the upstream filename on both variants):

```js
const ical = require("ical.min.js")
const calendar = new ical.Component(["vcalendar", [], []])
```

## As a browser-global script tag

A third note, `resource` (`ical.min.js (resource)`), carries the `customResourceProvider: libIcal.js`
label, so it's fetchable as a plain script at `custom/libIcal.js` — useful for third-party browser
libraries (e.g. a calendar widget's iCalendar plugin) that expect a global `ICAL` to already exist
before they load, rather than an importable module. See
[libcalendarwidget@beatlink](../libcalendarwidget@beatlink/) for a real consumer of this form.

This is a *separate* note from `lib`, even though both point at the same `ical.min.js` on disk,
because the two consumption modes need incompatible MIME types. A `customResourceProvider` serves the
note's content with `Content-Type` set verbatim to the note's own MIME (Trilium's
`downloadNoteInt`/`downloadData`), and a browser refuses to execute a `<script>` whose type carries
the non-standard `;env=frontend` parameter Trilium code notes use — so the `env=frontend` `lib` note
can't double as the script resource. `resource` therefore uses a plain `application/javascript` MIME
with no `env` suffix; it is never `require()`d (a note with no `env` isn't an importable module in
either environment), only fetched over HTTP. It is wired as a local child of `lib` so it lands in
`lib`'s install closure — any consumer that already clones `lib` gets `resource` too, with no extra
wiring. The `backend` note carries no resource label — backend scripts `require()` it directly, they
never fetch a URL for it.
