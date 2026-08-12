# BlockURL

Brings [BlockURL](https://github.com/BeatLink/BlockURL) — a blocker that targets one exact URL
rather than a whole domain — to Trilium Desktop's built-in **Web View** note type. The same block
list your Firefox extension uses, applied to the pages you browse inside Trilium:

- A page you have blocked is replaced with BlockURL's block screen, with its Unblock button.
- Links and images pointing at blocked URLs are hidden on every page you browse.
- A button blocks or unblocks the page you are looking at. With
  [web-preview@beatlink](../web-preview@beatlink/) installed it joins that addon's toolbar; without
  it, this addon renders a minimal row of its own above the page.

## Requirements

- **Trilium Desktop.** Browser Trilium renders a sandboxed `<iframe>` instead of an Electron
  `<webview>`, which this can't reach into.
- **A running BlockURL sync server**, reachable from the machine running Trilium.
- **Backend scripting enabled** in Options → Security. The sync server sends no CORS headers, so a
  renderer `fetch()` to it is refused at the preflight; every request is issued from Trilium's
  backend instead, where CORS doesn't apply. (The settings page needs this too — it reads its
  config note the same way.)

## Setup

1. Install the addon, then open its settings (**blockurl@beatlink** in the settings tree).
2. Set **Sync Server URL** to your server, e.g. `http://127.0.0.1:8000`.
3. Set **API Key** if the server was started with `BLOCKURL_API_KEY`, otherwise leave it empty.
4. Reload Trilium — the enforcement script reads its config once at startup.

## How it works

- A `#run=frontendStartup` script watches the DOM for `webview.note-detail-web-view-content`
  elements — Trilium mounts and tears these down as you move between notes.
- On each `dom-ready` (and each `did-navigate-in-page`, so single-page sites like YouTube are
  rechecked when you click through to another video) it asks the sync server about the guest's
  current URL. Blocked means the guest document is replaced via `executeJavaScript()`; otherwise a
  small collector script goes in instead.
- That collector walks `<a href>` and `<img src>`, normalises each URL the way the server stores it
  (no trailing slash), and queues anything it hasn't seen. A `MutationObserver` marks the page dirty
  so infinite scroll and SPA rendering get picked up too.
- The guest can't message the embedder — Trilium's `<webview>` has no preload script and the main
  process refuses to attach one — so the host polls once a second: it drains the queue, sends it to
  `/urls/check`, and hands the blocked ones back for hiding. The block screen's Unblock button is
  read the same way, via the same poll.
- Requests go through `api.runAsyncOnBackendWithManualTransactionHandling()`, so the `fetch` runs in
  the Trilium server's Node process rather than the renderer.
- The Block button registers itself on `window.webViewToolbar.extras`, web-preview's extension
  point, and is rendered by that toolbar when it is present. Whichever of the two widgets loads
  first creates the shared object, and `toolbar.host` is only read at render time, so the two
  addons work in either load order and either one alone.

## Known caveats

- **Cosmetic, not network-level.** A hidden link's thumbnail has already been fetched, and a blocked
  page is replaced only after it has loaded — its scripts keep running underneath. This mirrors what
  the Firefox extension does; it isn't a request blocker.
- **Up to a second of latency.** Links are hidden on the next poll, not the instant they render, so
  a blocked thumbnail can flash briefly. Raising the poll rate costs a round trip per webview per
  tick.
- **Unreachable server stops enforcement.** If a poll throws (server down, wrong API key), that
  webview's loop stops rather than repeating the failure every second. Reopen the note to retry.
- **Nested iframes are not filtered.** `executeJavaScript` runs in the guest's main frame only.
- **Desktop only.** In browser Trilium the widget and the script both find no `<webview>` and do
  nothing.
