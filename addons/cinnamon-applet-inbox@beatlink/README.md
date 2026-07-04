# Cinnamon Applet Inbox

Backend API endpoint for the [Trilium API Cinnamon panel applet](https://cinnamon-spices.linuxmint.com/applets). Surfaces the first line of a designated "inbox" note so it can be shown in the Cinnamon panel and clicked to jump straight to it.

## Setup

After installing, edit the `cinnamon-applet-inbox.js` note:

| Attribute              | Value                       | Description                                                     |
|------------------------|------------------------------|-------------------------------------------------------------------|
| `apiKey` (label)       | a random string you choose   | Shared secret checked against the applet's configured API key     |
| `inboxNote` (relation) | → your inbox note            | Points at the note whose first line should be surfaced            |

> Labels/relations are reset to their manifest defaults whenever this addon is updated through TAM — re-check them after updating.

Then, in the Cinnamon panel applet's settings:
- Set the **API endpoint** to `inboxPanel` (must match the `customRequestHandler` label on `cinnamon-applet-inbox.js`)
- Set the **API key** to the same random string as the `apiKey` label
- Set the **fetch action** to `get_inbox`
- Set the **click action** to `open_inbox`

## How it works

On each poll, the endpoint reads the note pointed to by the `inboxNote` relation, strips it down to its first line of text, and returns that text with the note's ID. Clicking the panel item calls back into the endpoint with `open_inbox`, which activates that note in Trilium.
