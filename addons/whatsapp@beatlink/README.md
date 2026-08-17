# WhatsApp

WhatsApp Web as a note in Trilium Desktop, opened from a launchbar button.

WhatsApp refuses to run on Trilium's default user agent — Electron's, which carries `Trilium/x` and
`Electron/y` tokens next to the Chrome ones — and answers with its unsupported-browser page instead.
This addon overrides the user agent of any **Web View** note pointed at `web.whatsapp.com`, so the
page sees an ordinary Chrome.

- A **WhatsApp** note (Web View, `https://web.whatsapp.com`) plus a launchbar button for it.
- The user agent is Trilium's own with the Trilium and Electron tokens stripped, i.e. the plain
  Chrome string of the Chromium build Trilium already runs on — no version numbers invented.
- Any user agent you'd rather send can be typed into the settings page instead.

## Requirements

- **Trilium Desktop.** Browser Trilium renders a sandboxed `<iframe>` for Web View notes, which has
  no user agent of its own to override.

## Setup

1. Install and enable the addon, then reload Trilium.
2. Press the **WhatsApp** button in the launchbar and link the device from your phone.
3. Optional: open **whatsapp@beatlink** in the settings tree to send a specific user agent. Reload
   Trilium afterwards — the script reads its config once at startup.

The login stays signed in across restarts: Trilium browses Web View notes in the persistent
`persist:webview` Electron session.

## How it works

- A `#run=frontendStartup` script watches the DOM for `webview.note-detail-web-view-content`
  elements — Trilium mounts and tears these down as you move between notes — and takes an interest
  in the ones whose `src` is on `whatsapp.com`.
- It sets the `useragent` attribute on the element, which Electron reads while the guest attaches.
  Trilium creates the element with its `src` already set, so that window is usually gone by the time
  a `MutationObserver` sees the element: on `dom-ready` the script asks the guest for its
  `navigator.userAgent`, and if it isn't the override, calls `setUserAgent()` and reloads once.
  `setUserAgent()` only reaches the guest from its next load onwards, hence the reload; every later
  page in that element already reports the override, so it happens at most once per Web View.
- The launchbar button is a `note`-type launcher created through
  `api.createOrUpdateLauncher()` on every startup, pointing at the addon's WhatsApp note.

## Known caveats

- **One extra page load on first open.** WhatsApp's unsupported-browser page can flash before the
  reload lands. Nothing is submitted to it.
- **A changed user agent needs a Trilium reload.** The startup script reads its config once.
- **Only the user agent is changed.** Client hints (`navigator.userAgentData`, the `Sec-CH-UA`
  headers) still describe Trilium's Chromium, which is accurate — same major version — but a site
  cross-checking the two would notice the missing Electron token.
- **Any Web View note on `whatsapp.com` is affected**, not just the note this addon creates.
