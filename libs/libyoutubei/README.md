# YouTube.js

Vendored copy of [YouTube.js](https://github.com/LuanRT/YouTube.js) (`youtubei.js`) by LuanRT and
contributors, MIT licensed. A client for YouTube's private InnerTube API, used for channel lookups,
channel upload listings, and channel search without a Google API key or a quota.

The vendored file is the **browser bundle exactly as npm publishes it**
(`youtubei.js@17.2.0/bundle/browser.js`, 1.5 MB, unminified). It is deliberately not the
CDN-minified variant: minification there is a third-party transform, and vendoring the published
artifact keeps the file auditable against the package registry.

## Why this is a resource, not a module

Like [`libfullcalendar@arshaw`](../libfullcalendar/), this file is **not** `require()`'d. Two
constraints force that:

- The package is `"type": "module"` and its `exports` map has **no CommonJS entry at all**. Trilium
  backend scripts are CommonJS `require()`, so a backend script cannot load this library under any
  configuration. Everything using it must run in the frontend.
- The bundle is ESM, so it cannot be loaded as a plain `<script>` that sets a global either. It is
  reached with a dynamic `import()` of its resource URL instead.

So the note is exposed purely as a static resource with a plain `application/javascript` MIME (no
`;env=frontend` suffix). A `customResourceProvider` serves content with `Content-Type` set verbatim
to the note's own MIME, and a browser refuses to execute a module whose type carries the
non-standard `env=frontend` parameter.

| Resource | URL |
|---|---|
| YouTube.js browser bundle | `custom/libYoutubei.js` |

Import it by resolving that path against the document base, so a Trilium served under a reverse-proxy
subpath still works. A dynamic `import()` resolves a bare relative specifier against the *module's*
own URL rather than the document's, which is why the URL is built explicitly:

```js
const url = new URL("custom/libYoutubei.js", document.baseURI).href
const { Innertube } = await import(/* @vite-ignore */ url)
```

## The browser requires a proxy

Upstream is explicit: *"To use YouTube.js in the browser, you must proxy requests through your own
server."* YouTube's InnerTube endpoints send no CORS headers, so a request straight from Trilium's
origin is blocked.

Trilium's own backend is that server. A `customRequestHandler` note forwards the request and returns
the response, which is same-origin from the widget's point of view, so no CORS headers are needed
at all. See [`youtube-manager@beatlink`](../../addons/youtube-manager@beatlink/) for a working
proxy, including the host allowlist that keeps the endpoint from being a general-purpose SSRF hole.

## What works without a proxy for streams

Session creation uses `generate_session_locally: true` and `retrieve_player: false`, which skips
fetching and evaluating YouTube's JS player. That is enough for channel metadata, channel uploads,
and search, none of which need format deciphering.

It is **not** enough to play video. Decoding streams additionally needs BotGuard PO-token minting
(`bgutils-js`), UMP/SABR part parsing (`googlevideo`), a DASH-capable player (`shaka-player`), and
every media segment proxied through your server as binary with Range support. Upstream's own browser
example does exactly that and is marked outdated in their docs. Consumers here embed YouTube's
iframe player instead.

## Fragility

This is a reverse-engineered client against a private API. YouTube changes response shapes without
notice, and a break is fixed by bumping the vendored bundle rather than by patching a consumer.
Pin and update deliberately.
