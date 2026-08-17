# Tabulator

Vendored copy of [Tabulator](https://tabulator.info/) v6.5.2, by Oliver Folkerd and contributors,
MIT licensed. An interactive data-table UI library with built-in column show/hide (via a per-column
header menu), multi-column sorting, filtering, and more.

Like this repo's other browser-only vendored UI libraries (`libfullcalendar@arshaw`), these files
are **not** meant to be `require()`'d — Tabulator's standalone build is designed to be loaded as a
plain `<script>` tag that sets `window.Tabulator`. So the JS note is exposed purely as a static
resource, and the CSS note is applied as `#appCss`; nothing clones them as an importable module.
Install this addon as a dependency (to ensure it's present) and reference its fixed resource URL:

| Resource | URL / mechanism |
|---|---|
| Tabulator core | `custom/libTabulator.js` (`<script>`) |
| Tabulator stylesheet | applied automatically via `#appCss` |

The `core` note uses a plain `application/javascript` MIME (no `;env=frontend` suffix). A
`customResourceProvider` serves content with `Content-Type` set verbatim to the note's own MIME, and
a browser refuses to execute a `<script>` whose type carries the non-standard `env=frontend`
parameter — so a note loaded only as a script tag must use a clean media type.

See [libagendatableview@beatlink](../libagendatableview@beatlink/) for a Preact component that
handles the script loading and wraps `new Tabulator(...)` for you — you likely want that instead of
loading this script yourself.
