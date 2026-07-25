# Trilium Scripts

A collection of widgets, themes, and scripts for [TriliumNext Notes](https://github.com/TriliumNext/Notes).

Browse the addon catalog: **https://beatlink.github.io/trilium-scripts/**

> ⚠️ **Work in progress.** The addon system (TAM, its manifest format, and how addons store data)
> is under active development and changing frequently. Data loss is possible. Download this to
> test and explore only — do not point it at real/production Trilium data yet.

## Installation

Install addons using [Trilium Addon Manager](./addons/trilium-addon-manager@beatlink/) by adding this catalog to TAM:

```
https://beatlink.github.io/trilium-scripts/catalog.json
```

Or download individual `.zip` files from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest) and import manually via **Trilium → Import**.

## Addons

<!-- GENERATED:START -->
| Name | Type | Description | Version |
|------|------|-------------|---------|
| [Agenda](addons/agenda@beatlink/) | widget | A schema-driven, multi-profile agenda system for TriliumNext, in three widgets sharing one configuration: Overview (a right-pane widget whose search/filter/sort/prefix/color rules re-file the active profile&#x27;s matching notes under a shared overview note shown as a built-in collection view, exporting an iCal feed, and the Agenda Editor page that edits the config), Note Actions (a right-pane widget on every note with Zen Mode and Hoist Note quick actions), and My Day (a note-detail countdown timer that files due tasks and sends notifications while your My Day note is open). Everything is driven by one open-ended `dimensions` registry - area and priority ship as defaults, but you can add your own; each dimension gets a sort ordinal and a derived prefix/color/grouping/filter variant. Item type is a separate axis owned by template-picker@beatlink&#x27;s own registry (a note&#x27;s ~template relation, not a dimension label). Agenda&#x27;s config, including the dimensions registry, lives in one settings note (schema.json/config.json) tagged #agendaConfig; every widget discovers and reads it at runtime. The Task widget (a note&#x27;s start/due dates, duration, recurrence, and Complete/Reschedule actions) lives in the separate agenda-task@beatlink addon, with its own #agendaTaskConfig settings note; this addon clones in its recurrence/reschedule/label-override code so Overview and the Agenda Editor keep working whether or not Task is installed. The GTD Organize workflow (notebook provisioning + the triage page) likewise lives in the separate agenda-organize@beatlink addon, with its own #agendaOrganizeConfig settings note; it reads the dimensions registry back out of this addon&#x27;s #agendaConfig so the two never drift. | 5.0.0 |
| [Agenda Organize](addons/agenda-organize@beatlink/) | widget | The Organize workflow from agenda@beatlink, split out as its own addon: an opinionated GTD notebook scaffolder plus a triage UI. Workflow Setup provisions a notebook of Inbox / My Day / Agenda singletons and one note per Area (each with its Ideas / Goals / Routines / Projects / Future / Notes buckets) by find-or-create, adopting notes you already made by hand rather than duplicating them. The Organize page - shown on a note you pick in the Organize Editor - then walks the Inbox and Area subtrees and gives you one triage queue per classification dimension, plus a start-date queue with Morning/Noon/Evening/Night quick-times and a misfiled-notes queue that fixes notes sitting in the wrong bucket. Owns its own settings note (organizeSchema.json/organizeConfig.json) tagged #agendaOrganizeConfig - the Organize note picker and the four quick-times - independent of agenda@beatlink&#x27;s #agendaConfig. The classification `dimensions` registry deliberately stays in agenda@beatlink and is read cross-addon via #agendaConfig, because agenda&#x27;s Overview derives its prefix/color/grouping/filter variants from the same list these triage queues write to; a local copy would silently drift. Item type comes from template-picker@beatlink&#x27;s own registry (a note&#x27;s ~template relation). Both cross-addon reads degrade gracefully, so Organize&#x27;s scaffolding and start-date triage still work on their own. | 1.0.0 |
| [Agenda Task](addons/agenda-task@beatlink/) | widget | The Task widget from agenda@beatlink, split out as its own addon: a right-pane editor for a note&#x27;s start/due dates, duration, recurrence, and an Actions section with Complete Task and a Reschedule dropdown. Owns its own settings note (schema.json/config.json) tagged #agendaTaskConfig — the label-name overrides and the Reschedule dropdown&#x27;s option registry — independent of agenda@beatlink&#x27;s own #agendaConfig. Exports its recurrence picker, task-completion/reschedule library, and settings-editor panels (Reschedule Options, label overrides) so agenda@beatlink&#x27;s Overview and Agenda Editor can clone them in without a hard cross-addon dependency. | 1.0.0 |
| [Area Picker](addons/area-picker@beatlink/) | widget | A right pane dropdown widget for setting a note to a specific area of life, plus a Missing Areas page that triages every note still lacking one, and configurable search-based filters to exclude specific notes from the picker. | 3.0.1 |
| [Budget](addons/budget@beatlink/) | widget | Nested budget tables — apply the Budget template to any note and edit Title / Amount Budgeted / Notes rows in place, with child rows rolling up into their parents. Rollup behaviour (computed, own + children, or budget cap) is configurable, rows can be expanded and collapsed individually or all at once, columns can be shown, hidden and reordered, and budgets can be imported and exported as JSON. | 1.4.4 |
| [Cinnamon Applet Agenda](addons/cinnamon-applet-agenda@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the earliest (or latest) past-due task matched by a configurable date label. | 1.6.2 |
| [Cinnamon Applet First Child](addons/cinnamon-applet-first-child@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the first child (in Trilium sort order) of a configured parent note. | 1.3.2 |
| [Cinnamon Applet Inbox](addons/cinnamon-applet-inbox@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the first line of a designated inbox note, with an optional embedded countdown timer and desktop notification. | 1.7.2 |
| [Draw.io](addons/drawio@siriusxt/) | widget | Integrates Draw.io diagram editing into TriliumNext — click any SVG note to edit it inline using the embedded Draw.io editor | 0.8.2 |
| [Email to Trilium](addons/email-to-trilium@beatlink/) | widget | Multi-account email inbox for TriliumNext. Connects to Gmail and Microsoft (Outlook) accounts over their HTTP APIs, lists recent messages in a render view, and lets you turn any email into a note (subject + HTML body + attachments) filed under a per-account target note, or delete it from the mail account. | 1.2.2 |
| [Expanded](addons/expanded@beatlink/) | widget | Keep selected notes always expanded in the note tree. Toggle &#x27;Always Expanded&#x27; from the right pane header on any note to pin it open permanently, even after restarting Trilium. The label used to mark a note is configurable in settings. | 1.4.2 |
| [Hoist Note](addons/hoist-note@beatlink/) | widget | This script adds a launchbar button to quickly toggle the hoisting of the current note. | 1.0.4 |
| [Margin Top](addons/margin-top@beatlink/) | css | This simple CSS adds extra padding to any notes with the #cssClass=margin-top label. Useful for headings in the tree view. | 1.0.4 |
| [Mobile View](addons/mobile-view@beatlink/) | widget | These set of scripts allow you to use the full capabilities of the Trilium desktop interface while on a mobile device. | 0.0.6 |
| [MultiSort](addons/multisort@beatlink/) | script | Sorts note children by multiple attributes and criteria using the #multiSorted label. | 1.2.2 |
| [Notifications](addons/notifications@beatlink/) | script | Polls for notes matching a date label and sends desktop notifications for past-due items. | 1.2.2 |
| [Priority Widget](addons/priority-widget@beatlink/) | widget | A right pane dropdown widget for setting the priority of a note, plus a Missing Priorities page that triages every note still lacking one, and configurable search-based filters to exclude specific notes from the picker. | 3.0.0 |
| [Recipes](addons/recipes@beatlink/) | widget | A food and recipe database with a daily nutrition diary, built to replace Cronometer. Track foods with per-serving nutrition facts (manually entered or looked up via USDA FoodData Central and Open Food Facts), build recipes out of those foods with nutrition computed automatically per serving, and log servings eaten each day against configurable daily nutrient targets. All data is a single persisted JSON note. | 1.0.0 |
| [Simple Calendar](addons/simplecalendar@beatlink/) | widget | Shows a FullCalendar day/week/month view of either an external ics feed URL, or notes matching a configurable Trilium search, mapped to start/due date labels. Settings-driven, no manual note setup required. | 1.3.2 |
| [Stremio Sync](addons/stremio-sync@beatlink/) | widget | Syncs Stremio watch history into a Trilium note. Logs into your Stremio account, fetches your library over Stremio&#x27;s public API, and writes a table (title, type, last watched, progress, times watched) into a note you choose. | 1.0.0 |
| [TAMTheme](addons/tamtheme@beatlink/) | theme | A full Trilium theme carrying the Trilium Addon Manager&#x27;s own white/slate/blue design language across the whole app, with a matching dark mode. | 0.1.6 |
| [Template Picker](addons/template-picker@beatlink/) | widget | A right-pane widget for assigning or changing the template of the currently active note, plus a Missing Templates page that triages every note still lacking one, and configurable search-based filters to exclude specific notes from the picker. | 1.5.2 |
| [ToggleNote](addons/togglenotes@beatlink/) | widget | Configurable buttons to quickly add or remove the current note as a child of one or more parent notes. Supports exclusive mode and placement in either the right pane or left pane launchbar. | 1.1.2 |
| [Trilium Addon Manager](addons/trilium-addon-manager@beatlink/) | widget | This addon allows for the easy installation, removal and updating of Trilium addons from any manifest URL or catalog. | 6.3.0 |
| [Web Preview](addons/web-preview@beatlink/) | widget | Browse-and-save toolbar for Trilium Desktop&#x27;s built-in Web View note type. Adds a small toolbar (Back / Forward / Save to Inbox / Open in Browser) above any Web View note, driving the actual Electron &lt;webview&gt; element Trilium already renders for that note type. | 1.0.2 |
| [WhiteBlueLegacy](addons/whitebluelegacy@beatlink/) | theme | Legacy WhiteBlue theme for older versions of Trilium. A white-dominant theme with light blue accents. | 1.0.4 |
| [WhiteBlueNext](addons/whitebluenext@beatlink/) | theme | This theme has a heavy emphasis on the use of white backgrounds throughout the interface for light users. Light greys and other non white colors are removed where possible. A light blue color is used as an accent for controls, headings and other areas of interest | 0.0.6 |
<!-- GENERATED:END -->

## Development

```bash
nix-shell        # enter dev shell

validate         # validate addon structure
ci               # validate then build every addon's ZIP

zip_to_tam <zip>          # convert a Trilium export ZIP into a _tam_manifest_.json
tam_to_zip <manifest>     # convert a _tam_manifest_.json into a Trilium-importable ZIP
generate_pages            # build GitHub Pages site into docs/ (incl. catalog.json)
generate_readme           # regenerate README.md's addon table from manifests
```
