# Video Speed Controller

A port of the [Video Speed Controller](https://github.com/igrigorik/videospeed) browser extension to
Trilium. Every HTML5 video gets a small draggable overlay showing its current speed, and a set of
keyboard shortcuts to drive it:

| Key | Action |
|-----|--------|
| `S` | Slower (by the speed step) |
| `D` | Faster (by the speed step) |
| `R` | Reset to 1x — press again to go back to the speed you were at |
| `G` | Jump to your preferred speed — press again to go back |
| `Z` | Rewind |
| `X` | Advance |
| `M` | Set a marker at the current position |
| `J` | Jump back to the marker |
| `V` | Show / hide the controller |

Every binding, the speed step, the seek distances, the preferred speed, the controller's corner and
opacity, and a per-site blacklist are all in the addon's settings
(**video-speed-controller@beatlink** in the settings tree).

## Where it works

Two surfaces, each switchable in settings:

- **Web View notes** (Trilium Desktop only). Trilium renders these as a real Electron `<webview>`,
  and the controller is injected into the guest page through `executeJavaScript()` — the same thing
  the browser extension does to a tab. Shortcuts are document-wide there, as in the extension.
- **Trilium's own players**: video and audio file notes, and the players embedded in text notes.

## Setup

1. Install the addon and enable it in TAM.
2. Reload Trilium — the script reads its config once at startup, so a settings change needs a reload
   to take effect.

## Settings worth knowing

- **Remember Speed** (off by default) starts each new video at the last speed you set *on that
  site*. Off, a video keeps whatever speed the page itself chose and the controller only reports it.
- **Shortcut Scope In Trilium** decides when the bare letter keys apply inside Trilium's own
  document. The default, *only while the player is hovered or focused*, keeps `S`, `D` and friends
  out of the way of the note tree and the editor; *whenever a player is on screen* matches the
  extension's behaviour. Web View pages are always document-wide regardless.
- **Control Audio Too** (off by default) extends the controller to plain `<audio>` players.
- **Blocked Sites** takes bare hostnames and matches subdomains too, so `youtube.com` also covers
  `music.youtube.com`.

## How it works

- A `#run=frontendStartup` script reads the config, then runs the controller in Trilium's own
  document and watches the DOM for `webview.note-detail-web-view-content` elements — Trilium mounts
  and tears these down as you move between notes.
- The controller is a single closed function in `libVideoSpeedController.js`. For Trilium's own
  document it is simply called; for a guest page it is stringified and handed to
  `executeJavaScript()`, since a `<webview>` shares no scope with the renderer that embeds it. That
  is why it references nothing outside its own body.
- It tracks every `<video>`/`<audio>` in its document through a `MutationObserver`, so infinite
  feeds and single-page navigation are picked up, and follows the largest playing one with the
  overlay.
- The overlay is `position: fixed` and repositioned from the player's bounding box rather than
  wrapped around it, which keeps it clear of the page's own layout. Going fullscreen moves it into
  the fullscreen element, since nothing outside that subtree renders.
- Remembered speeds and the controller's dragged offset live in the page's own `localStorage`,
  which is per-origin — hence "the last speed used on that site".

## Known caveats

- **Web View support is desktop only.** Browser Trilium renders a sandboxed `<iframe>` instead of an
  Electron `<webview>`, which this can't reach into. Trilium's own players still work there.
- **Nested iframes are not covered.** `executeJavaScript` runs in the guest's main frame only, so a
  video inside an embedded frame (many news sites) is out of reach.
- **Key collisions with Trilium's own player.** Trilium's video note player binds `M` to mute and
  `F` to fullscreen; the default `M` here sets a marker. Rebind either one in settings if it
  bothers you.
- **DRM players ignore it.** Sites that play through a protected pipeline (Netflix and similar)
  often reset or refuse `playbackRate`; blacklist them.
- **Settings need a reload.** The config is read once at startup.
- **Backend scripting must be enabled** in Options → Security. Reading the config note goes through
  `api.runOnBackend()`, as it does for every settings-driven addon here.
