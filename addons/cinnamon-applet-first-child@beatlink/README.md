# Cinnamon Applet First Child

Backend API endpoint for the [Trilium API Cinnamon panel applet](https://cinnamon-spices.linuxmint.com/applets). Surfaces the first child (in Trilium sort order) of a configured parent note, so it can be shown in the Cinnamon panel and clicked to jump straight to it. Useful for a manually-ordered "up next" queue — reorder children in Trilium and the panel follows.

## Setup

After installing, open the addon's root note (`cinnamon-applet-first-child@beatlink`) in Trilium — it
renders a Settings screen with the following fields:

| Field          | Value                       | Description                                                     |
|----------------|------------------------------|-------------------------------------------------------------------|
| `apiKey`       | a random string you choose   | Shared secret checked against the applet's configured API key     |
| `parentNoteId` | pick a note                  | The first child of this note is surfaced (uses a note picker)     |

Settings are saved to a persisted note (see TAM's [Persistence](../trilium-addon-manager@beatlink/README.md#persistence) mechanism) — your edits survive addon updates. The screen and the underlying schema-driven storage are provided by [libsettings@beatlink](../libsettings@beatlink/).

Then, in the Cinnamon panel applet's settings:
- Set the **API endpoint** to `first_child_panel` (must match the `customRequestHandler` label on `cinnamon-applet-first-child.js`)
- Set the **API key** to the same random string as the `apiKey` field
- Set the **fetch action** to `get_task`
- Set the **click action** to `open_task`

## How it works

On each poll, the endpoint reads `parentNoteId`'s children in Trilium's own sort order and returns
the first one's title and note ID (or blank text if the parent has no children). Clicking the panel
item calls back into the endpoint with `open_task`, which activates that note in Trilium.
