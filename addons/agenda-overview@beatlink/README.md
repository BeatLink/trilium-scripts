# Agenda Overview

The overview half of the [Agenda](https://github.com/BeatLink/trilium-scripts) system, and the
**owner of the shared Agenda configuration** that the separate `agenda-task@beatlink` and
`agenda-myday@beatlink` addons read.

A right-pane widget: toggle which searches/filters are active and pick the sort/prefix/color for
whichever note your profile files tasks into. Matching notes get re-filed as children of that note,
which is turned into a built-in Trilium collection view, and a calendar (iCal) feed is exported
automatically.

## What it ships

1. **Overview widget** (`agendaOverview.jsx`, right-pane) — appears only while browsing the shared
   **Overview Note**; toggles searches/filters and changes sort/prefix/color/collection-view/board
   grouping live, and (with more than one profile) switches the active profile.
2. **Agenda Editor** (`profileEditor.jsx`, a `render` page reachable from TAM's **Settings** button)
   — `libsettings@beatlink`'s `SettingsForm` rendering the whole schema: the label-name vocabulary
   (Settings tab), Profiles, Searches, Filters, Sorts, Prefixes, Colors, Groupings, Date Rules, and
   the My Day tab.
3. **The shared config** (`schema.json`/`config.json` + a `settings` anchor note) — everything
   configurable about the Agenda system. The anchor note is tagged **`#agendaConfig`** and carries
   the `schemaNote`, `icalNote`, and `AddonData:config` relations, so the Task and My Day addons
   find this one live config by label at runtime.

## Cross-addon configuration

The three Agenda widgets are three separate addons but share **one** live config. TAM's
`AddonData:` persistence is per-addon, so the widgets cannot share config through TAM relations.
Instead this addon tags its settings-anchor note `#agendaConfig`; each widget's `agendaSettings.jsx`
runs `api.searchForNotes("#agendaConfig")` on mount to resolve the same schema/config/ical note ids.
A profile or label name edited in the Agenda Editor here is therefore seen by Task and My Day with
no duplication and no drift.

Because Task and My Day both act on the profiles/searches defined here (Task re-files the overview
after an edit; My Day appends due tasks and sends notifications), **this addon must be installed for
those two to do anything** — they render nothing until a `#agendaConfig` note exists.

## Setup

1. Open the **Agenda Editor** (TAM **Settings** button, or this addon's "Agenda Editor" note).
2. On the Settings tab, point **Overview Note** at the single note the agenda is filed into and set
   the **Active Profile**. Override the label-name vocabulary here if your tasks use different label
   names (`startDateTime`, `dueDateTime`, `duration`, `recurrence`, ...).
3. On the Profiles tab, pick each profile's **Collection View** and optional **Kanban Grouping**; on
   the Searches/Filters tabs, enable/build that profile's groups.
4. Open the **Overview Note** — it becomes a collection note showing the active profile's matching
   tasks, and the Overview widget appears in the right pane to toggle searches/filters and change
   sort/prefix/color live.

See [libsettings@beatlink's README](../libsettings@beatlink/README.md) for the schema mechanics
(`registry`/`reference`/`showWhen`/nesting/`autosave`) and
[libagendaoverview@beatlink](../libagendaoverview@beatlink/README.md) for the matching/sorting logic.
