# Agenda Overview

A right-pane widget that re-files the active profile's matching notes under a single shared overview
note, shown as a built-in Trilium collection view (list / table / board), and writes the same task list
out as an iCal feed. It also owns the agenda configuration those rules live in — the profiles, and the
searches/filters/sorts/prefixes/colors/groupings/date-rules those profiles reference — and the
**Agenda Settings** page that edits all of it.

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
[`lib/settings.js`](lib/settings.js). Every display element is a hand-written entry: area and priority
ship as prefix, colour, grouping and filter entries in `defaults.json`, and classifying a note by them
is [`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md)'s job, out of its own separate
vocabulary. Adding a classification axis of your own means adding the entries you want it to have —
there is nothing that generates them for you, and nothing that keeps them in step with each other.

The Agenda Settings page groups its tabs under two workflow categories, using
[`libsettings`](../../libs/libsettings/README.md)'s category level (`_categories` + per-field
`category`):

- **Review** — Overview Note, Active Profile, Profiles, Searches, Filters (what the active profile
  shows), then Sorts, Prefixes, Colors, Groupings and Date Rules: the reusable building blocks a
  profile references by name (Date Rules in particular is the primitive Prefixes/Colors/Groupings/
  Filters all reference).
- **Settings** — the three task label names this addon reads: start datetime, due datetime and
  recurrence. [`agenda-task@beatlink`](../agenda-task@beatlink/README.md) and
  [`agenda-myday@beatlink`](../agenda-myday@beatlink/README.md) declare their own copies of that
  vocabulary in their own config notes. Renaming a label means renaming it in each installed addon that
  reads it; in exchange none of them reads another's config note or ships another's code.

### Config migrations

Adding a new default sort/colour/prefix/etc. reaches existing installs for free — a registry's
entries in `defaults.json` are its *shipped* entry set, reconciled into every install on read/write,
so no migration is needed for additive changes. Reshaping data the user already owns (renaming a stored
key, moving a value between fields, dropping a field) is what [`lib/migrate.js`](lib/migrate.js)
handles: an ordered list of one-time transforms of the raw persisted config, gated by a
`#agendaConfigVersion` label on the settings note so each step runs exactly once per install.
`getAgendaSettings()` runs any pending steps before the first read. The shipped list is empty (nothing
to reshape yet); adding a step is push-one-entry + bump the version.

## Upgrading from 3.x

Version 4.0.0 also merges the **Display Elements** category into **Review**, so Sorts, Prefixes,
Colors, Groupings and Date Rules are tabs on the same page as Profiles, Searches and Filters. That
part is presentation only: no setting moves, is renamed, or changes shape.

The substantive change is the removal of the `dimensions` registry, and the whole derivation layer
with it. Area and priority are no longer a vocabulary that generates a prefix, colour, grouping and
filter variant at read time; each of those is a plain hand-written entry on its own tab, shipped in
`defaults.json` and yours to edit. The **Dimensions** tab is gone.

Your existing config is carried across automatically on the first read: a
[`lib/migrate.js`](lib/migrate.js) step folds every stored dimension into the four variants, keyed by
the dimension's own id, and repoints any profile that selected a derived `dim-…` entry at the new one.
Filter groups keep each child's enabled/disabled state, which was the one part of the derivation that
was ever persisted. A dimension you added yourself comes through as four ordinary entries you can now
edit independently — and, being independent, they can now drift from each other, which is the cost of
the flatter model.

Two behaviours change that no migration can preserve:

- **Sorting by `#area` is alphabetical now.** Value order used to come from the dimension's registry
  position, fed to the sort layer as ordinal maps; with no registry there is nothing to derive an
  ordinal from, so the stored value sorts as the string it is. The shipped priority sorts are flipped
  to descending to compensate, since `#priority` stores its rank as the value's own prefix
  (`4-critical` … `1-low`).
- **The overview's Area and Priority columns are gone.** The promoted attributes on the overview note
  were generated one per dimension; the four fixed columns (Start, Due, Duration, Recurrence) stay.

## Upgrading from 2.x

Version 3.0.0 absorbs `agenda@beatlink`, which no longer exists. That addon had become a config store
with this widget as its only consumer, and this widget could not be installed without it; the two are
now one addon that stands on its own.

**If you have `agenda@beatlink` installed, run
[`migrate-config-from-agenda.js`](migrate-config-from-agenda.js) once, manually, before updating** —
otherwise TAM's next sync deletes your config note (every profile, search, filter, sort, prefix,
colour and grouping) and creates a fresh empty one here. See that script's own header comment
for exact steps. Afterwards, update this addon and uninstall `agenda@beatlink`.

Two things change beyond the move:

- The settings note's anchor label is **`#agendaOverviewConfig`**, not `#agendaConfig`. Nothing else
  reads it, and the rename is what keeps the two anchors apart while both addons are installed
  mid-upgrade.
- `lib/settings.js` and `lib/migrate.js` are this addon's own sources now, rather than copies pulled
  out of `agenda@beatlink`'s folder by relative `sourceUrl`.

## Layout

Sources are grouped by kind, and note titles match the file names:

| Folder | Holds |
| ------ | ----- |
| `ui/` | `Overview.jsx` (the right-pane widget), `Collapsible.jsx`, `overview.css`, `Settings.jsx` (the Agenda Settings page), `settings.css` |
| `lib/` | `overview.js` (re-filing and the iCal write), `query.js` (search + filter + sort), `config.js` (the display elements), `settings.js` (`getAgendaSettings()`), `migrate.js` |
| `config/` | `schema.json`, `defaults.json` |
| `static/` | `calendar.ical` — the seed body of the iCal feed note |

Trilium resolves an `import` / `require` by note title within the importer's subtree, not by path, so
the folders are a repo-side convention only.
