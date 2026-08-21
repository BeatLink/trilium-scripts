# Web Preview

Browsing toolbar for Trilium Desktop's built-in **Web View** note type. Instead of a
separate popup window, this adds a small toolbar (Back / Forward / Save / Open in Browser /
Delete Note) directly above any note of type "Web View" — driving the actual Electron `<webview>`
element Trilium already renders for that note type. A **New Tab** button in the launchbar starts
a browsing session from an address or a web search.

YouTube videos watched in a Web View note have their sponsor segments skipped, using
[SponsorBlock](https://sponsor.ajay.app)'s crowd-sourced segment database.

## New Tab

The addon registers a **New Tab** launcher in the launchbar on every start. Pressing it opens the
addon's New Tab page, which is one box:

- Type an address (`example.com`, `https://example.com/path`, `localhost:8080`) and it goes straight
  there.
- Type anything else and it becomes a search on the provider selected in the dropdown beside the
  box.
- Either way the result opens as a new **Web View** note, so the toolbar and its link-interception
  browsing tree work from there exactly as they do for a manually created bookmark note.

Where that note is filed is a setting, defaulting to **the note you were on when you pressed the
button** — so a new tab continues the tree you were already browsing. Set it to a specific note
instead to collect every new tab in one place. Opening the New Tab page from the tree rather than
from the launchbar leaves no note to file under, so those land at the tree root.

## SponsorBlock

A YouTube video opened in a Web View note has its sponsor segments skipped automatically. Segments
come from [SponsorBlock](https://sponsor.ajay.app), the same crowd-sourced database the browser
extension uses.

- Which kinds of segment get skipped is a setting. Sponsor, unpaid/self promotion and interaction
  reminders are skipped by default; intros, outros, previews, non-music sections and filler
  tangents are left alone until you turn them on.
- Each skip shows a short notice in the corner of the page, which can be turned off.
- A segment is skipped once per video. Rewinding back into one plays it, so nothing stops you
  watching a part that was skipped.
- Only skippable segments are handled — SponsorBlock's "mute" and "highlight" segments need player
  controls this toolbar doesn't have.

The lookup is the privacy-preserving one: the server is asked for every video whose id starts with
the same four hex characters of its SHA-256, and the answer is narrowed down to the video actually
playing here, so SponsorBlock never learns what you are watching. It is still a request to a third
party for every video, so **Skip Sponsor Segments** turns the whole thing off.

## Settings

Open them from TAM's **Settings** button on this addon's row, or by clicking the
`web-preview@beatlink` note in the tree.

- **Search Providers** — the engines the New Tab box offers. DuckDuckGo, Google, Wikipedia and
  YouTube ship by default; add your own with a URL template where `%s` marks the query, e.g.
  `https://searx.example/search?q=%s`. Removing a shipped provider sticks — updates won't bring it
  back.
- **Default Search Provider** — which one the box starts on. The dropdown still lets you pick
  another per search.
- **New Tab Location** / **Specific Note** — where a new tab's Web View note is created.
- **Save Button** — off by default; turning it on adds the Save button to the toolbar.
- **Save Location** — the note Save files pages under. Left empty it uses whichever note carries an
  `#inbox` label, and Save reports an error if there is none.
- **Follow Page Title** — on by default; renames the Web View note to match the page's own title
  as it changes. Turn it off to keep whatever title you gave the note.
- **Skip Sponsor Segments** — on by default; the SponsorBlock skipping described above. Off, no
  request is ever made to SponsorBlock.
- **Show A Notice On Skip** — on by default; the brief notice shown in the page's corner on a skip.
- **Categories** — one switch per segment kind SponsorBlock classifies.

## How it works

- A "bookmark" is just a note with **type = Web View** and a `#webViewSrc` label set to the URL.
  Trilium renders the live page inline.
- The widget finds that page's `<webview>` DOM element and calls its built-in `goBack()` /
  `goForward()` / `getURL()` / `getTitle()` methods directly — no IPC needed for navigation, since
  those methods are exposed on the element itself.
- **Open in Browser** uses the renderer's `window.electronApi.shell` bridge.
- **SponsorBlock** runs in two halves. Trilium's frontend does the lookup, because the `<webview>`
  has no preload script and the page itself is not asked to talk to SponsorBlock. The segments are
  then pushed into a small script injected in the page, which polls the `<video>` element and seeks
  it past a segment it lands in. Segments are re-pushed on every navigation — including YouTube's
  own in-page ones — and the injected script checks the page's current video id before acting, so
  segments never bleed from one video to the next.
- **Clicking a link in the page** doesn't navigate the current note away. Instead it creates a new
  Web View note for the link's URL as a **child of the note you clicked from**, and opens it — so
  browsing builds a tree of the pages you visited. The link's text becomes the note title.
- **Follow Page Title** (a setting, on by default) renames the Web View note whenever the loaded
  page reports a new title — on navigation, or when a single-page app swaps its `<title>`. A note
  you titled yourself is renamed too, so turn it off to keep your own titles.
- **Save** files the page you are currently reading as a Web View note under the Save Location,
  taking the page's own title. It is the way to keep a page you found while browsing, since the
  child notes link interception creates live inside the browsing tree and get pruned with it.
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
- The New Tab launcher is re-registered on every start, so moving it to *Available Launchers* is
  undone the next time Trilium loads. Disable the addon in TAM to be rid of the button. Uninstalling
  leaves the button behind as a dead entry — delete it from the launchbar yourself.
