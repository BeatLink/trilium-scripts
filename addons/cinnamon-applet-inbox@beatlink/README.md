# Cinnamon Applet Inbox

Backend API endpoint for the [Trilium API Cinnamon panel applet](https://cinnamon-spices.linuxmint.com/applets). Surfaces the first line of a designated "inbox" note so it can be shown in the Cinnamon panel and clicked to jump straight to it.

## Setup

After installing, open the addon's root note (`cinnamon-applet-inbox@beatlink`) in Trilium — it
renders a Settings screen with the following fields:

| Field         | Value                       | Description                                                     |
|---------------|------------------------------|-------------------------------------------------------------------|
| `apiKey`      | a random string you choose   | Shared secret checked against the applet's configured API key     |
| `inboxNoteId` | pick a note                  | The note whose first line should be surfaced (uses a note picker) |

Settings are saved to a persisted note (see TAM's [Persistence](../trilium-addon-manager@beatlink/README.md#persistence) mechanism) — your edits survive addon updates. The screen and the underlying schema-driven storage are provided by [libsettings@beatlink](../libsettings@beatlink/).

Then, in the Cinnamon panel applet's settings:
- Set the **API endpoint** to `inboxPanel` (must match the `customRequestHandler` label on `cinnamon-applet-inbox.js`)
- Set the **API key** to the same random string as the `apiKey` field
- Set the **fetch action** to `get_inbox`
- Set the **click action** to `open_inbox`

## How it works

On each poll, the endpoint reads the note identified by `inboxNoteId`, strips it down to its first line of text, and returns that text with the note's ID. Clicking the panel item calls back into the endpoint with `open_inbox`, which activates that note in Trilium.
