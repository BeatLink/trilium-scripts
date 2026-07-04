# Cinnamon Applet Inbox

Backend API endpoint for the [Trilium API Cinnamon panel applet](https://cinnamon-spices.linuxmint.com/applets). Surfaces the first line of a designated "inbox" note so it can be shown in the Cinnamon panel and clicked to jump straight to it.

## Setup

After installing:

1. Open **Trilium Addon Manager → Addon Data → cinnamon-applet-inbox@beatlink → config.json** and set `apiKey` to a random string you choose. This is a persisted note (see TAM's [Persistence](../trilium-addon-manager@beatlink/README.md#persistence) mechanism) — your edit survives addon updates.
2. On the `cinnamon-applet-inbox.js` note, add (or point) the `inboxNote` relation at the note whose first line should be surfaced. This relation is not managed by TAM and must be set manually after every reinstall/update.

Then, in the Cinnamon panel applet's settings:
- Set the **API endpoint** to `inboxPanel` (must match the `customRequestHandler` label on `cinnamon-applet-inbox.js`)
- Set the **API key** to the same random string as the `apiKey` label
- Set the **fetch action** to `get_inbox`
- Set the **click action** to `open_inbox`

## How it works

On each poll, the endpoint reads the note pointed to by the `inboxNote` relation, strips it down to its first line of text, and returns that text with the note's ID. Clicking the panel item calls back into the endpoint with `open_inbox`, which activates that note in Trilium.
