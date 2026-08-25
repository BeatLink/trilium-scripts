/* web-preview@beatlink — startup

Sets the user agent of every Web View note's <webview> to whatever the settings ask for. This is a
startup script rather than part of the toolbar widget because the `useragent` attribute is only
read while the guest attaches, which happens as Trilium inserts the element — before any widget
mounted alongside it could reach it. Watching the DOM catches most of those; the dom-ready pass
fixes up the ones it doesn't.

To use:
    - Add this script as a JS frontend note with #run=frontendStartup.
    - Keep libWebPreview.js and libSettingsUI.jsx as direct children of this note.
    - Point ~schemaNote and ~configNote at the addon's schema.json and config.json.
*/

const { resolveConfigNotes, loadSettings } = require("libSettingsUI.jsx");
const { resolveUserAgent, applyUserAgent } = require("libWebPreview.js");

// Trilium's own class on the <webview> element. Browser Trilium renders an <iframe> with the same
// class instead, which has no user agent of its own to set — the tag name in the selector skips it.
const WEBVIEW_SELECTOR = "webview.note-detail-web-view-content";

const wired = new WeakSet();

function wire(webview, userAgent) {
    if (wired.has(webview)) return;
    wired.add(webview);

    webview.setAttribute("useragent", userAgent);
    webview.addEventListener("dom-ready", () => {
        applyUserAgent(webview, userAgent).catch((error) => console.warn("web-preview: could not set the user agent", error));
    });
}

function wireAll(root, userAgent) {
    if (root.matches && root.matches(WEBVIEW_SELECTOR)) wire(root, userAgent);
    if (root.querySelectorAll) root.querySelectorAll(WEBVIEW_SELECTOR).forEach((webview) => wire(webview, userAgent));
}

(async () => {
    const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote);
    const settings = await loadSettings(schemaNoteId, configNoteId);
    const userAgent = resolveUserAgent(settings);
    if (!userAgent) return;

    // Web views are mounted and torn down as the user moves between notes, so watch for them
    // rather than looking once at startup.
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) wireAll(node, userAgent);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    wireAll(document.body, userAgent);
})();
