/* Web View Adblock

Hides ads inside Trilium Desktop's built-in Web View note type. Trilium renders those notes
as a real Electron <webview>, whose insertCSS() method injects a stylesheet into the guest
page — so EasyList's cosmetic (element-hiding) rules can be applied to it from the renderer,
without an extension and without touching Trilium's main process.

This is cosmetic filtering only: ad elements are hidden, but the requests behind them still
go out. Pair it with a DNS or proxy-level blocker if you want the requests stopped too.

To use:
    - Add this script as a JS frontend note with #run=frontendStartup.
    - Keep libWebViewAdblock.js as a direct child of this note.
    - Open any Web View note in Trilium Desktop.
*/

const { cssForHostname } = require("libWebViewAdblock.js");

// Trilium's own class on the <webview> element. Browser Trilium renders an <iframe> with the
// same class instead, which has no insertCSS() — the tag name in the selector skips it.
const WEBVIEW_SELECTOR = "webview.note-detail-web-view-content";

const wired = new WeakSet();

// insertCSS only affects the document currently loaded in the guest, so this reruns for every
// page the user navigates to.
async function applyFilters(webview) {
    let hostname;
    try {
        hostname = new URL(webview.getURL()).hostname;
    } catch (error) {
        return;
    }

    const css = await cssForHostname(hostname);
    if (css) await webview.insertCSS(css);
}

function wire(webview) {
    if (wired.has(webview)) return;
    wired.add(webview);
    webview.addEventListener("dom-ready", () => applyFilters(webview));
}

function wireAll(root) {
    if (root.matches && root.matches(WEBVIEW_SELECTOR)) wire(root);
    if (root.querySelectorAll) root.querySelectorAll(WEBVIEW_SELECTOR).forEach(wire);
}

// Web views are mounted and torn down as the user moves between notes, so watch for them
// rather than looking once at startup.
const observer = new MutationObserver((records) => {
    for (const record of records) {
        for (const node of record.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) wireAll(node);
        }
    }
});

observer.observe(document.body, { childList: true, subtree: true });
wireAll(document.body);
