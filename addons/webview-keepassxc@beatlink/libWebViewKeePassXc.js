/* webview-keepassxc@beatlink — the frontend half: key ring, backend bridge, and the guest script.

Three separate jobs live here because all three sit between the same two places — the renderer, which
owns the web view, and the backend note, which owns the socket to KeePassXC.

The *bridge* is the only route to that socket. A Trilium frontend script cannot open one itself, so
every protocol call goes through `api.runAsyncOnBackendWithManualTransactionHandling`, which posts to
the authenticated `/api/script/exec` and evaluates the callback in a backend bundle built from *this*
note. That is why `libKeePassXc.js` has to be a direct child of this note and not of the startup
script: the bundle's `require()` resolves against the children of whichever note makes the call. It is
also why there is no `customRequestHandler` here — Trilium serves `/custom/*` with no authentication
at all, which is fine for a calendar feed and not fine for passwords.

The *key ring* is the small JSON document mapping a database hash to the association KeePassXC issued
for it (`{ id, key }`). Its `key` is the public half of a permanent identification key pair, and
possession of that string is what a database recognises, so it is a bearer credential rather than a
public value. It is kept in a persistence note like any other addon state, which means it lives in
the Trilium database and syncs with it.

The *guest script* is `guestAgent`, shipped by `Function.prototype.toString` rather than as a string
literal so it stays real, readable code. Trilium's web views are Electron `<webview>` elements with no
preload script, so this is the only way in: the host injects the agent with `executeJavaScript`, the
agent finds the login fields and draws the entry picker, and it answers back through `console.log`
with a channel prefix, which the host reads off the element's `console-message` event. That console
line carries an entry *index* and never a credential — the password travels the other way, host to
guest, only once an entry has been chosen.
*/

const CHANNEL = "__kpxc__";

// --- backend bridge ---------------------------------------------------------

async function callBackend(action, options) {
    if (!api.isBackendScriptingEnabled()) {
        throw new Error("Backend script execution is disabled on this server, so nothing can reach KeePassXC. Enable it with [Security] backendScriptingEnabled=true in config.ini.");
    }

    return api.runAsyncOnBackendWithManualTransactionHandling(async (action, options) => {
        const keepassxc = require("libKeePassXc.js");
        return keepassxc[action](options);
    }, [action, options]);
}

// --- key ring ---------------------------------------------------------------

async function loadKeyring(noteId) {
    if (!noteId) return {};
    const content = await api.runOnBackend((id) => api.getNote(id).getContent(), [noteId]);
    try {
        return JSON.parse(content || "{}");
    } catch (error) {
        console.warn("webview-keepassxc: the stored key ring is unreadable, treating it as empty", error);
        return {};
    }
}

async function saveKeyring(noteId, keyring) {
    await api.runOnBackend(
        (id, content) => api.getNote(id).setContent(content),
        [noteId, JSON.stringify(keyring, null, 4)]
    );
}

const keyList = (keyring) => Object.values(keyring).map(({ id, key }) => ({ id, key }));

// --- actions ----------------------------------------------------------------

/* Whether KeePassXC answers, which database is open, and whether this client already knows it. */
async function status(noteId, socketPath) {
    const keyring = await loadKeyring(noteId);
    const result = await callBackend("status", { socketPath, hashes: Object.keys(keyring) });
    return { ...result, associated: !!(result.hash && keyring[result.hash]) };
}

/* Registers with the open database and records what KeePassXC hands back. */
async function associate(noteId, socketPath) {
    const association = await callBackend("associate", { socketPath });
    const keyring = await loadKeyring(noteId);
    keyring[association.hash] = { id: association.id, key: association.key };
    await saveKeyring(noteId, keyring);
    return association;
}

/* Removes every association, so the next connect starts a fresh one. */
async function forget(noteId) {
    await saveKeyring(noteId, {});
}

/* Credentials for one page, newest usable entry first. Expired entries sort last rather than being
   dropped, since KeePassXC only returns them when the user has allowed expired credentials. */
async function loginsFor(noteId, url, socketPath, triggerUnlock) {
    const keyring = await loadKeyring(noteId);
    const keys = keyList(keyring);
    if (!keys.length) return [];

    const { entries } = await callBackend("getLogins", { socketPath, url, keys, triggerUnlock });
    return entries.slice().sort((a, b) => (a.expired === "true" ? 1 : 0) - (b.expired === "true" ? 1 : 0));
}

// --- guest script -----------------------------------------------------------

/* Runs inside the web view's page, not here. It must not close over anything in this module: it
   reaches the guest as its own source text, so every value it needs arrives in `config`. */
function guestAgent(config) {
    const CHANNEL = "__kpxc__";
    const TOTP_HINT = /otp|2fa|mfa|one.?time|verification.?code|auth.*code|security.?code/i;
    const TEXT_TYPES = new Set(["text", "email", "tel", "number", ""]);

    if (window.__kpxc) {
        window.__kpxc.update(config);
        return;
    }

    let entries = [];
    let host = null;
    let shadow = null;
    let anchor = null;

    function isVisible(el) {
        if (el.disabled || el.readOnly) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return false;
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
    }

    function textInputs(root) {
        return Array.from(root.querySelectorAll("input")).filter((el) => {
            const type = (el.getAttribute("type") || "text").toLowerCase();
            return TEXT_TYPES.has(type) && isVisible(el);
        });
    }

    function hintsTotp(el) {
        if ((el.getAttribute("autocomplete") || "").toLowerCase().includes("one-time-code")) return true;
        const text = [el.name, el.id, el.placeholder, el.getAttribute("aria-label")].filter(Boolean).join(" ");
        return TOTP_HINT.test(text);
    }

    // The username is the last text field above the password, which is what a login form looks like
    // whether or not the two share a <form>. A page with no password field at all is the first step
    // of a two-step login, so its first text field is the username and there is nothing else to fill.
    function findFields() {
        const password = Array.from(document.querySelectorAll("input[type=password]")).filter(isVisible)[0] || null;
        const scope = (password && password.form) || document;
        const texts = textInputs(scope);

        let username;
        if (password) {
            const above = texts.filter((el) => el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING);
            username = above[above.length - 1] || texts[0] || null;
        } else {
            username = textInputs(document)[0] || null;
        }

        const totp = texts.find((el) => el !== username && hintsTotp(el)) || null;
        return { username, password, totp };
    }

    // Assigning to .value directly leaves a framework that tracks its own state unaware of the
    // change, so go through the prototype's setter and then say so with the events it listens for.
    function setValue(el, value) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
        if (setter && setter.set) setter.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // A closed shadow root so the page's own stylesheets cannot reach the picker, the picker's
    // cannot reach the page, and the page cannot read the picker back out of the host element.
    function ensureHost() {
        if (host) return host;
        host = document.createElement("div");
        host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647";
        shadow = host.attachShadow({ mode: "closed" });
        shadow.appendChild(buildUi());
        document.body.appendChild(host);
        return host;
    }

    function buildUi() {
        const root = document.createElement("div");
        root.innerHTML = `
            <style>
                :host, * { box-sizing: border-box; }
                .icon {
                    position: absolute; width: 20px; height: 20px; padding: 0; border: none; cursor: pointer;
                    border-radius: 4px; background: #2c3e50; color: #fff; font: 700 11px/20px sans-serif;
                    text-align: center; display: none;
                }
                .menu {
                    position: absolute; display: none; min-width: 220px; max-width: 360px; max-height: 260px;
                    overflow-y: auto; padding: 4px; border-radius: 6px; background: #fff; color: #222;
                    border: 1px solid #ccc; box-shadow: 0 4px 16px rgba(0,0,0,.25); font: 13px/1.4 sans-serif;
                }
                .entry { display: block; width: 100%; padding: 6px 8px; border: none; border-radius: 4px;
                    background: none; text-align: left; cursor: pointer; color: inherit; }
                .entry:hover { background: #eef2ff; }
                .name { font-weight: 600; }
                .login { color: #666; }
                .expired { color: #b00; }
            </style>
            <button class="icon" title="Fill from KeePassXC">KP</button>
            <div class="menu"></div>
        `;
        return root;
    }

    const ui = (selector) => shadow.querySelector(selector);

    function place() {
        if (!host || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const icon = ui(".icon");
        icon.style.left = `${window.scrollX + rect.right - 24}px`;
        icon.style.top = `${window.scrollY + rect.top + (rect.height - 20) / 2}px`;
        const list = ui(".menu");
        list.style.left = `${window.scrollX + rect.left}px`;
        list.style.top = `${window.scrollY + rect.bottom + 4}px`;
    }

    function closeMenu() {
        if (host) ui(".menu").style.display = "none";
    }

    function openMenu() {
        const list = ui(".menu");
        list.innerHTML = "";
        entries.forEach((entry, index) => {
            const button = document.createElement("button");
            button.className = "entry";
            button.type = "button";
            const expired = entry.expired === "true" ? ' <span class="expired">(expired)</span>' : "";
            button.innerHTML = `<span class="name"></span>${expired}<br><span class="login"></span>`;
            button.querySelector(".name").textContent = entry.name || entry.login || "(untitled)";
            button.querySelector(".login").textContent = entry.login || "";
            button.addEventListener("click", () => {
                closeMenu();
                pick(index);
            });
            list.appendChild(button);
        });
        place();
        list.style.display = "block";
    }

    // The host is listening on the page's console, which is the only channel a web view offers back
    // without a preload script. Only an index goes out; the credential comes back the other way.
    function pick(index) {
        console.log(CHANNEL + JSON.stringify({ index }));
    }

    function refresh() {
        const fields = findFields();
        anchor = fields.username || fields.password;

        if (!anchor || !entries.length) {
            if (host) {
                ui(".icon").style.display = "none";
                closeMenu();
            }
            return;
        }

        ensureHost();
        ui(".icon").style.display = config.showIcon === false ? "none" : "block";
        place();
    }

    function fill(credentials) {
        const fields = findFields();
        if (fields.username && credentials.login) setValue(fields.username, credentials.login);
        if (fields.password) setValue(fields.password, credentials.password);
        if (fields.totp && credentials.totp) setValue(fields.totp, credentials.totp);
        closeMenu();
        if (fields.password) fields.password.focus();
    }

    function update(next) {
        config = next;
        entries = next.entries || [];
        refresh();
        if (config.autoFill && entries.length === 1) pick(0);
    }

    ensureHost();
    ui(".icon").addEventListener("click", () => {
        if (ui(".menu").style.display === "block") closeMenu();
        else openMenu();
    });
    document.addEventListener("click", (event) => {
        if (event.target !== host) closeMenu();
    }, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);

    // Login forms on a single-page app appear after the load event, and often after a route change,
    // so keep looking rather than scanning once.
    let pendingScan = null;
    new MutationObserver(() => {
        clearTimeout(pendingScan);
        pendingScan = setTimeout(refresh, 250);
    }).observe(document.documentElement, { childList: true, subtree: true });

    window.__kpxc = { update, fill };
    update(config);
}

const guestSource = (config) => `(${guestAgent.toString()})(${JSON.stringify(config)})`;
const fillSource = (credentials) => `window.__kpxc && window.__kpxc.fill(${JSON.stringify(credentials)})`;

module.exports = { CHANNEL, status, associate, forget, loginsFor, guestSource, fillSource };
