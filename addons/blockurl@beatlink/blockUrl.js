/* blockurl@beatlink — enforcement

Applies a BlockURL block list to Trilium Desktop's built-in Web View note type. Trilium renders
those notes as a real Electron <webview>, whose executeJavaScript() reaches into the guest page —
so a blocked page can be replaced and blocked links hidden from the renderer, without an extension.

The guest can't message back (no preload script is possible), so a poll drives everything: the
guest script collects the URLs it has found, the host drains them, asks the sync server about them,
and hands the answers back.

To use:
    - Add this script as a JS frontend note with #run=frontendStartup.
    - Keep libBlockUrl.js as a direct child of this note.
    - Point ~schemaNote and ~configNote at the addon's schema.json and config.json.
*/

const { normalizeUrl, checkUrls, unblockUrls, getServerSettings, GUEST_SCRIPT, blockedPageScript } = require("libBlockUrl.js");

// Trilium's own class on the <webview> element. Browser Trilium renders an <iframe> with the same
// class instead, which has no executeJavaScript() — the tag name in the selector skips it.
const WEBVIEW_SELECTOR = "webview.note-detail-web-view-content";
const POLL_INTERVAL_MS = 1000;

const note = api.currentNote;
const wired = new WeakSet();

// Decides what the page currently in the guest gets: a takeover, or the link-hiding script.
async function enforce(webview) {
    const current = webview.getURL();
    if (!current.startsWith("http")) return;

    const url = normalizeUrl(current);
    const result = await checkUrls(note, [url]);

    if (result[url]) {
        await webview.executeJavaScript(blockedPageScript(await getServerSettings(note)));
        return;
    }

    // In-page navigation away from a blocked URL leaves the block screen standing, since nothing
    // reloaded the document — the real page has to be fetched back.
    const takenOver = await webview.executeJavaScript("!!(window.__blockUrl && window.__blockUrl.takeover)");
    if (takenOver) {
        webview.reload();
        return;
    }

    await webview.executeJavaScript(GUEST_SCRIPT);
}

async function poll(webview) {
    const drained = await webview.executeJavaScript("window.__blockUrl ? window.__blockUrl.drain() : null");
    if (!drained) return;

    if (drained.unblock) {
        await unblockUrls(note, [normalizeUrl(webview.getURL())]);
        webview.reload();
        return;
    }

    if (!drained.urls.length) return;
    const result = await checkUrls(note, drained.urls);
    const blocked = Object.keys(result).filter((url) => result[url]);
    if (blocked.length) {
        await webview.executeJavaScript(`window.__blockUrl.apply(${JSON.stringify(blocked)})`);
    }
}

function wire(webview) {
    if (wired.has(webview)) return;
    wired.add(webview);

    // In-page navigation never fires dom-ready, so a single-page site (YouTube being the obvious
    // one) would otherwise only ever be checked at the URL the note was opened on.
    const recheck = () => enforce(webview).catch((error) => console.warn("blockurl: enforcement failed", error));
    webview.addEventListener("dom-ready", recheck);
    webview.addEventListener("did-navigate-in-page", recheck);

    let busy = false;
    const timer = setInterval(async () => {
        if (!webview.isConnected) {
            clearInterval(timer);
            return;
        }
        if (busy) return;
        busy = true;
        try {
            await poll(webview);
        } catch (error) {
            // An unreachable sync server would otherwise repeat this every second for as long as
            // the note stays open, so this webview is left alone until it is remounted.
            clearInterval(timer);
            console.warn("blockurl: polling stopped", error);
        } finally {
            busy = false;
        }
    }, POLL_INTERVAL_MS);
}

function wireAll(root) {
    if (root.matches && root.matches(WEBVIEW_SELECTOR)) wire(root);
    if (root.querySelectorAll) root.querySelectorAll(WEBVIEW_SELECTOR).forEach(wire);
}

// Web views are mounted and torn down as the user moves between notes, so watch for them rather
// than looking once at startup.
const observer = new MutationObserver((records) => {
    for (const record of records) {
        for (const node of record.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) wireAll(node);
        }
    }
});

observer.observe(document.body, { childList: true, subtree: true });
wireAll(document.body);
