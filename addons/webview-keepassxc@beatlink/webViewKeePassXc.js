/* Web View KeePassXC

Fills logins from KeePassXC into Trilium Desktop's built-in Web View note type. Trilium renders those
notes as a real Electron `<webview>`, which can run arbitrary script inside the page it is showing —
so the parts of a browser extension that matter for logging in can be rebuilt around it, without an
extension and without a native messaging host.

This file is the wiring only. Every web view that appears gets a `dom-ready` listener; on each page
load it asks KeePassXC what it has for that URL, injects the picker agent carrying the entry titles
and usernames, and waits. When the agent reports which entry the user chose (or auto-fills, when a
single entry matches and the setting allows it), the credential for that one entry is sent in.

Credentials only ever reach a page KeePassXC itself agreed to release them for, and never before —
but from the moment they are filled, the page's own scripts can read them out of the fields, exactly
as with any browser autofill.

To use:
    - Add this script as a JS frontend note with #run=frontendStartup.
    - Keep libWebViewKeePassXc.js as a direct child of this note.
    - Connect to KeePassXC once from the addon's settings page.
    - Open any Web View note in Trilium Desktop.
*/

const keepassxc = require("libWebViewKeePassXc.js");
const { resolveConfigNotes, loadSettings } = require("libSettingsUI.jsx");

// Trilium's own class on the <webview> element. Browser Trilium renders an <iframe> with the same
// class instead, which can run nothing inside a cross-origin page — the tag name in the selector
// skips it.
const WEBVIEW_SELECTOR = "webview.note-detail-web-view-content";

const wired = new WeakSet();

// The entries last fetched for each web view, so a pick coming back over the console channel can be
// answered without asking KeePassXC again.
const offered = new WeakMap();

let keyringNoteId = null;
let settings = { autoFill: false, showIcon: true, socketPath: "" };

const ready = (async () => {
    keyringNoteId = await api.currentNote.getRelationValue("keyringNote");
    try {
        const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote);
        settings = await loadSettings(schemaNoteId, configNoteId);
    } catch (error) {
        console.warn("webview-keepassxc: settings could not be read, using defaults", error);
    }
})();

async function offer(webview) {
    await ready;

    const url = webview.getURL();
    if (!/^https?:/i.test(url || "")) return;

    let entries;
    try {
        entries = await keepassxc.loginsFor(keyringNoteId, url, settings.socketPath, false);
    } catch (error) {
        // A locked database, a KeePassXC that is not running, or a site the user denied are all
        // ordinary states here, so they belong in the console rather than in the user's face.
        console.info(`webview-keepassxc: no credentials for ${url} — ${error.message}`);
        return;
    }
    if (!entries.length) return;

    offered.set(webview, entries);

    const config = {
        entries: entries.map((entry) => ({ name: entry.name, login: entry.login, expired: entry.expired })),
        autoFill: !!settings.autoFill,
        showIcon: settings.showIcon !== false
    };
    await webview.executeJavaScript(keepassxc.guestSource(config));
}

// The agent's only way back out of the page, since a Trilium web view has no preload script to run
// an IPC channel in. It carries an index into what was offered, never a credential.
function handleMessage(webview, message) {
    if (!message || !message.startsWith(keepassxc.CHANNEL)) return;

    let index;
    try {
        index = JSON.parse(message.slice(keepassxc.CHANNEL.length)).index;
    } catch (error) {
        return;
    }

    const entry = (offered.get(webview) || [])[index];
    if (!entry) return;

    const credentials = { login: entry.login, password: entry.password };
    if (settings.fillTotp !== false && entry.totp) credentials.totp = entry.totp;
    webview.executeJavaScript(keepassxc.fillSource(credentials));
}

function wire(webview) {
    if (wired.has(webview)) return;
    wired.add(webview);
    webview.addEventListener("dom-ready", () => offer(webview));
    webview.addEventListener("console-message", (event) => handleMessage(webview, event.message));
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
