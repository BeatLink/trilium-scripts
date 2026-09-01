# Agenda Overview

A right-pane widget that re-files the active profile's matching notes under a single shared overview
note, shown as a built-in Trilium collection view (list / table / board), and writes the same task list
out as an iCal feed. It also owns the agenda configuration those rules live in — the **dimensions**
registry, the profiles, and the searches/filters/sorts/prefixes/colors/groupings/date-rules those
profiles reference — and the **Agenda Settings** page that edits all of it.

Self-contained: it ships no other addon's code and reads no other addon's settings note. The Task pane
([`agenda-task@beatlink`](../agenda-task@beatlink/README.md)), the My Day focus panel
([`agenda-myday@beatlink`](../agenda-myday@beatlink/README.md)) and the GTD triage page
([`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md)) are each their own addon on the
same footing, each owning its own settings note. They interoperate through note-label conventions and
the `agenda:tasksChanged` event, never through shared code or a shared config note.

## What the widget does

On every note, and on each `agenda:tasksChanged` event (broadcast by
[`agenda-task@beatlink`](../agenda-task@beatlink/README.md) after a task edit), it:

- resolves the active profile, its search, and its filters;
- sorts and prefixes the matching notes per the display elements the profile references;
- re-files them as clones under the profile's overview note, so opening that note shows the current
  list in whichever collection view is configured;
- regenerates the iCal feed note it ships (`#customResourceProvider agendaCalendar.ical`, served at
  `custom/agendaCalendar.ical`) from the same list, finding it by that label.

The widget itself offers the profile picker, the collection-view picker, and a link through to the
Agenda Settings page.

## Configuration

The config lives in one settings note holding a `schema.json`/`defaults.json`/`config.json` set. That
note is tagged **`#agendaOverviewConfig`** and resolved at runtime by `getAgendaSettings()` in
[`lib/settings.js`](lib/settings.js). The prefix/color/grouping/filter variants for each dimension are
**derived** from the registry at read time, so adding a dimension yields all four with no extra setup
and they can never drift from the vocabulary.

The Agenda Settings page groups its tabs under four workflow categories, using
[`libsettings`](../../libs/libsettings/README.md)'s category level (`_categories` + per-field
`category`):

- **Review** — Overview Note, Active Profile, Profiles, Searches, Filters (what the active profile
  shows).
- **Display Elements** — Sorts, Prefixes, Colors, Groupings, Date Rules: the reusable building blocks a
  profile references by name. Separate from Review because they're a shared library, not per-profile
  config (Date Rules in particular is the primitive Prefixes/Colors/Groupings/Filters all reference).
- **Dimensions** — the classification vocabulary the Overview groups, colours, prefixes and filters by
  (area, priority, any you add). [`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md)
  keeps its own separate registry for its triage queues; neither reads the other. Item type lives in
  [`template-picker@beatlink`](../template-picker@beatlink/README.md)'s own settings instead, as a
  note's `~template` relation rather than a dimension label.
- **Settings** — the three task label names this addon reads: start datetime, due datetime and
  recurrence. [`agenda-task@beatlink`](../agenda-task@beatlink/README.md) and
  [`agenda-myday@beatlink`](../agenda-myday@beatlink/README.md) declare their own copies of that
  vocabulary in their own config notes. Renaming a label means renaming it in each installed addon that
  reads it; in exchange none of them reads another's config note or ships another's code.

### Config migrations

Adding a new default dimension/sort/colour/etc. reaches existing installs for free — a registry's
entries in `defaults.json` are its *shipped* entry set, reconciled into every install on read/write,
so no migration is needed for additive changes. Reshaping data the user already owns (renaming a stored
key, moving a value between fields, dropping a field) is what [`lib/migrate.js`](lib/migrate.js)
handles: an ordered list of one-time transforms of the raw persisted config, gated by a
`#agendaConfigVersion` label on the settings note so each step runs exactly once per install.
`getAgendaSettings()` runs any pending steps before the first read. The shipped list is empty (nothing
to reshape yet); adding a step is push-one-entry + bump the version.

## Upgrading from 2.x

Version 3.0.0 absorbs `agenda@beatlink`, which no longer exists. That addon had become a config store
with this widget as its only consumer, and this widget could not be installed without it; the two are
now one addon that stands on its own.

**If you have `agenda@beatlink` installed, run
[`migrate-config-from-agenda.js`](migrate-config-from-agenda.js) once, manually, before updating** —
otherwise TAM's next sync deletes your config note (every profile, dimension, search, filter, sort,
prefix, colour and grouping) and creates a fresh empty one here. See that script's own header comment
for exact steps. Afterwards, update this addon and uninstall `agenda@beatlink`.

Two things change beyond the move:

- The settings note's anchor label is **`#agendaOverviewConfig`**, not `#agendaConfig`. Nothing else
  reads it, and the rename is what keeps the two anchors apart while both addons are installed
  mid-upgrade.
- `lib/settings.js`, `lib/dimensions.js` and `lib/migrate.js` are this addon's own sources now, rather
  than copies pulled out of `agenda@beatlink`'s folder by relative `sourceUrl`.

## Layout

Sources are grouped by kind, and note titles match the file names:

| Folder | Holds |
| ------ | ----- |
| `ui/` | `Overview.jsx` (the right-pane widget), `Collapsible.jsx`, `overview.css`, `Settings.jsx` (the Agenda Settings page), `settings.css` |
| `lib/` | `overview.js` (re-filing and the iCal write), `query.js` (search + filter + sort), `config.js` (the derived display elements), `settings.js` (`getAgendaSettings()`), `dimensions.js`, `migrate.js` |
| `config/` | `schema.json`, `defaults.json` |
| `static/` | `calendar.ical` — the seed body of the iCal feed note |

`agenda-organize@beatlink` ships its own `dimensions.js` reading its own config note, not a copy of
this one.

Trilium resolves an `import` / `require` by note title within the importer's subtree, not by path, so
the folders are a repo-side convention only.
