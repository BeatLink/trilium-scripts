# Templates

A collection of note templates for tasks, projects, notes, and areas, designed to work alongside the [Agenda Next](./../Agenda%20Next/) and [Template Picker](../template-picker@beatlink/) addons.

## Templates

| Template | Icon | Purpose |
|----------|------|---------|
| 0. Ideas | `bx-bulb` | Raw, unevaluated thoughts and possibilities |
| 1. Goal | `bxs-star-half` | High-level goals and aspirations |
| 2. Routine | `bx-sync` | Recurring tasks and habits |
| 3. Task | `bx-check` | Standard single tasks |
| 4. Future | `bx-time-five` | Someday/maybe items and deferred tasks |
| 5. Project | `bx-check-double` | Multi-step projects with subtasks |
| 6. Note | `bx-notepad` | General-purpose notes |
| 7. Area | `bxs-circle` | Areas of responsibility (list view) |
| 8. Special | *(none)* | Root container template — used by the templates root note itself |

All templates carry the `#template` label so they are automatically discoverable by the [Template Picker](../template-picker@beatlink/) widget. Task-type templates (Routine, Task, Future, Project) also carry `#agendaTaskWidget` for integration with the Agenda Next task display.

## Customization

Template content is entirely up to you. After installation, open any template note and add whatever default content, structure, or labels you want new notes of that type to inherit.

Because these are user-customizable, all templates are tracked via `AddonData:` relations in the persistence tree. If you customize a template and a future addon update changes the default content, TAM will show an **Update Review** prompt so you can choose whether to keep your version or accept the new default — your edits are never silently overwritten.

## Labels Applied

Each task-type template receives these labels at install time:

| Label | Value | Purpose |
|-------|-------|---------|
| `#template` | *(empty)* | Marks the note as a Trilium template |
| `#agendaTaskWidget` | *(empty)* | Enables the Agenda Next task display widget (task-type templates only) |
| `#label:area` | `single` | Restricts the `area` label to a single value |
| `#label:priority` | `single,text` | Restricts the `priority` label (task-type templates only) |
| `#type` | `<N>-<name>` | The note's type, matching the template number (see below) |
| `#iconClass` | *(varies)* | Sets the tree icon |

Every template carries a `#type` label so Agenda Next can sort/group by type: `0-ideas`, `1-goal`,
`2-routine`, `3-task`, `4-future`, `5-project`, `6-note`, `7-area`, `8-special`. The `7. Area` template
additionally has `#viewType=list` to default new area notes to list view.

## Installation

Install via [Trilium Addon Manager](https://github.com/BeatLink/trilium-scripts/tree/main/addons/trilium-addon-manager%40beatlink) by adding `https://beatlink.github.io/trilium-scripts/catalog.json` as a catalog, or import the ZIP from [Releases](https://github.com/BeatLink/trilium-scripts/releases/latest).
