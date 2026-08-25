# Web Preview

Browsing toolbar for Trilium Desktop's built-in **Web View** note type. Instead of a
separate popup window, this adds a small toolbar (Back / Forward / Save / Open in Browser /
Delete Note) directly above any note of type "Web View" — driving the actual Electron `<webview>`
element Trilium already renders for that note type. A **New Tab** button in the launchbar puts a
search box over whatever note you are on, so a browsing session starts from anywhere.

YouTube videos watched in a Web View note have their sponsor segments skipped, using
[SponsorBlock](https://sponsor.ajay.app)'s crowd-sourced segment database.

## New Tab

The addon registers a **New Tab** launcher in the launchbar on every start. Pressing it doesn't
navigate anywhere: it hides the content of the note you are reading and puts one box in its place,
in that split only. Pressing it again — or **Close**, or `Esc` — puts the note back.

Under the box is one list, the way an address bar's is, with the row Enter would run highlighted
at the top and the arrow keys walking the rest. It is grouped under a header apiece:

- **Address** — what you typed read as an address (`example.com`, `https://example.com/path`,
  `localhost:8080`). This group leads the list whenever it parses as one, so Enter goes straight
  there.
- **Search** — one row per configured provider, the default one first. With nothing that parses as
  an address typed, this group leads instead, which makes a search Enter's default; the other
  providers stay a couple of keystrokes away, so picking a different engine for one search needs no
  setting changed.
- **Bookmarks** — the bookmarks whose name or target contains what you typed.
- **Notes** — Web View notes you already have whose title or URL contains what you typed, so you go
  to the note rather than opening the page a second time. Title matches come before URL ones.

Nothing is listed until you type, apart from your bookmarks, which the box shows straight away —
as a grid of tiles or as a list of rows, whichever **Bookmark Layout** is set to. No row is
highlighted then, since there is nothing for Enter to do; an arrow key picks a bookmark out.

Whatever it opens becomes a new **Web View** note, so the toolbar and its link-interception
browsing tree work from there exactly as they do for a manually created bookmark note.

The note is filed as a **child of the note the box was opened over**, so a new tab continues the
tree you were already browsing, from anywhere in Trilium. A split with no note open in it has
nothing to file under, so those go to the note labelled `#inbox`. Setting **New Tab Location** to a
specific note instead collects every new tab in one place.

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
- **Bookmarks** — the places the list offers before anything is typed. Each one opens either a web
  address, which becomes a Web View note like any other new tab, or a note you already have — of
  any type, not just a Web View one. A bookmark with nothing filled in yet is left out of the list.
- **Bookmark Layout** — whether the bookmarks are a grid of tiles (the default) or a list of rows
  while nothing has been typed. Once you type, everything is a list either way.
- **Default Search Provider** — whose **Search with …** row leads the list when what you typed
  isn't an address. Every other provider keeps a row further down, so any of them can be picked for
  a single search.
- **New Tab Location** / **Specific Note** — where a new tab's Web View note is created: under
  the note the box was opened over (the default, falling back to `#inbox`), or under one note you
  name.
- **Save Button** — off by default; turning it on adds the Save button to the toolbar.
- **Save Location** — the note Save files pages under. Left empty it uses whichever note carries an
  `#inbox` label, and Save reports an error if there is none.
- **Follow Page Title** — on by default; names the Web View note after the page's own title as it
  changes, until you rename the note yourself. Turn it off to stop it naming notes entirely.
- **Reuse Existing Notes** — on by default; before making a Web View note, looks for one anywhere
  in the tree already pointing at the same URL and clones that one into the new place instead, so a
  page you've already got is a single note rather than a fresh copy.
- **User Agent** / **Custom User Agent** — what a page loaded in a Web View note is told the
  browser is. Trilium's own is sent by default. Some sites — WhatsApp Web among them — read the
  Trilium and Electron tokens it carries as an unsupported browser; the stripped option sends the
  plain Chrome string of the Chromium build Trilium already runs on, with no version numbers
  invented.
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
- **New Tab** is a `note-detail-pane` widget, so one copy of it is mounted in every split and it is
  the launcher's only job to announce itself on the window. Only the widget whose note context is
  the active one opens, and it hides the split's `.scrolling-container` for as long as it is up —
  Trilium gives a note-detail-pane widget no layer of its own to draw over the note with.
- **Matching existing notes** is done in the box: every Web View note in the tree is read once
  when the box opens, and their titles and URLs are filtered as you type, so no search runs per
  keystroke. A
  note created while the box is up won't be among them until it is next opened.
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
  page reports a new title — on navigation, or when a single-page app swaps its `<title>`. A title
  you set yourself is left alone: the addon remembers the title it last applied in a
  `#webViewAutoTitle` label, and stops renaming the note once its title no longer matches. Renaming
  the note back to that label's value (or deleting the label) hands it back to automatic naming.
- **User agent** overriding is a startup script rather than part of the toolbar, because the
  element's `useragent` attribute is only read while the guest attaches — which happens as Trilium
  inserts it, before a widget alongside it could reach it. The script watches the DOM for Web View
  elements and sets the attribute as each appears. An element that had already attached is caught
  on its `dom-ready` instead, where `setUserAgent()` plus one reload is the only way in, since that
  call reaches the guest from its next load onwards; the site's unsupported-browser page can flash
  before the reload lands. Client hints (`navigator.userAgentData`, the `Sec-CH-UA` headers) still
  describe Trilium's Chromium, which is accurate — same major version — but a site cross-checking
  the two would notice the missing Electron token.
- **Save** files the page you are currently reading as a Web View note under the Save Location,
  taking the page's own title. It is the way to keep a page you found while browsing, since the
  child notes link interception creates live inside the browsing tree and get pruned with it.
- **Duplicates** (a settings tab) finds sets of Web View notes that already point at the same URL —
  the ones made before **Reuse Existing Notes** was on. For each set you pick the note to keep and
  the rest are folded into it: their child notes and any attributes the keeper lacks move over, the
  keeper is cloned into every parent they sat under, and only then are they deleted, so no note or
  placement is lost. Skip leaves a set alone.
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
- **A changed user agent needs a Trilium reload.** The startup script reads its setting once.
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
- The New Tab box hides the note's content by styling it, so a note whose editor is mid-save is
  merely out of sight rather than closed. Anything the note itself renders outside that container —
  the title row, the ribbon — stays visible behind the box.
