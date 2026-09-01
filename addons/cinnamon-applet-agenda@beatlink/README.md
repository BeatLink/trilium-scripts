# Cinnamon Applet Agenda

Backend API endpoint for the [Trilium API Cinnamon panel applet](https://cinnamon-spices.linuxmint.com/applets). Surfaces the earliest (or latest) past-due task matching a configurable search query, so it can be shown in the Cinnamon panel and clicked to jump straight to that note.

## Setup

After installing, open the addon's root note (`cinnamon-applet-agenda@beatlink`) in Trilium — it
renders a Settings screen with the following fields:

| Field         | Value                       | Description                                                       |
|---------------|------------------------------|--------------------------------------------------------------------|
| `apiKey`      | a random string you choose   | Shared secret checked against the applet's configured API key      |
| `searchQuery` | e.g. `#dueDate != "" AND #dueDate < TODAY+1 orderBy #dueDate` | Full Trilium search expression used to find candidate notes |
| `dateLabel`   | e.g. `dueDate`                | Name of the label your search query uses for due dates — read after the search to filter results down to the current minute |
| `taskOrder`   | `earliest` or `latest`       | Whether to surface the earliest or latest matching past-due task   |

`searchQuery` is a raw Trilium search string, so you can scope it however you like — for example,
add `~template.title="2. Routine" AND` to only surface notes using the Routine template from
[template-picker@beatlink](../template-picker@beatlink/). Whatever you write here must reference the same label
named in `dateLabel`, since that label's value is what gets checked against "now" after the search
runs.

Settings are saved to a persisted note (see TAM's [Persistence](../trilium-addon-manager@beatlink/ARCHITECTURE.md#persistence) mechanism) — your edits survive addon updates. The screen and the underlying schema-driven storage are provided by [libsettings@beatlink](../libsettings@beatlink/).

Then, in the Cinnamon panel applet's settings:
- Set the **API endpoint** to `agenda_panel` (must match the `customRequestHandler` label on `cinnamonAppletAgenda.js`)
- Set the **API key** to the same random string as the `apiKey` label
- Set the **fetch action** to `get_task`
- Set the **click action** to `open_task`

## How it works

On each poll, the endpoint runs `searchQuery` as-is, filters the results down to notes whose
`dateLabel` value is at or before the current minute, picks the earliest or latest match per
`taskOrder`, and returns its title and note ID. Clicking the panel item calls back into the endpoint
with `open_task`, which activates that note in Trilium.
