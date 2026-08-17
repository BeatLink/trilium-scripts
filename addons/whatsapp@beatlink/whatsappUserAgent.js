/* whatsapp@beatlink — startup

WhatsApp Web turns away Trilium Desktop's Web View note type: the guest page reports Electron's
default user agent, which carries Trilium/x and Electron/y tokens on top of the Chrome ones, and
WhatsApp reads that as an unsupported browser. This script overrides the user agent of every Web
View note pointed at web.whatsapp.com, and puts the addon's WhatsApp note in the launchbar.

The override is whatever the settings page holds, defaulting to Trilium's own user agent with the
Trilium and Electron tokens stripped out — the plain Chrome string of the very Chromium build the
page is already running in.

To use:
    - Add this script as a JS frontend note with #run=frontendStartup.
    - Keep libSettingsUI.jsx as a direct child of this note.
    - Point ~schemaNote and ~configNote at the addon's schema.json and config.json, and
      ~whatsappNote at its WhatsApp note.
*/

const { resolveConfigNotes, loadSettings } = require("libSettingsUI.jsx");

// Trilium's own class on the <webview> element. Browser Trilium renders an <iframe> with the same
// class instead, which has no user agent of its own to set — the tag name in the selector skips it.
const WEBVIEW_SELECTOR = "webview.note-detail-web-view-content";

const WHATSAPP_HOST = /(^|\.)whatsapp\.com$/i;

// Tokens a plain Chrome user agent is made of. Anything else carrying a version — Trilium/0.9x,
// Electron/3x — is what gives the embedder away, so it is dropped.
const CHROME_TOKENS = ["Mozilla", "AppleWebKit", "Chrome", "Safari"];

function chromeUserAgent() {
    return navigator.userAgent
        .split(" ")
        .filter((token) => !token.includes("/") || CHROME_TOKENS.includes(token.split("/")[0]))
        .join(" ");
}

function isWhatsApp(url) {
    try {
        return WHATSAPP_HOST.test(new URL(url).hostname);
    } catch (error) {
        return false;
    }
}

const wired = new WeakSet();
const reloaded = new WeakSet();

function wire(webview, userAgent) {
    if (wired.has(webview)) return;
    wired.add(webview);
    if (!isWhatsApp(webview.getAttribute("src") || "")) return;

    // The attribute is only read while the guest attaches, which this observer has often already
    // missed — hence the dom-ready check, which fixes up a page that loaded before it landed.
    webview.setAttribute("useragent", userAgent);

    webview.addEventListener("dom-ready", async () => {
        if (!isWhatsApp(webview.getURL())) return;

        const actual = await webview.executeJavaScript("navigator.userAgent");
        if (actual === userAgent) return;

        // setUserAgent only reaches the guest from its next load onwards. Reloading once per
        // element is enough: every later page in it already reports the override.
        webview.setUserAgent(userAgent);
        if (reloaded.has(webview)) return;
        reloaded.add(webview);
        webview.reload();
    });
}

function wireAll(root, userAgent) {
    if (root.matches && root.matches(WEBVIEW_SELECTOR)) wire(root, userAgent);
    if (root.querySelectorAll) root.querySelectorAll(WEBVIEW_SELECTOR).forEach((webview) => wire(webview, userAgent));
}

async function registerLauncher() {
    const targetNoteId = await api.currentNote.getRelationValue("whatsappNote");
    if (!targetNoteId) return;

    await api.runOnBackend((targetNoteId) => {
        api.createOrUpdateLauncher({
            id: "whatsappWeb",
            title: "WhatsApp",
            type: "note",
            icon: "bxl-whatsapp",
            isVisible: true,
            targetNoteId
        });
    }, [targetNoteId]);
}

(async () => {
    registerLauncher().catch((error) => console.warn("whatsapp: launcher registration failed", error));

    const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote);
    const { userAgent } = await loadSettings(schemaNoteId, configNoteId);
    const effective = (userAgent || "").trim() || chromeUserAgent();

    // Web views are mounted and torn down as the user moves between notes, so watch for them
    // rather than looking once at startup.
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) wireAll(node, effective);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    wireAll(document.body, effective);
})();
