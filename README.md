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
| [Action Bar](addons/libactionbar@beatlink/) | library | Reusable Preact component rendering a row of action buttons — each supplies its own icon, text, and onClick, so this has no idea what the actions actually do for any given consumer. | 1.0.0 |
| [Agenda My Day](addons/agenda-myday@beatlink/) | widget | The &#x27;My Day&#x27; focus half of the Agenda system: a note-detail-pane widget (a manual countdown timer) that appears inline at the top of whichever note you designate as your My Day note (defaults to the shipped &#x27;My Day&#x27; note). While that note is open it also runs the optional background loops (append due tasks to the note, send due notifications). Reads the shared Agenda configuration owned by agenda-overview@beatlink (discovered at runtime by its #agendaConfig label) for the My Day note picker, flags, and the profiles/searches those loops act on; install Agenda Overview for this widget to have a configuration to read. | 1.1.0 |
| [Agenda Overview](addons/agenda-overview@beatlink/) | widget | The overview half of the Agenda system, and the owner of its shared configuration. A right-pane widget whose search/filter/sort/prefix/color rules re-file the active profile&#x27;s matching notes under a single shared overview note shown as a built-in Trilium collection view, exporting an iCal feed. Ships the schema-driven, multi-profile config (label-name vocabulary, profiles, searches/filters/sorts/prefixes/colors/groupings/date-rules) and the Agenda Editor page that edits it. Its settings-anchor note is tagged #agendaConfig so the separate Agenda Task and Agenda My Day addons discover and read the same live config. | 1.1.1 |
| [Agenda Overview](addons/libagendaoverview@beatlink/) | library | Search/filter/sort/prefix/color engine for an agenda/task-management system: resolves a profileContext ({schemaNoteId, configNoteId, profileIds}) against a libsettings@beatlink schema.json/config.json pair holding every profile plus the shared searches/filters/sorts/prefixes/colors/dateRules registries a profile references, into a filtered, sorted, re-filed list of task notes, and exports due tasks as an iCal feed. The schema note id, config note id, label-name constants, and the iCal note id are all injected by the caller rather than resolved from relations on the library&#x27;s own note. | 2.5.0 |
| [Agenda Task](addons/agenda-task@beatlink/) | widget | The task-editing half of the Agenda system: a right-pane widget for editing a task&#x27;s start/due dates, duration, recurrence, and quick actions (complete, start today/tomorrow). Appears on any note carrying the #agendaTaskWidget label. Also adds a global &#x27;Mark Done&#x27; launcher button that advances the active note to its next recurrence (or archives it when the recurrence is exhausted). Reads the shared Agenda configuration owned by agenda-overview@beatlink (discovered at runtime by its #agendaConfig label), so label names and profiles stay in sync across the Agenda addons; install Agenda Overview for this widget to have a configuration to read. | 1.3.0 |
| [Agenda Task](addons/libagendatask@beatlink/) | library | Per-task note operations for an agenda/task-management system: recurrence completion, rescheduling, and keeping derived date/time labels in sync. Label names are injected by the caller as a plain constants object rather than imported from a shared library. | 1.1.0 |
| [Area Picker](addons/area-picker@beatlink/) | widget | A right pane dropdown widget that allows you set a note to a specific area of life | 2.2.0 |
| [Calendar](addons/libcalendar@beatlink/) | library | Backend library for generating an iCalendar (RFC 5545) feed from a list of notes, and serving it as an HTTP response. The calling script resolves its own notes and wires up its own endpoint (customRequestHandler) — this library only knows how to turn notes into an ics string and how to send that string back correctly. | 1.2.2 |
| [Calendar Widget](addons/libcalendarwidget@beatlink/) | library | Reusable Preact component wrapping FullCalendar for TriliumNext widget UIs — renders a day/week/month grid from a plain events array, a raw ics string, or any ics feed URL. | 1.2.0 |
| [Cinnamon Applet Agenda](addons/cinnamon-applet-agenda@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the earliest (or latest) past-due task matched by a configurable date label. | 1.4.3 |
| [Cinnamon Applet First Child](addons/cinnamon-applet-first-child@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the first child (in Trilium sort order) of a configured parent note. | 1.1.3 |
| [Cinnamon Applet Inbox](addons/cinnamon-applet-inbox@beatlink/) | script | Backend API endpoint for the Trilium API Cinnamon panel applet — surfaces the first line of a designated inbox note, with an optional embedded countdown timer and desktop notification. | 1.5.4 |
| [Collapsible](addons/libcollapsible@beatlink/) | library | Reusable Preact collapsible section component (a styled native &lt;details&gt;/&lt;summary&gt;) for TriliumNext widget UIs. | 1.0.2 |
| [Draw.io](addons/drawio@siriusxt/) | widget | Integrates Draw.io diagram editing into TriliumNext — click any SVG note to edit it inline using the embedded Draw.io editor | 0.7.4 |
| [Email to Trilium](addons/email-to-trilium@beatlink/) | widget | Multi-account email inbox for TriliumNext. Connects to Gmail and Microsoft (Outlook) accounts over their HTTP APIs, lists recent messages in a render view, and lets you turn any email into a note (subject + HTML body + attachments) filed under a per-account target note, or delete it from the mail account. | 1.0.0 |
| [Expanded](addons/expanded@beatlink/) | widget | Keep selected notes always expanded in the note tree. Toggle &#x27;Always Expanded&#x27; from the right pane header on any note to pin it open permanently, even after restarting Trilium. The label used to mark a note is configurable in settings. | 1.2.1 |
| [Form Controls](addons/libformcontrols@beatlink/) | library | Reusable Preact form-control components for TriliumNext widget UIs: a datetime-local input, a number input, a toggle button (checkbox styled as a pill), a labeled collapsible checkbox group, and a curated color-swatch picker. Each control is exported separately so a consumer pulls in only the ones it uses. | 1.0.0 |
| [FullCalendar](addons/libfullcalendar@arshaw/) | library | Vendored FullCalendar (standard bundle + iCalendar plugin) — a browser calendar UI library, bundled as static resources for TriliumNext widgets to load as script tags. | 1.0.4 |
| [Hoist Note](addons/hoist-note@beatlink/) | widget | This script adds a launchbar button to quickly toggle the hoisting of the current note. | 1.0.2 |
| [ical.js](addons/libical@kewisch/) | library | Vendored ical.js library (iCalendar/RFC 5545 parsing and generation) bundled as a reusable TriliumNext library. | 1.3.0 |
| [IPC Library](addons/libipc@beatlink/) | library | Cross-plugin live event bus for TriliumNext frontend addons: broadcast events between addons with no shared config or persistence. | 1.0.0 |
| [Margin Top](addons/margin-top@beatlink/) | css | This simple CSS adds extra padding to any notes with the #cssClass=margin-top label. Useful for headings in the tree view. | 1.0.2 |
| [Mobile View](addons/mobile-view@beatlink/) | widget | These set of scripts allow you to use the full capabilities of the Trilium desktop interface while on a mobile device. | 0.0.4 |
| [MultiSort](addons/multisort@beatlink/) | script | Sorts note children by multiple attributes and criteria using the #multiSorted label. | 1.1.2 |
| [MultiSort Library](addons/libmultisort@beatlink/) | library | Shared library for sorting TriliumNext notes by multiple attributes and criteria. | 1.1.2 |
| [Notification Library](addons/libnotification@beatlink/) | library | Shared library for sending desktop notifications from TriliumNext scripts. | 2.0.0 |
| [Notifications](addons/notifications@beatlink/) | script | Polls for notes matching a date label and sends desktop notifications for past-due items. | 1.1.2 |
| [Priority Widget](addons/priority-widget@beatlink/) | widget | A widget to set the priority of a note | 1.0.3 |
| [Recurrence](addons/librecurrence@beatlink/) | library | Converts between an RRULE string and a plain object shaped for a recurrence-picker UI, on top of the vendored rrule.js library. | 1.3.0 |
| [rrule.js](addons/librrule@jkbrzt/) | library | Vendored rrule.js library (RFC 5545 recurrence rules) bundled as a reusable TriliumNext library. | 1.0.2 |
| [Settings Library](addons/libsettings@beatlink/) | library | Stateless, schema-driven settings engine for TriliumNext addons — merges a persisted config note with schema defaults, and can render a dynamic settings form from that same schema. | 1.17.1 |
| [Simple Calendar](addons/simplecalendar@beatlink/) | widget | Shows a FullCalendar day/week/month view of either an external ics feed URL, or notes matching a configurable Trilium search, mapped to start/due date labels. Settings-driven, no manual note setup required. | 1.1.3 |
| [Table Calculator](addons/table-calculator@beatlink/) | script | Recursively sums a numeric label across a note&#x27;s children, rolling child totals up into parent notes — useful for budget/table-style note trees. Supports multiple independent table profiles. | 1.2.3 |
| [Tabulator](addons/libtabulator@olifolkerd/) | library | Vendored Tabulator (standalone browser build + stylesheet) — an interactive data-table UI library with column show/hide and sorting, bundled as static resources for TriliumNext widgets to load as a script tag. | 6.5.2 |
| [TAMTheme](addons/tamtheme@beatlink/) | theme | A full Trilium theme carrying the Trilium Addon Manager&#x27;s own white/slate/blue design language across the whole app, with a matching dark mode. | 0.1.4 |
| [Template Picker](addons/template-picker@beatlink/) | widget | A right-pane widget for assigning or changing the template of the currently active note. | 1.0.3 |
| [Templates](addons/templates@beatlink/) | template | A set of note templates for tasks, projects, notes, and areas — designed to work with the Agenda Next and Template Picker addons. | 1.2.0 |
| [Timer](addons/libtimer@beatlink/) | library | Reusable Preact countdown timer component with optional, overridable sound effects, for TriliumNext widget UIs. | 1.0.2 |
| [ToggleNote](addons/togglenotes@beatlink/) | widget | Configurable buttons to quickly add or remove the current note as a child of one or more parent notes. Supports exclusive mode and placement in either the right pane or left pane launchbar. | 1.0.4 |
| [Trilium Addon Manager](addons/trilium-addon-manager@beatlink/) | widget | This addon allows for the easy installation, removal and updating of Trilium addons from any manifest URL or catalog. | 5.2.6 |
| [Web Preview](addons/web-preview@beatlink/) | widget | Browse-and-save toolbar for Trilium Desktop&#x27;s built-in Web View note type. Adds a small toolbar (Back / Forward / Save to Inbox / Open in Browser) above any Web View note, driving the actual Electron &lt;webview&gt; element Trilium already renders for that note type. | 1.0.0 |
| [WhiteBlueLegacy](addons/whitebluelegacy@beatlink/) | theme | Legacy WhiteBlue theme for older versions of Trilium. A white-dominant theme with light blue accents. | 1.0.2 |
| [WhiteBlueNext](addons/whitebluenext@beatlink/) | theme | This theme has a heavy emphasis on the use of white backgrounds throughout the interface for light users. Light greys and other non white colors are removed where possible. A light blue color is used as an accent for controls, headings and other areas of interest | 0.0.5 |
| [Workflow](addons/workflow@beatlink/) | widget | An opinionated GTD-style knowledgebase and task system: a single Workflow window with Collect / Organize / Review / Execute tabs, built on top of the Agenda and Templates addons. | 0.5.0 |
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
