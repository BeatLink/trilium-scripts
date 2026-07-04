# Cinnamon Applet Inbox

Backend API endpoint for the [Trilium API Cinnamon panel applet](https://cinnamon-spices.linuxmint.com/applets). Surfaces the first line of a designated "inbox" note so it can be shown in the Cinnamon panel and clicked to jump straight to it.

## Setup

After installing, open **Trilium Addon Manager → Addon Data → cinnamon-applet-inbox@beatlink → config.json** and edit the fields:

| Field         | Value                       | Description                                                     |
|---------------|------------------------------|-------------------------------------------------------------------|
| `apiKey`      | a random string you choose   | Shared secret checked against the applet's configured API key     |
| `inboxNoteId` | a note ID (blank by default) | ID of the note whose first line should be surfaced                |

`config.json` is a persisted note (see TAM's [Persistence](../trilium-addon-manager@beatlink/README.md#persistence) mechanism) — your edits survive addon updates.

**To find a note's ID for `inboxNoteId`:** open the note you want to use as your inbox, then right-click its title (or open the note's context menu) and choose **Copy note ID to clipboard**. Paste that value into `inboxNoteId`.

Then, in the Cinnamon panel applet's settings:
- Set the **API endpoint** to `inboxPanel` (must match the `customRequestHandler` label on `cinnamon-applet-inbox.js`)
- Set the **API key** to the same random string as the `apiKey` field
- Set the **fetch action** to `get_inbox`
- Set the **click action** to `open_inbox`

## How it works

On each poll, the endpoint reads the note identified by `inboxNoteId`, strips it down to its first line of text, and returns that text with the note's ID. Clicking the panel item calls back into the endpoint with `open_inbox`, which activates that note in Trilium.
