# Cinnamon Applet Inbox

Backend API endpoint for the [Trilium API Cinnamon panel applet](https://cinnamon-spices.linuxmint.com/applets). Surfaces the first line of a designated "inbox" note so it can be shown in the Cinnamon panel and clicked to jump straight to it. If that first line contains a duration token (e.g. `30m`, `2h`), it also acts as a countdown timer: the token is stripped from the displayed text, a desktop notification fires when the timer (re)starts, and the panel flashes/shows a countdown until it expires.

## Setup

After installing, open the addon's root note (`cinnamon-applet-inbox@beatlink`) in Trilium — it
renders a Settings screen with the following fields:

| Field         | Value                       | Description                                                     |
|---------------|------------------------------|-------------------------------------------------------------------|
| `apiKey`      | a random string you choose   | Shared secret checked against the applet's configured API key     |
| `inboxNoteId` | pick a note                  | The note whose first line should be surfaced (uses a note picker) |

Settings are saved to a persisted note (see TAM's [Persistence](../trilium-addon-manager@beatlink/ARCHITECTURE.md#persistence) mechanism) — your edits survive addon updates. The screen and the underlying schema-driven storage are provided by [libsettings@beatlink](../libsettings@beatlink/).

Then, in the Cinnamon panel applet's settings:
- Set the **API endpoint** to `inboxPanel` (must match the `customRequestHandler` label on `cinnamon-applet-inbox.js`)
- Set the **API key** to the same random string as the `apiKey` field
- Set the **fetch action** to `get_inbox`
- Set the **click action** to `open_inbox`

## How it works

On each poll, the endpoint reads the note identified by `inboxNoteId` and strips it down to its
first line of text. If that line contains a duration token (any combination of `\d+ms`, `\d+s`,
`\d+m`, `\d+h`, `\d+d`, e.g. `"Take out trash 30m"`), the token is parsed into a total duration,
removed from the displayed text, and a countdown timer starts:

- **No timespan found** — the panel flashes solid blue to prompt you to add one.
- **New or changed text with a timespan** — a desktop notification fires once, and the timer (re)starts from now.
- **Timer running** — the panel shows the remaining time as a suffix (`[00:04:32]`) with a slow blink.
- **Timer expired** — the panel flashes solid red.
- **Empty inbox** — the reminder is disabled and any saved timer state is cleared.

Clicking the panel item calls back into the endpoint with `open_inbox`, which activates the inbox
note in Trilium. The desktop notification itself is sent by a local `runOnFrontend` hop (the
`Notification` API only exists in the frontend).

### Known limitations

- The in-progress timer state (`text`/`start_time`) is stored as plain labels directly on the
  `cinnamon-applet-inbox.js` note, not through `libsettings`' persisted config — it's derived,
  per-poll bookkeeping rather than user configuration, so it's rebuilt automatically from the
  inbox note's current content rather than needing to survive verbatim. One consequence: since TAM
  deletes and recreates an addon's whole note tree on update, a running timer resets after you
  update this addon — harmless, it just re-arms itself on the next poll.
- The `reminder_time`/`reminder_delay`/`reminder_color`/`prefix_string` blink parameters used to
  drive the panel's flashing are fixed, not configurable.
