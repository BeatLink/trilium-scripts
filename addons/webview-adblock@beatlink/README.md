# Web View Adblock

Ad and tracker blocking for Trilium Desktop's built-in **Web View** note type, in two layers:

- **Network** — an EasyList/EasyPrivacy filter attached to the Electron session web views browse
  in, cancelling ad and tracker requests before they leave.
- **Cosmetic** — EasyList's element-hiding rules injected into each page, collapsing the ad slots
  that remain.

The cosmetic layer is the one that beats a DNS blocker. Pi-hole and friends match on hostname, so
they only stop ads served from a *separate* domain; sponsored posts, promoted listings and anything
the site serves from its own origin arrive on the same connection as the content. Element hiding is
what catches those.

## How it works

### Network layer (`webViewAdblockNetwork.js`, `#run=backendStartup`)

On Trilium Desktop the backend runs inside the Electron **main** process, which is the only place
`session.webRequest` can be reached. The script gets there via `process.mainModule.require("electron")`
— Trilium rewrites a script bundle's own `require()` into a child-note resolver, so that is the only
route left — then registers `onBeforeRequest` on the `persist:webview` partition.

Rules are compiled from EasyList (ads) and EasyPrivacy (trackers), the same pair uBlock Origin
enables by default, plus both allowlists. About 1.4 MB is downloaded at startup and held in memory.

Matching is indexed rather than brute-forced:

- `||host^` rules go into hash sets, keyed by resource type where the rule is type-restricted.
  Lookup walks the hostname's parent domains.
- URL patterns are compiled to regexes and bucketed by their **longest literal token**. Every
  literal in an ABP pattern is required, so a URL that doesn't contain the token cannot match —
  only the buckets matching the URL's own tokens are tested. Patterns with no literal ≥ 4
  characters (about 300 of ~8,000) are tested on every request.

Measured on the real lists: ~51,000 host rules and ~8,000 patterns, compiled in ~120 ms, matching a
non-blocked request in **~0.05 ms**. The naive single-alternation approach was ~4 ms, which would
have put hundreds of milliseconds of CPU per page load into the process that also runs Trilium's
server.

### Cosmetic layer (`webViewAdblock.js`, `#run=frontendStartup`)

Watches the DOM for `webview.note-detail-web-view-content` elements, and on each `dom-ready` calls
the webview's own `insertCSS()` with the rules for that hostname. `insertCSS` only affects the
document currently loaded, hence the re-injection per navigation. Filters come from EasyList's two
cosmetic-only lists, cached in the renderer's `localStorage` and refreshed weekly; a failed refresh
falls back to the stale cache. Selectors go out in chunks of 200, so one selector the CSS parser
rejects costs a chunk rather than the whole stylesheet.

## Syncing with Firefox's uBlock Origin

Out of the box the addon uses its own EasyList/EasyPrivacy defaults. Point it at uBO instead from
the addon's settings page (TAM → Web View Adblock → Settings, **uBO Sync** tab):

1. In Firefox, open uBO's dashboard → **Settings** → **Backup to file**.
2. Put that file's full path in **uBlock Origin backup file** and save.
3. Press **Sync Now**, or leave *Re-read the backup on every start* on and restart.

What comes across:

| uBO backup field | Effect here |
|---|---|
| `selectedFilterLists` | Resolved to URLs through [uBO's own `assets.json`](https://raw.githubusercontent.com/gorhill/uBlock/master/assets/assets.json), then used **instead of** the built-in lists — both layers read them, since a full list carries network and cosmetic rules together. Hosts-file lists (Peter Lowe's) are understood too. |
| `userFilters` | Your "My filters", appended to both layers. |
| `whitelist` | Trusted sites: neither layer touches a page whose host matches. `*-scheme` entries are dropped, as they name browser-internal pages a web view never loads. |

What does **not** come across, because this addon has no equivalent: `dynamicFilteringString`,
`urlFilteringString`, `hostnameSwitchesString`, `hiddenSettings`, `userSettings`, and any
scriptlet (`##+js(…)`) or procedural-cosmetic rule in the lists.

The sync runs on the frontend, since that is where the settings live, and writes its result to a
persistent `uboConfig.json` note. The backend network layer reads that same note at its own
startup — so a fresh export reaches the cosmetic layer immediately and the network layer on the
**next** restart.

Live reading of uBO's config straight out of the Firefox profile was considered and rejected: it
lives in `storage/default/moz-extension+++<uuid>^userContextId=…/idb/*.sqlite` as
snappy-compressed structured clone, which would mean vendoring both a snappy decoder and a
Firefox structured-clone reader, against an undocumented format, for a copy that is stale while
Firefox is running.

## Requirements

- **Trilium Desktop.** Browser Trilium renders a sandboxed `<iframe>` with no `insertCSS()`, and
  has no Electron session to filter. Both layers no-op there.
- **Backend scripting enabled** (Options → Security) for the network layer, for the uBO sync
  (which reads the backup file through `process.mainModule.require("fs")`), and for any filter
  list whose host sends no `Access-Control-Allow-Origin` header. The renderer can only fetch
  CORS-permissive hosts — GitHub and uBO's uAssets mirror qualify, Peter Lowe's and Fanboy's do
  not — so the cosmetic layer retries those through the backend. Without backend scripting it
  still works, but only on lists the renderer is allowed to fetch.

## Which rules are honoured

Only rules decidable from the request itself: `||host^` hostname rules and patterns whose options
are resource types and/or `$third-party`. Rules carrying `$domain=`, `$document` or negated options
(`~third-party`, `~script`) are **skipped**, so the filter under-blocks rather than risking a broken
page. Exceptions are kept only when unconditional, since the conditional block rules they would
cancel are skipped anyway.

First- vs third-party is decided by comparing the last two labels of the request host and the top
frame's host. With no public suffix list, `a.co.uk` and `b.co.uk` read as same-party — which
under-blocks rather than over-blocks.

## Known caveats

- **No scriptlets.** uBlock Origin's hardest wins (YouTube pre-rolls, anti-adblock walls) come from
  scriptlets injected at `document_start`, before the page's own JavaScript runs. That needs a
  `preload` script, and Trilium's main process deletes `preload` on webview attach and denies the
  attach as a security violation. There is no way to reach that timing from a script.
- **`process.mainModule` is deprecated in Node.** If Trilium's desktop bundle ever moves to ESM,
  the network layer stops finding Electron and logs a failure — the cosmetic layer is unaffected.
- **`persist:webview` is hardcoded**, mirroring `WEBVIEW_SESSION_PARTITION` in Trilium's
  `shared_constants.ts`. A rename upstream silently leaves this filtering a session nothing uses.
- **Main-frame navigation is never cancelled**, so `$document`-style rules (popup and redirect
  blocking) do nothing here. A Web View note must always be able to load its own page.
- **Brief flash.** `dom-ready` fires after the document is parsed, so an ad element can be visible
  for a moment before the stylesheet lands.
- **Nested iframes are not filtered internally.** `insertCSS` applies to the guest's main frame; an
  ad iframe is still hidden if the parent page's markup around it matches a rule.
- Lists are re-downloaded on every Trilium start (network layer) rather than cached to disk.
