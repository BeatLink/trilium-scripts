# Web Preview

Browsing toolbar for Trilium Desktop's built-in **Web View** note type. Instead of a
separate popup window, this adds a small toolbar (Back / Forward / Open in Browser /
Delete Note) directly above any note of type "Web View" — driving the actual Electron `<webview>`
element Trilium already renders for that note type.

## How it works

- A "bookmark" is just a note with **type = Web View** and a `#webViewSrc` label set to the URL.
  Trilium renders the live page inline.
- The widget finds that page's `<webview>` DOM element and calls its built-in `goBack()` /
  `goForward()` / `getURL()` / `getTitle()` methods directly — no IPC needed for navigation, since
  those methods are exposed on the element itself.
- **Open in Browser** uses the renderer's `window.electronApi.shell` bridge.
- **Clicking a link in the page** doesn't navigate the current note away. Instead it creates a new
  Web View note for the link's URL as a **child of the note you clicked from**, and opens it — so
  browsing builds a tree of the pages you visited. The link's text becomes the note title.
- **Delete Note** is the other end of that loop: it deletes the Web View note you are currently
  reading, for clearing saved links once you're done with them. It asks for confirmation first,
  and Trilium's delete is soft, so the note stays recoverable from Recent Changes. The note's
  parent is activated afterwards, since the tab would otherwise be left on a note that no longer
  exists. This deletes the *note* — it has nothing to do with `blockurl@beatlink`'s Block button,
  which acts on the page's URL instead.

## Creating a bookmark note manually

1. Create a note, set its type to **Web View** (right-click the note → "Note type", or use the type
   dropdown at the top of the note).
2. Add label `#webViewSrc` with the URL as its value.
3. Open the note — the page loads inline, and the toolbar should appear above it.

## Extension point

Another addon can add its own control to this toolbar instead of stacking a second row above the
page. Both sides share one global, created by whichever widget's module loads first:

```js
const toolbar = (window.webViewToolbar ||= { extras: [] })
toolbar.extras.push(MyControl)   // a preact component, rendered as <MyControl noteId={noteId} />
```

`toolbar.host` is set to `true` by this addon, so a registering addon can tell whether this toolbar
is installed and skip its own fallback UI when it is. `blockurl@beatlink` uses this for its
Block / Unblock button.

## Known caveats

- **Desktop only.** Browser Trilium renders a sandboxed `<iframe>` rather than an Electron
  `<webview>`, so the toolbar hides itself there.
- `getWebviewEl()` matches `webview.note-detail-web-view-content`, preferring the visible one. With
  split panes open on two Web View notes it can pick the wrong split.
- Link interception is a script injected into the page on every load, which reports clicks back
  through the guest console (`<webview>` has no preload script, and its `will-navigate` event can't
  be cancelled). It only covers real `<a href="http(s):…">` links — pages that navigate from
  JavaScript still move the current note's page as before.
- Every intercepted click creates a note, so a long browsing session leaves a long trail of child
  notes. Use **Delete Note** to prune them.
