# YouTube Manager

A YouTube subscription tracker for TriliumNext, in the spirit of
[NoUTube](https://github.com/noutube): subscribe to channels, get **one feed** of everything they
upload, and keep a permanent record of what you watched.

No Google API key. No quota. No account sign-in.

## Setup

1. Install and enable the addon.
2. Open it and go to the **Subscriptions** tab.
3. Paste channel URLs or `@handles`, one per line, or import a FreeTube export.

That is the whole setup. There is no library root to choose and no key to paste, because the addon
stores its data in its own persistence tree and reads YouTube without authenticating.

## Using it

### Feed

Every recent upload across every channel you follow, newest first. Filters compose:

- **Unwatched / Watched / All**
- a **channel** dropdown
- **Hide Shorts**, on by default
- a **search box** that narrows by title as you type

Watched rows stay where they are and just recede, so marking something does not make the list jump
under the cursor. **Mark these watched** clears everything currently visible in one write, which is
the fast way to dismiss a backlog after a long gap.

Your filters, channel selection, sort direction, and the Shorts toggle are remembered in the settings
note as hidden fields, so the feed opens the way you left it. The **search box is deliberately not
remembered**: a text filter silently hiding most of your feed on load reads as data loss.

### Playing a video

Clicking a thumbnail or title opens the video **inside the widget**, in YouTube's own
`youtube-nocookie.com` iframe player, with the feed still below it. The bar underneath carries
**Mark watched** / **Mark unwatched**, **Open on YouTube**, and **Close**.

**Mark Watched When Played** in Settings marks a video watched the moment it starts. It is off by
default, because an embedded player reports nothing back about how much was actually watched, so
starting a video is the only signal available.

### Subscriptions

The channel list, with each channel's cached video count and a link to it on YouTube.
**Unsubscribe** drops the channel and its cached videos but **keeps your watched history**, so
re-subscribing later does not resurface everything you already saw.

Channels are added by pasting, one per line, any mix of:

```
https://www.youtube.com/@LinusTechTips
https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw
@veritasium
UCXuqSBlHAE6Xw-yeJA0Tunw
```

Each line is resolved on its own, so one bad entry reports itself and the rest still go in. Lines
that failed are left in the box with their error, ready to fix.

### Importing from FreeTube

**Import FreeTube (.db)** reads a FreeTube subscription export. In FreeTube: **Settings → Data
Settings**, set the subscriptions export type to **FreeTube**, then **Export Subscriptions**.

The file is newline-delimited JSON, one profile per line. **Every profile in the file contributes**,
not just the primary one, so channels you filed into a secondary profile are not silently dropped.
FreeTube's older flat format (one channel per line) is accepted too, since exports in that shape are
still in circulation.

FreeTube exports carry the channel id directly, so an import is a single write with no per-channel
lookup, however long your list is. It is additive: re-importing refreshes names and avatars and adds
what is new, and never removes a channel or touches your watched history.

OPML, NewPipe, and Google Takeout CSV are **not** supported here. Export as FreeTube.

## Refreshing, and why there is no background sync

**Refreshes only happen while the widget is open.** This is a hard constraint, not a choice:

YouTube.js is published as ESM only, with no CommonJS entry anywhere in its `exports` map. Trilium
backend scripts are CommonJS `require()`. A scheduled `#run` script *is* a backend script, so the
one thing that could run on a timer is the one thing that cannot load the library that does the
fetching.

So the feed updates two ways:

- **automatically when you open the widget**, but only once **Hours Between Automatic Refreshes**
  have actually elapsed, so reopening the note repeatedly does not hammer YouTube from one address
- **on demand** with the **Refresh** button

The tab row shows how long ago the last refresh was. A refresh fetches every channel, then commits
the whole result in **one write**, so it cannot half-apply; a channel that fails is named in the
error and the others still land.

## How your data is stored

Everything lives in **one JSON note** titled `Database` in the addon's persistence tree, so it
survives updates and can be backed up, inspected, or hand-edited.

```json
{
    "channels": {
        "UCXuqSBlHAE6Xw-yeJA0Tunw": {
            "id": "UCXuqSBlHAE6Xw-yeJA0Tunw", "name": "Linus Tech Tips",
            "handle": "@LinusTechTips", "addedAt": "2026-08-12T10:00:00.000Z"
        }
    },
    "videos": {
        "ofNcSiFpDUk": {
            "id": "ofNcSiFpDUk", "channelId": "UCXuqSBlHAE6Xw-yeJA0Tunw",
            "title": "Tech Russian Roulette", "duration": 58, "isShort": true,
            "views": 246682, "publishedAt": "2026-08-11T18:08:30.000Z"
        }
    },
    "watched": { "ofNcSiFpDUk": "2026-08-12T09:14:00.000Z" },
    "lastRefresh": "2026-08-12T09:00:00.000Z"
}
```

The three parts are not equally precious, and the addon treats them accordingly:

- **`videos` is a cache.** It is rebuilt from YouTube on every refresh, so pruning it is safe.
  Videos older than **Keep Videos For (Days)** are dropped on each refresh, which is what keeps the
  note from growing without bound.
- **`watched` is the actual data.** It is keyed by video id and **never pruned**. A video that ages
  out of the cache and later comes back is still known to be watched, so it does not reappear as
  new.
- **`channels` is your subscription list**, only ever changed by you.

A blank or malformed document is treated as empty rather than crashing the widget.

Since videos are JSON entries rather than notes, they are not individually linkable or cloneable,
and Trilium collection views cannot browse them. The widget is the UI.

## How it works

### YouTube.js, in the frontend, through a proxy

Channel data comes from [YouTube.js](https://github.com/LuanRT/YouTube.js), which speaks YouTube's
private InnerTube API. That is what removes the API key and the quota.

It runs **entirely in the frontend**, for the reason above: there is no CommonJS build, so the
backend cannot load it. Running in the browser costs a proxy, because YouTube's endpoints send no
CORS headers and upstream's instruction is to *"proxy requests through your own server"*.

Trilium's backend is that server. A `customRequestHandler` note forwards each request, which makes
every call same-origin from the widget's point of view, so no CORS headers are involved at all.

**The proxy is deliberately narrow.** It forwards only to `youtube.com`, `youtubei.googleapis.com`,
`ytimg.com`, and `ggpht.com`, matched as an exact host or a dot-suffix so `evil-youtube.com` and
`youtube.com.attacker.net` both fail. It accepts https only, strips hop-by-hop headers along with
`host`, `origin`, `referer`, and `cookie`, and returns text rather than binary. Without that
allowlist, enabling this addon would hand anyone who can reach your Trilium a general-purpose
request forwarder into whatever your server can reach, including its loopback interface and any
private network it sits on.

The session uses `retrieve_player: false` and `generate_session_locally: true`, so it never fetches
or evaluates YouTube's JS player. That is enough for channel metadata and upload listings, and skips
the slowest part of session creation.

### Why playback is an iframe

YouTube.js can list and describe videos here but cannot *play* them. Decoding streams additionally
needs BotGuard PO-token minting (`bgutils-js`), UMP/SABR part parsing (`googlevideo`), a DASH-capable
player (`shaka-player`), and every media segment proxied through your server as binary with Range
support. Upstream's own browser example does exactly that, and their docs mark it outdated.

That is a streaming stack, not a widget, so playback is handed back to YouTube's iframe embed.

### Dates are estimates

YouTube's listings give only a **relative** published time (`"3 days ago"`), never an absolute one.
The addon converts that to a timestamp on **first sight and never revises it**, which is what keeps
feed order stable: revising it on every refresh would let the same video drift as its text aged into
`"1 month ago"`.

Because the underlying value is an estimate, the feed shows an **age** (`"3 days ago"`) rather than a
date. A precise-looking date would overstate what is actually known.

## Settings

| Setting | What it does |
|---|---|
| **Videos Per Channel** | Uploads pulled from each channel per refresh. Higher values follow more continuations, so refreshes take longer. |
| **Keep Videos For (Days)** | Cache retention. `0` keeps everything. Never affects watched history. |
| **Hours Between Automatic Refreshes** | Minimum gap before opening the widget triggers a refresh. `0` means Refresh-button only. |
| **Mark Watched When Played** | Mark a video watched as soon as it starts. Off by default. |
| **Hide Shorts** | Also toggled on the Feed tab. |

## Known caveats

- **No background sync.** Covered above: it is not possible with a frontend-only library.
- **Shorts detection is a heuristic.** YouTube's Videos tab already excludes Shorts, so this only
  catches the ones that leak into a listing, by duration. YouTube has allowed Shorts up to three
  minutes since 2024, so a longer Short reads as a normal video.
- **View counts can be approximate.** YouTube sometimes returns an abbreviated count (`"1.2M
  views"`), which is expanded back to a round number rather than an exact one.
- **YouTube.js is a reverse-engineered client** against a private API. YouTube changes response
  shapes without notice; a break is fixed by bumping the vendored bundle in
  [`libs/libyoutubei/`](../../libs/libyoutubei/), not by patching this addon.
- **The vendored bundle is 1.5 MB**, which is a large code note. It is the browser bundle exactly as
  npm publishes it, kept unminified so it stays auditable against the registry.
- Refreshing many channels makes one request per channel from a single address. Keep **Hours Between
  Automatic Refreshes** reasonable if you follow a lot of channels.
