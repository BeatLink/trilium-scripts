/* video-speed-controller@beatlink — startup

Puts the speed controller on both places a video can play in Trilium Desktop:

    - Trilium's own document, covering video and audio file notes and embedded players. The
      controller runs here directly, in the same scope as this script.
    - Web View notes, which Trilium renders as a real Electron <webview>. A guest page shares no
      scope with the renderer, so the same controller goes in as a source string through
      executeJavaScript(), once per page load.

To use:
    - Add this script as a JS frontend note with #run=frontendStartup.
    - Keep libVideoSpeedController.js as a direct child of this note.
    - Point ~schemaNote and ~configNote at the addon's schema.json and config.json.
*/

const { getConfig, isBlacklisted, controller, guestScript } = require("libVideoSpeedController.js");

// Trilium's own class on the <webview> element. Browser Trilium renders an <iframe> with the same
// class instead, which has no executeJavaScript() — the tag name in the selector skips it.
const WEBVIEW_SELECTOR = "webview.note-detail-web-view-content";

const note = api.currentNote;
const wired = new WeakSet();

async function inject(webview, config) {
    let hostname;
    try {
        hostname = new URL(webview.getURL()).hostname;
    } catch (error) {
        return;
    }
    if (isBlacklisted(hostname, config)) return;

    // In the guest the shortcuts are document-wide, the way the extension has them: nothing else
    // in that page competes for the keys.
    await webview.executeJavaScript(guestScript({ ...config, hoverScope: false }));
}

function wire(webview, config) {
    if (wired.has(webview)) return;
    wired.add(webview);
    // Each navigation is a fresh document, so the controller has to go in again; in-page
    // navigation keeps the document, and the script's own observer picks up the new player.
    webview.addEventListener("dom-ready", () => {
        inject(webview, config).catch((error) => console.warn("video-speed-controller: injection failed", error));
    });
}

function wireAll(root, config) {
    if (root.matches && root.matches(WEBVIEW_SELECTOR)) wire(root, config);
    if (root.querySelectorAll) root.querySelectorAll(WEBVIEW_SELECTOR).forEach((webview) => wire(webview, config));
}

(async () => {
    const config = await getConfig(note);

    if (config.applyInTrilium) {
        controller({ ...config, hoverScope: config.triliumShortcuts === "hover" });
    }

    if (!config.applyInWebViews) return;

    // Web views are mounted and torn down as the user moves between notes, so watch for them
    // rather than looking once at startup.
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) wireAll(node, config);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    wireAll(document.body, config);
})();
