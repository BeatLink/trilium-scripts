# Trilium Scripts

A collection of widgets, themes, and scripts for [TriliumNext Notes](https://github.com/TriliumNext/Notes).

Browse the addon catalog: **https://beatlink.github.io/trilium-scripts/**

> ⚠️ **Work in progress.** The addon system (TAM, its manifest format, and how addons store data)
> is under active development and changing frequently. Data loss is possible. Download this to
> test and explore only — do not point it at real/production Trilium data yet.

## Installation

Install addons using [Trilium Addon Manager](./addons/trilium-addon-manager@beatlink/) by adding this repository to TAM:

```
BeatLink/trilium-scripts
```

Or download individual `.zip` files from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest) and import manually via **Trilium → Import**.

## Addons

<!-- GENERATED:START -->
| Name | Type | Description | Version |
|------|------|-------------|---------|
| [Agenda](addons/agenda@beatlink/) | widget | A complete task/agenda system: a right-pane overview widget (search/filter/sort/prefix/color rules re-file matching notes and export an iCal feed), a right-pane task-editing widget (dates/duration, recurrence, quick actions, rank), and an Electron always-on-top &#x27;Agenda Now&#x27; focus window with a countdown timer. Wires together the libagenda*/librecurrence/libcalendar/libtimer/libform*/libcollapsible libraries with settings-driven constants and a single-profile configuration. | 1.1.2 |
| [Agenda Now](addons/libagendanow@beatlink/) | library | Electron-only &#x27;focus window&#x27; actions for an agenda/task-management system: launch/focus an always-on-top popup window showing a target note, append due tasks to it as to-dos, and register its launcher widget. Note ids, window geometry, and label-name constants are all injected by the caller. | 1.0.1 |
| [Agenda Overview](addons/libagendaoverview@beatlink/) | library | Search/filter/sort/prefix/color engine for an agenda/task-management system: resolves one or more JSON &#x27;profile&#x27; notes into a filtered, sorted, re-filed list of task notes, and exports due tasks as an iCal feed. Profile note ids, label-name constants, and the iCal note id are all injected by the caller rather than resolved from relations on the library&#x27;s own note. | 1.1.1 |
| [Agenda Task](addons/libagendatask@beatlink/) | library | Per-task note operations for an agenda/task-management system: recurrence completion, rescheduling, and keeping derived date/time labels in sync. Label names are injected by the caller as a plain constants object rather than imported from a shared library. | 1.0.1 |
| [Area Picker](addons/area-picker@beatlink/) | widget | A right pane dropdown widget that allows you set a note to a specific area of life | 1.0.3 |
| [Calendar](addons/libcalendar@beatlink/) | library | Backend library for generating an iCalendar (RFC 5545) feed from a list of notes, and serving it as an HTTP response. The calling script resolves its own notes and wires up its own endpoint (customRequestHandler) — this library only knows how to turn notes into an ics string and how to send that string back correctly. | 1.2.1 |
| [Calendar Widget](addons/libcalendarwidget@beatlink/) | library | Reusable Preact component wrapping FullCalendar for TriliumNext widget UIs — renders a day/week/month grid from a plain events array, a raw ics string, or any ics feed URL. | 1.0.1 |
| [Cinnamon Applet Agenda](addons/cinnamon-applet-agenda@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the earliest (or latest) past-due task matched by a configurable date label. | 1.4.1 |
| [Cinnamon Applet First Child](addons/cinnamon-applet-first-child@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the first child (in Trilium sort order) of a configured parent note. | 1.1.1 |
| [Cinnamon Applet Inbox](addons/cinnamon-applet-inbox@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the first line of a designated inbox note, with an optional embedded countdown timer and desktop notification. | 1.5.1 |
| [Collapsible](addons/libcollapsible@beatlink/) | library | Reusable Preact collapsible section component (a styled native &lt;details&gt;/&lt;summary&gt;) for TriliumNext widget UIs. | 1.0.1 |
| [Draw.io](addons/drawio@siriusxt/) | widget | Integrates Draw.io diagram editing into TriliumNext — click any SVG note to edit it inline using the embedded Draw.io editor | 0.7.3 |
| [Expanded](addons/expanded@beatlink/) | widget | Keep selected notes always expanded in the note tree. Toggle &#x27;Always Expanded&#x27; from the right pane on any note to pin it open permanently, even after restarting Trilium. | 1.0.1 |
| [Form Checkbox Group](addons/libformcheckboxgroup@beatlink/) | library | Reusable Preact component rendering a labeled, collapsible group of checkboxes for TriliumNext widget UIs. | 1.0.1 |
| [Form Datetime](addons/libformdatetime@beatlink/) | library | Reusable Preact datetime-local input component for TriliumNext widget UIs. | 1.0.1 |
| [Form Number](addons/libformnumber@beatlink/) | library | Reusable Preact number-input component for TriliumNext widget UIs. | 1.0.1 |
| [Form Toggle Button](addons/libformtogglebutton@beatlink/) | library | Reusable Preact toggle-button component (a checkbox styled as a pill button) for TriliumNext widget UIs. | 1.0.1 |
| [FullCalendar](addons/libfullcalendar@arshaw/) | library | Vendored FullCalendar (standard bundle + iCalendar plugin) — a browser calendar UI library, bundled as static resources for TriliumNext widgets to load as script tags. | 1.0.1 |
| [Hoist Note](addons/hoist-note@beatlink/) | widget | This script adds a launchbar button to quickly toggle the hoisting of the current note. | 1.0.1 |
| [ical.js](addons/libical@kewisch/) | library | Vendored ical.js library (iCalendar/RFC 5545 parsing and generation) bundled as a reusable TriliumNext library. | 1.2.1 |
| [Margin Top](addons/margin-top@beatlink/) | css | This simple CSS adds extra padding to any notes with the #cssClass=margin-top label. Useful for headings in the tree view. | 1.0.1 |
| [Mobile View](addons/mobile-view@beatlink/) | widget | These set of scripts allow you to use the full capabilities of the Trilium desktop interface while on a mobile device. | 0.0.2 |
| [MultiSort](addons/multisort@beatlink/) | script | Sorts note children by multiple attributes and criteria using the #multiSorted label. | 1.1.1 |
| [MultiSort Library](addons/libmultisort@beatlink/) | library | Shared library for sorting TriliumNext notes by multiple attributes and criteria. | 1.1.1 |
| [Notification Library](addons/libnotification@beatlink/) | library | Shared library for sending desktop notifications from TriliumNext scripts, with both a frontend export and a backend-callable export. | 1.2.1 |
| [Notifications](addons/notifications@beatlink/) | script | Polls for notes matching a date label and sends desktop notifications for past-due items. | 1.1.1 |
| [Priority Widget](addons/priority-widget@beatlink/) | widget | A widget to set the priority of a note | 1.0.1 |
| [Recurrence](addons/librecurrence@beatlink/) | library | Converts between an RRULE string and a plain object shaped for a recurrence-picker UI, on top of the vendored rrule.js library. | 1.0.1 |
| [rrule.js](addons/librrule@jkbrzt/) | library | Vendored rrule.js library (RFC 5545 recurrence rules) bundled as a reusable TriliumNext library. | 1.0.1 |
| [Settings Library](addons/libsettings@beatlink/) | library | Stateless, schema-driven settings engine for TriliumNext addons — merges a persisted config note with schema defaults, and can render a dynamic settings form from that same schema. | 1.2.1 |
| [Simple Calendar](addons/simplecalendar@beatlink/) | widget | Shows a FullCalendar day/week/month view of either an external ics feed URL, or notes matching a configurable Trilium search, mapped to start/due date labels. Settings-driven, no manual note setup required. | 1.1.1 |
| [Table Calculator](addons/table-calculator@beatlink/) | script | Recursively sums a numeric label across a note&#x27;s children, rolling child totals up into parent notes — useful for budget/table-style note trees. Supports multiple independent table profiles. | 1.2.1 |
| [Template Picker](addons/template-picker@beatlink/) | widget | A right-pane widget for assigning or changing the template of the currently active note. | 1.0.1 |
| [Templates](addons/templates@beatlink/) | template | A set of note templates for tasks, projects, notes, and areas — designed to work with the Agenda Next and Template Picker addons. | 1.0.5 |
| [Timer](addons/libtimer@beatlink/) | library | Reusable Preact countdown timer component with optional, overridable sound effects, for TriliumNext widget UIs. | 1.0.1 |
| [ToggleNote](addons/togglenotes@beatlink/) | widget | Configurable buttons to quickly add or remove the current note as a child of one or more parent notes. Supports exclusive mode and placement in either the right pane or left pane launchbar. | 1.0.2 |
| [Trilium Addon Manager](addons/trilium-addon-manager@beatlink/) | widget | This addon allows for the easy installation, removal and updating of Trilium addons from GitHub repositories. | 2.8.1 |
| [WhiteBlueLegacy](addons/whitebluelegacy@beatlink/) | theme | Legacy WhiteBlue theme for older versions of Trilium. A white-dominant theme with light blue accents. | 1.0.1 |
| [WhiteBlueNext](addons/whitebluenext@beatlink/) | theme | This theme has a heavy emphasis on the use of white backgrounds throughout the interface for light users. Light greys and other non white colors are removed where possible. A light blue color is used as an accent for controls, headings and other areas of interest | 0.0.2 |
<!-- GENERATED:END -->

## Development

```bash
nix-shell        # enter dev shell

validate         # validate addon structure
strip            # strip noImport files
publish          # merge and zip addons
ci               # run all three in sequence

import_addon <zip>        # import a Trilium export ZIP into addons/
generate_pages            # build GitHub Pages site into docs/ and regenerate README.md
```
