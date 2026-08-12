// === Trilium Code note ===
// Title: libBlockUrl.js
// Type: Code -> JS Frontend
// Library only — no #run attribute. require()'d by blockUrl.js and blockUrlToolbarWidget.jsx

/* blockurl@beatlink — sync-server client and guest-page scripts.

Talks to a BlockURL sync server (https://github.com/BeatLink/BlockURL) the same way the Firefox
extension does: POST /urls/check, /urls/block, /urls/unblock and GET /settings/all.

Every request is issued from the Trilium backend rather than the renderer. The sync server sends no
CORS headers, so a renderer fetch() to it is refused at the preflight; the backend's Node fetch has
no such restriction. That makes backend scripting (Options -> Security) a hard requirement.
*/

const BLOCKED_PAGE_DEFAULTS = {
    blocked_page_heading_text: "Blocked",
    blocked_page_body_text: "This Page has been blocked by BlockURL",
    blocked_page_button_text: "Unblock"
};

let configPromise = null;
let serverSettingsPromise = null;

// The server stores every URL without its trailing slash, so both sides have to agree before a
// lookup can match.
function normalizeUrl(url) {
    return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function readJson(noteId) {
    if (!noteId) return {};
    const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [noteId]);
    try {
        return JSON.parse(content || "{}");
    } catch (error) {
        return {};
    }
}

// Merges the addon's stored config.json over schema.json's defaults. This schema is flat strings
// only, so libsettings' full merge isn't needed — and requiring libSettingsUI.jsx here would drag
// its whole preact form into a plain script note's bundle.
async function getConfig(note) {
    if (!configPromise) {
        configPromise = (async () => {
            const schema = await readJson(await note.getRelationValue("schemaNote"));
            const stored = await readJson(await note.getRelationValue("configNote"));
            const values = {};
            for (const [key, definition] of Object.entries(schema)) {
                values[key] = key in stored ? stored[key] : definition.default;
            }
            return values;
        })();
    }
    return configPromise;
}

async function request(note, method, endpoint, payload) {
    if (!api.isBackendScriptingEnabled()) {
        throw new Error("backend scripting is disabled — turn it on in Options -> Security");
    }

    const config = await getConfig(note);
    const base = (config.syncServerUrl || "").replace(/\/+$/, "");
    if (!base) throw new Error("no sync server URL configured");

    return api.runAsyncOnBackendWithManualTransactionHandling(async (url, apiKey, verb, body) => {
        const headers = {};
        if (apiKey) headers["X-API-Key"] = apiKey;
        if (body) headers["Content-Type"] = "application/json;charset=UTF-8";
        // A missing or wrong API key redirects to the server's login page instead of failing, so
        // redirects are left unfollowed — otherwise that arrives as an HTML body and fails as a
        // JSON parse error several steps away from the actual cause.
        const response = await fetch(url, { method: verb, headers, body, redirect: "manual" });
        if (!response.ok) throw new Error(`sync server returned ${response.status}`);
        return response.json();
    }, [`${base}/${endpoint}`, config.apiKey || "", method, payload ? JSON.stringify(payload) : null]);
}

// Returns { url: isBlocked } for the URLs asked about, keyed by their normalized form.
async function checkUrls(note, urls) {
    if (!urls.length) return {};
    return request(note, "POST", "urls/check", { urls: urls.map(normalizeUrl) });
}

async function blockUrls(note, urls) {
    return request(note, "POST", "urls/block", { urls: urls.map(normalizeUrl) });
}

async function unblockUrls(note, urls) {
    return request(note, "POST", "urls/unblock", { urls: urls.map(normalizeUrl) });
}

// The blocked page's wording, which the sync server owns so every client shows the same thing.
// Fetched once per session — it changes far less often than a Trilium reload.
async function getServerSettings(note) {
    if (!serverSettingsPromise) {
        serverSettingsPromise = request(note, "GET", "settings/all", null)
            .then((pairs) => ({ ...BLOCKED_PAGE_DEFAULTS, ...Object.fromEntries(pairs) }))
            .catch((error) => {
                serverSettingsPromise = null;
                console.warn("blockurl: could not read the sync server's settings", error);
                return BLOCKED_PAGE_DEFAULTS;
            });
    }
    return serverSettingsPromise;
}

// Runs inside the guest page. It can't message the embedder back — Trilium's <webview> has no
// preload script and the main process refuses to attach one — so it only ever accumulates state,
// and the host drains it by calling drain() over executeJavaScript.
const GUEST_SCRIPT = `(() => {
    if (window.__blockUrl) return;

    const state = { pending: [], blocked: new Set(), seen: new Set(), dirty: true };
    const normalize = (url) => url.endsWith("/") ? url.slice(0, -1) : url;

    function scan() {
        for (const [tag, attribute] of [["a", "href"], ["img", "src"]]) {
            for (const element of document.querySelectorAll(tag)) {
                const raw = element[attribute];
                if (!raw || !raw.startsWith("http")) continue;
                const url = normalize(raw);
                if (state.blocked.has(url)) {
                    element.style.setProperty("display", "none", "important");
                } else if (!state.seen.has(url)) {
                    state.seen.add(url);
                    state.pending.push(url);
                }
            }
        }
    }

    // Infinite scroll and single-page navigation both add links long after load, so the page is
    // rescanned on mutation rather than once — but only on the next poll, not per mutation.
    new MutationObserver(() => { state.dirty = true; })
        .observe(document.documentElement, { childList: true, subtree: true });

    window.__blockUrl = {
        drain() {
            if (state.dirty) {
                state.dirty = false;
                scan();
            }
            const urls = state.pending;
            state.pending = [];
            return { urls, unblock: false };
        },
        apply(blocked) {
            for (const url of blocked) state.blocked.add(url);
            scan();
        }
    };
})();`;

// Replaces the guest document with the blocked page. The page's own scripts keep running — this is
// a takeover of the rendered document, not a cancelled navigation.
function blockedPageScript(settings) {
    return `(() => {
        const settings = ${JSON.stringify(settings)};
        let unblockRequested = false;

        const heading = document.createElement("h1");
        heading.textContent = settings.blocked_page_heading_text;
        heading.style.cssText = "font: 600 32px/1.2 system-ui, sans-serif; margin: 0 0 12px";

        const body = document.createElement("p");
        body.textContent = settings.blocked_page_body_text;
        body.style.cssText = "font: 16px/1.5 system-ui, sans-serif; margin: 0 0 24px; opacity: .7";

        const button = document.createElement("button");
        button.textContent = settings.blocked_page_button_text;
        button.style.cssText = "border: none; border-radius: 6px; padding: 10px 20px; cursor: pointer; background: #4b6fff; color: white; font: 14px system-ui, sans-serif";
        button.addEventListener("click", () => {
            unblockRequested = true;
            button.disabled = true;
        });

        const wrapper = document.createElement("div");
        wrapper.style.cssText = "display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 24px; color: #222; background: #fff";
        wrapper.append(heading, body, button);

        document.title = settings.blocked_page_heading_text;
        document.head.replaceChildren();
        document.body.replaceChildren(wrapper);

        // Same drain() contract as the link-hiding script, so the host polls one shape either way.
        // "takeover" tells it this document is the block screen rather than the real page.
        window.__blockUrl = {
            takeover: true,
            drain: () => ({ urls: [], unblock: unblockRequested }),
            apply: () => {}
        };
    })();`;
}

module.exports = {
    normalizeUrl,
    checkUrls,
    blockUrls,
    unblockUrls,
    getServerSettings,
    GUEST_SCRIPT,
    blockedPageScript
};
