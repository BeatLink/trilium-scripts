# Agenda Overview

The Overview widget, split out of [`agenda@beatlink`](../agenda@beatlink/README.md): a right-pane
widget that re-files the active profile's matching notes under a single shared overview note, shown as
a built-in Trilium collection view (list / table / board), and writes the same task list out as an
iCal feed.

**Requires [`agenda@beatlink`](../agenda@beatlink/README.md).** Every value this widget reads —
profiles, searches, filters, the sort/prefix/color/grouping/date-rule library, the `dimensions`
registry, the three task label names and the overview note itself — lives in that addon's
`#agendaConfig` settings note, edited on its **Agenda Settings** page. This addon writes nothing there
beyond the active profile and the collapsed/expanded state of its own sections.

## What the widget does

On every note, and on each `agenda:tasksChanged` event (broadcast by
[`agenda-task@beatlink`](../agenda-task@beatlink/README.md) after a task edit), it:

- resolves the active profile, its search, and its filters;
- sorts and prefixes the matching notes per the display elements the profile references;
- re-files them as clones under the profile's overview note, so opening that note shows the current
  list in whichever collection view is configured;
- regenerates the iCal feed note (`#customResourceProvider agendaCalendar.ical`, served from
  `agenda@beatlink`) from the same list.

The widget itself offers the profile picker, the collection-view picker, and a link through to the
Agenda Settings page.

## Configuration

None of its own: no settings note, no `#...Config` anchor. `lib/settings.js` finds
`agenda@beatlink`'s `#agendaConfig` note at runtime and falls through to nothing when it isn't
installed, so the widget simply renders empty rather than erroring.

## Layout

Sources are grouped by kind, and note titles match the file names:

| Folder | Holds |
| ------ | ----- |
| `ui/` | `Overview.jsx` (the right-pane widget), `Collapsible.jsx`, `overview.css` |
| `lib/` | `overview.js` (re-filing and the iCal write), `query.js` (search + filter + sort), `config.js` (the derived display elements) |

`lib/` additionally carries copies of `agenda@beatlink`'s `settings.js`, `dimensions.js` and
`migrate.js`, pulled through relative `sourceUrl`s the same way
[`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md) pulls `dimensions.js`: Trilium
resolves an `import` / `require` by note title within the importing note's own subtree, so a shared
reader has to be shipped into each addon that uses it. Only the code is duplicated — the data stays in
the one `#agendaConfig` note.
