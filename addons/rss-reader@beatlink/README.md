# RSS Reader

A feed reader for TriliumNext that is also a full [FreshRSS](https://freshrss.org/) client.

Use it on its own and it fetches and parses feeds itself. Point it at a FreshRSS server and that
server becomes the source of truth: its feeds, folders, articles and read/starred state show up
here, and everything you do here goes back to it.

## Requirements

**Trilium's backend scripting has to be enabled.** A feed is a static file on someone else's origin
and sends no CORS headers, so the browser cannot read one from Trilium's origin; the addon's backend
note does the fetching. Trilium refuses to run it otherwise, and the widget says so rather than
failing quietly.

```ini
[Security]
backendScriptingEnabled=true
```

or `TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED=true`.

## Setup

### Feeds only

1. Install and enable the addon.
2. Open it, go to the **Feeds** tab, paste feed URLs one per line, and press **Add**.

That is the whole setup. There is no library root to choose, because the addon stores its data in
its own persistence tree.

### With FreshRSS

1. In FreshRSS, enable the API: **Administration -> Authentication -> Allow API access**.
2. In FreshRSS, set an **API password**: **Profile -> API password**. This is a separate password
   from your login password, and it is the one to use here.
3. In this addon's **Settings -> FreshRSS**, turn on **Sync With FreshRSS** and fill in the server
   URL (for example `https://rss.example.com`), your username, and that API password.
4. Press **Refresh**.

The API path (`/api/greader.php`) is appended for you.

## Using it

### Articles

Every article across every feed, newest first. Filters compose:

- **Unread / Starred / Read / All**
- a **feed** dropdown, grouped by folder
- a **search box** that narrows by title as you type

Read rows stay where they are and just recede, so marking one does not make the list jump under the
cursor. **Mark these read** clears everything currently visible in one write, which is the fast way
to dismiss a backlog after a long gap.

Your filter, feed selection and sort direction are remembered in the settings note as hidden fields,
so the list opens the way you left it. The **search box is deliberately not remembered**: a text
filter silently hiding most of the list on load reads as data loss.

### Reading an article

Clicking a title expands the article **in place, under its own row**, so the list keeps its shape
and the rows around it stay where they were. Clicking the same title again collapses it, and only
one article is expanded at a time.

The action bar at the top of the expanded body carries **Star**, **Mark read/unread**, **Open
original**, and **Close**, and sticks to the top while you scroll, so it is still reachable partway
down a long article.

**Mark Read When Opened** is on by default, since opening an article is a much stronger signal than
starting a video is.

### Feeds

The feed list, grouped by folder, with each feed's unread count, whether it came from FreshRSS or is
fetched locally, and its last fetch error if it has one. The folder box next to a feed moves it;
with FreshRSS on, that move happens on the server.

Feeds are added by pasting URLs, one per line:

```
https://example.com/feed.xml
https://example.org/atom
https://example.net/feed.json
```

Each line is handled on its own, so one bad entry reports itself and the rest still go in. Lines
that failed are left in the box with their error, ready to fix. There is no feed autodiscovery: the
URL has to be the feed, not the site's home page.

**Unsubscribe** drops the feed and its cached articles but **keeps your read history**, so
re-subscribing later does not resurface everything you already saw.

## How FreshRSS sync works

With **Sync With FreshRSS** on, one refresh does four things in this order:

1. **Pushes queued changes.** Everything you marked read, unread, starred or unstarred that has not
   reached the server yet goes up first, so a local change is never overwritten by the server's
   older answer for the same article.
2. **Reads the subscription list**, and replaces the FreshRSS half of the feed list with it. A feed
   unsubscribed on the server disappears here. Local feeds are untouched.
3. **Reads the unread and starred id lists**, then downloads the full text of only the articles it
   does not already hold, in batches.
4. **Reconciles state** from those two lists: what FreshRSS says is unread is unread here.

Sync is state-first rather than date-first on purpose. Asking "which articles are unread" is exact,
where asking "what changed since last time" depends on how a server timestamps a read/unread change.
The cost is two id listings per sync; the benefit is that the unread set here is exactly the unread
set there.

Marking an article read or starred **pushes immediately** rather than waiting for the next sync. The
change is written to the database and queued in the same write, so if the push fails the queue still
holds it and the next sync retries it. Bulk actions like **Mark these read** queue everything and
flush the queue once.

Subscribing and unsubscribing go to FreshRSS too. With sync on, the **Add** button reads *Subscribe
in FreshRSS*, and the subscription is read back from the server rather than assumed.

### What sync does not cover

- **Tags/labels** other than starred. FreshRSS labels are not read or written.
- **Renaming a feed.** Folders can be changed from here; names are FreshRSS's.
- **Only the first category** of a feed is used, which is all FreshRSS allows anyway.
- **Articles that are read and old** are not downloaded. Only unread and starred articles are
  fetched, plus whatever was already cached from an earlier sync, which is what keeps a first sync
  against a large account finite.

If an account has more unread (or starred) articles than one sync can list (20,000), the matching
reconciliation step is **skipped** for that refresh and the widget says so. Applying a truncated
list would mark a backlog read that was never opened, or unstar articles the server still has
starred.

## How your data is stored

Everything lives in **one JSON note** titled `Database` in the addon's persistence tree, so it
survives updates and can be backed up, inspected, or hand-edited.

```json
{
    "feeds": {
        "R12": {
            "id": "R12", "url": "https://example.com/feed.xml", "title": "Example",
            "siteUrl": "https://example.com", "folder": "News",
            "source": "freshrss", "remoteId": "feed/12", "addedAt": "2026-08-12T10:00:00.000Z"
        }
    },
    "articles": {
        "R1731234567000001": {
            "id": "R1731234567000001", "feedId": "R12", "title": "Something happened",
            "url": "https://example.com/post", "author": "", "content": "<p>...</p>",
            "publishedAt": "2026-08-11T18:08:30.000Z"
        }
    },
    "read": { "R1731234567000001": "2026-08-12T09:14:00.000Z" },
    "starred": {},
    "pending": {},
    "lastRefresh": "2026-08-12T09:00:00.000Z"
}
```

An article id carries its origin in the first character: `R<number>` came from FreshRSS, where the
number is the entry id its API expects back, and `L...` is from a feed this addon fetches itself.

The parts are not equally precious, and the addon treats them accordingly:

- **`articles` is a cache.** It is refetched, so pruning it is safe. Articles older than **Keep
  Articles For (Days)** are dropped on each refresh, which is what keeps the note from growing
  without bound. Only articles that are **read and not starred** age out: an unread article is
  exactly what the next sync would fetch straight back, so pruning one would re-download and
  re-prune it forever without ever letting you read it.
- **`read` and `starred` are the actual data.** They are keyed by article id and **never pruned**,
  so an article that ages out of the cache and later comes back is still known to be read.
- **`pending` is the outbox**, holding changes that have not reached FreshRSS yet. It is normally
  empty.
- **`feeds` is your subscription list**, changed by you or by FreshRSS.

A blank or malformed document is treated as empty rather than crashing the widget.

Since articles are JSON entries rather than notes, they are not individually linkable or cloneable,
and Trilium collection views cannot browse them. The widget is the UI.

## How it works

### Fetching, and why there is a backend note

Feeds send no CORS headers, so the widget cannot fetch one directly. The addon's backend note
forwards the request, which makes every call same-origin from the widget's point of view.

Unlike a single-service proxy this one has no host allowlist, because fetching whatever URL you
subscribed to is the entire function of a feed reader. What it does refuse is a non-`http(s)` scheme,
a response larger than 8 MB, and **private or loopback addresses** unless **Allow Private Network
Feeds** is on. The FreshRSS server you configured is always allowed whatever address it has, since a
self-hosted FreshRSS on the same LAN is the normal case.

That check is textual, so it stops the obvious cases and not a public hostname that resolves to a
private address. Anyone who can reach this endpoint is already an authenticated Trilium user on a
server with backend scripting on, which is a strictly larger capability than this proxy.

### Parsing, and why there is no background sync

**Refreshes only happen while the widget is open.** RSS, Atom and RSS 1.0 are XML, and the only XML
parser available is `DOMParser` in the browser. A scheduled `#run` script is a backend script, so the
one thing that could run on a timer is the one thing that cannot read a feed.

So the reader updates two ways:

- **automatically when you open the widget**, but only once **Hours Between Automatic Refreshes**
  have elapsed, so reopening the note repeatedly does not re-fetch every feed
- **on demand** with the **Refresh** button

RSS 2.0, Atom, RSS 1.0/RDF and JSON Feed are all read. A feed that fails is recorded on the feed
itself and shown in the feed list; the others still land.

### Article HTML is sanitized

A feed body is HTML written by someone else, and Trilium ships no content security policy, so a
`<script>` in an article would run with the app's privileges. Before anything is rendered it is
parsed and stripped of `script`, `style`, `iframe`, `object`, `embed`, `svg`, form elements and
friends, along with every `on*` handler, `style` and `srcset` attribute. Remaining `href`/`src`
values are resolved against the article URL and dropped unless they are `http`, `https`, `mailto`, or
a `data:` image. Links open externally.

## Settings

| Setting | What it does |
|---|---|
| **Sync With FreshRSS** | Turn the FreshRSS client on. Off means feeds are fetched locally. |
| **Server URL** | Where FreshRSS is. `/api/greader.php` is appended for you. |
| **Username** | Your FreshRSS username. |
| **API Password** | The API password from FreshRSS Profile, not your login password. |
| **Articles Per Sync** | How many of the newest unread and starred articles to download the text of per sync. State is still reconciled for everything. |
| **Hours Between Automatic Refreshes** | Minimum gap before opening the widget triggers a refresh. `0` means Refresh-button only. |
| **Keep Articles For (Days)** | Cache retention for read, unstarred articles. `0` keeps everything. Never affects read history, unread articles, or starred ones. |
| **Mark Read When Opened** | Mark an article read as soon as you open it. On by default. |
| **Allow Private Network Feeds** | Let feed URLs point at loopback and private addresses. Off by default. |

## Known caveats

- **The API password is stored as plain text** in the addon's config note, like every other setting
  in every libsettings-based addon. Use FreshRSS's dedicated API password, which is what it is for,
  and not your account password.
- **No background sync.** Covered above: not possible with a browser-only XML parser.
- **No feed autodiscovery.** Paste the feed URL, not the site URL.
- **No OPML import.** With FreshRSS, import there and sync. Without it, paste the URLs.
- **A feed subscribed both locally and in FreshRSS appears twice**, since nothing tries to match one
  against the other. Pick one place per feed.
- **Local feeds only see what the feed still lists.** Most feeds carry the last 10-50 entries, so
  history before the first refresh is not recoverable.
- **Feed dates are trusted as given.** A feed with wrong or missing dates sorts accordingly; an
  article with no usable date is filed at the time it was first seen.
