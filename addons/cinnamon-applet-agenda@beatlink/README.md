# Cinnamon Applet Agenda

Backend API endpoint for the [Trilium API Cinnamon panel applet](https://cinnamon-spices.linuxmint.com/applets). Surfaces the earliest (or latest) past-due task, matched by a configurable date label, so it can be shown in the Cinnamon panel and clicked to jump straight to that note.

## Setup

After installing, open the addon's root note (`cinnamon-applet-agenda@beatlink`) in Trilium — it
renders a Settings screen with the following fields:

| Field       | Value                     | Description                                                       |
|-------------|---------------------------|--------------------------------------------------------------------|
| `apiKey`    | a random string you choose | Shared secret checked against the applet's configured API key      |
| `dateLabel` | e.g. `dueDate`             | Name of the label used to store due dates on tasks                 |
| `taskOrder` | `earliest` or `latest`     | Whether to surface the earliest or latest matching past-due task   |

Settings are saved to a persisted note (see TAM's [Persistence](../trilium-addon-manager@beatlink/README.md#persistence) mechanism) — your edits survive addon updates. The screen and the underlying schema-driven storage are provided by [libsettings@beatlink](../libsettings@beatlink/).

Then, in the Cinnamon panel applet's settings:
- Set the **API endpoint** to `agenda_panel` (must match the `customRequestHandler` label on `cinnamonAppletAgenda.js`)
- Set the **API key** to the same random string as the `apiKey` label
- Set the **fetch action** to `get_task`
- Set the **click action** to `open_task`

## How it works

On each poll, the endpoint searches for notes where `#{dateLabel}` is set to a past (or current-minute) date/time, picks the earliest or latest match per `taskOrder`, and returns its title and note ID. Clicking the panel item calls back into the endpoint with `open_task`, which activates that note in Trilium.
