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
| [Agenda](addons/agenda@beatlink/) | widget | A schema-driven, multi-profile task/agenda system for TriliumNext, in three widgets plus an opinionated GTD Organize workflow, all sharing one configuration: Overview (a right-pane widget whose search/filter/sort/prefix/color rules re-file the active profile&#x27;s matching notes under a shared overview note shown as a built-in collection view, exporting an iCal feed, and the Agenda Editor page that edits the config), Task (a right-pane editor for a task&#x27;s classification, start/due dates, duration, recurrence, and quick actions), My Day (a note-detail countdown timer that files due tasks and sends notifications while your My Day note is open), and Organize (a Workflow Setup tab (in the Agenda Editor) that provisions a GTD notebook of Areas/template-buckets, plus an Organize triage UI - shown on a note you select in the Agenda Editor - that assigns each classification dimension plus a start date and fixes misfiled notes). Everything is driven by one open-ended `dimensions` registry - area and priority ship as defaults, but you can add your own; each dimension gets a Task-pane picker, a triage queue, a sort ordinal, and a derived prefix/color/grouping/filter variant. Item type is a separate axis owned by template-picker@beatlink&#x27;s own registry (a note&#x27;s ~template relation, not a dimension label) - agenda depends on it for Organize&#x27;s bucket scaffolding and its actionable-item set. Agenda&#x27;s config, including the dimensions registry, lives in one settings note (schema.json/config.json) tagged #agendaConfig; every widget discovers and reads it at runtime. | 3.1.0 |
| [Area Picker](addons/area-picker@beatlink/) | widget | A right pane dropdown widget that allows you set a note to a specific area of life | 2.5.1 |
| [Budget](addons/budget@beatlink/) | widget | Nested budget tables — apply the Budget template to any note and edit Title / Amount Budgeted / Notes rows in place, with child rows rolling up into their parents. Rollup behaviour (computed, own + children, or budget cap) is configurable, rows can be expanded and collapsed individually or all at once, columns can be shown, hidden and reordered, and budgets can be imported and exported as JSON. | 1.4.2 |
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
| [Priority Widget](addons/priority-widget@beatlink/) | widget | A right pane dropdown widget that allows you to set the priority of a note | 2.2.1 |
| [Simple Calendar](addons/simplecalendar@beatlink/) | widget | Shows a FullCalendar day/week/month view of either an external ics feed URL, or notes matching a configurable Trilium search, mapped to start/due date labels. Settings-driven, no manual note setup required. | 1.3.2 |
| [TAMTheme](addons/tamtheme@beatlink/) | theme | A full Trilium theme carrying the Trilium Addon Manager&#x27;s own white/slate/blue design language across the whole app, with a matching dark mode. | 0.1.6 |
| [Template Picker](addons/template-picker@beatlink/) | widget | A right-pane widget for assigning or changing the template of the currently active note, plus a Missing Templates page that triages every note still lacking one, and configurable search-based filters to exclude specific notes from the picker. | 1.5.1 |
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
