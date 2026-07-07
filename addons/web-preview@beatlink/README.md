# Web Preview

Browse-and-save toolbar for Trilium Desktop's built-in **Web View** note type. Instead of a
separate popup window, this adds a small toolbar (Back / Forward / Save to Inbox / Open in Browser)
directly above any note of type "Web View" — driving the actual Electron `<webview>` element
Trilium already renders for that note type.

## How it works

- A "bookmark" is just a note with **type = Web View** and a `#webViewSrc` label set to the URL.
  Trilium renders the live page inline.
- The widget finds that page's `<webview>` DOM element and calls its built-in `goBack()` /
  `goForward()` / `getURL()` / `getTitle()` methods directly — no IPC needed for navigation, since
  those methods are exposed on the element itself.
- **Save to Inbox** and **Open in Browser** do need the backend (Node/Electron access isn't
  available in the frontend script context), so they go through `api.runOnBackend()`.
- Saving creates a **new Web View note** in your Inbox (not just a plain text link) — so anything
  you save is itself immediately re-browsable with the same toolbar. You can chain: open a bookmark
  → click through to another page → save it → open that saved note later → click through again →
  save again.

## Creating a bookmark note manually

1. Create a note, set its type to **Web View** (right-click the note → "Note type", or use the type
   dropdown at the top of the note).
2. Add label `#webViewSrc` with the URL as its value.
3. Open the note — the page loads inline, and the toolbar should appear above it.

## Known caveats

- `getWebviewEl()`'s selector is a best guess — it tries
  `[data-note-id="..."] webview, .note-detail-web-view[data-note-id="..."] webview` first, then
  falls back to the first visible `<webview>` on the page. Adjust it if it doesn't find the element
  in your Trilium version.
- `saveUrlToInbox` looks for an Inbox note via a `#inbox` label first, falling back to a note titled
  "Inbox" directly under root. Edit `getInboxNoteId()` in `libWebPreview.js` if your setup differs.
