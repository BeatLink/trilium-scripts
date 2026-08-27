// === Trilium Code note ===
// Title: libWebPreview.js
// Type: Code -> JS Frontend
// Library only — no #run attribute. require()'d by webViewToolbarWidget.js

// ---------------------------------------------------------------------------
// Creates a Web View note for `url` under `parentNoteId` and returns its noteId.
// With `reuseExisting`, a Web View note anywhere in the tree already pointing at
// the same URL is cloned under `parentNoteId` instead of a second one being made.
// ---------------------------------------------------------------------------
async function createWebViewNote(parentNoteId, url, title, reuseExisting) {
    return api.runOnBackend((parentNoteId, url, title, reuseExisting) => {
        if (reuseExisting) {
            // Matching is done in JS rather than in the search query because a URL
            // carries characters the search syntax would otherwise interpret.
            const existing = api.searchForNotes("#webViewSrc")
                .find((note) => note.type === "webView" && note.getLabelValue("webViewSrc") === url);
            if (existing) {
                api.toggleNoteInParent(true, existing.noteId, parentNoteId, "");
                return existing.noteId;
            }
        }

        const { note } = api.createNewNote({
            parentNoteId,
            title: title || url,
            type: "webView",
            content: "",
            mime: "text/html"
        });
        note.setLabel("webViewSrc", url);
        // Records the title as this addon's own, so page-title syncing may replace it
        // until the user renames the note themselves.
        note.setLabel("webViewAutoTitle", note.title);
        return note.noteId;
    }, [parentNoteId, url, title, reuseExisting]);
}

// ---------------------------------------------------------------------------
// Every Web View note in the tree, most recently changed first, which the New Tab
// box matches what is typed against and offers as-is while nothing is typed. Read
// once when the box opens rather than per keystroke, since there is no live search
// to keep up with.
// ---------------------------------------------------------------------------
async function listWebViewNotes() {
    return api.runOnBackend(() => api.searchForNotes("#webViewSrc")
        .filter((note) => note.type === "webView" && !note.isDeleted)
        .map((note) => ({ noteId: note.noteId, title: note.title, url: note.getLabelValue("webViewSrc") || "", dateModified: note.dateModified }))
        .sort((a, b) => String(b.dateModified || "").localeCompare(String(a.dateModified || ""))), []);
}

// The notes from listWebViewNotes() whose title or URL contains `query`, the closest
// match first.
function matchWebViewNotes(notes, query, limit = 6) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    return notes
        .map((note) => ({ note, rank: matchRank(note, needle) }))
        .filter((scored) => scored.rank < Infinity)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, limit)
        .map((scored) => scored.note);
}

// How early `needle` appears in a note's title, else in its URL, else Infinity for no
// match at all. A title match always outranks a URL one, however late it comes.
function matchRank(note, needle) {
    const inTitle = note.title.toLowerCase().indexOf(needle);
    if (inTitle >= 0) return inTitle;

    const inUrl = note.url.toLowerCase().indexOf(needle);
    return inUrl >= 0 ? 1000 + inUrl : Infinity;
}

// ---------------------------------------------------------------------------
// User agent. Some sites - WhatsApp Web among them - read the Trilium and
// Electron tokens in Trilium's own user agent as an unsupported browser, so the
// <webview> can be told to report something else.
// ---------------------------------------------------------------------------

// Tokens a plain Chrome user agent is made of. Anything else carrying a version -
// Trilium/0.9x, Electron/3x - is what gives the embedder away, so it is dropped.
const CHROME_TOKENS = ["Mozilla", "AppleWebKit", "Chrome", "Safari"];

function chromeUserAgent() {
    return navigator.userAgent
        .split(" ")
        .filter((token) => !token.includes("/") || CHROME_TOKENS.includes(token.split("/")[0]))
        .join(" ");
}

// The user agent the settings ask for, or "" to leave Trilium's own alone.
function resolveUserAgent(settings) {
    if (settings?.userAgentMode === "chrome") return chromeUserAgent();
    if (settings?.userAgentMode === "custom") return (settings.userAgent || "").trim();
    return "";
}

const userAgentReloaded = new WeakSet();

// ---------------------------------------------------------------------------
// Points the <webview> at `userAgent`. setUserAgent() only reaches the guest from
// its next load onwards, so the page already on screen is reloaded once per
// element; every later page in it already reports the override.
// ---------------------------------------------------------------------------
async function applyUserAgent(webview, userAgent) {
    const actual = await webview.executeJavaScript("navigator.userAgent");
    if (actual === userAgent) return;

    webview.setUserAgent(userAgent);
    if (userAgentReloaded.has(webview)) return;
    userAgentReloaded.add(webview);
    webview.reload();
}

// ---------------------------------------------------------------------------
// Every set of two or more Web View notes pointing at the same URL, so the
// settings page can offer to fold each set into one note. Oldest first within a
// group, since that is the one worth keeping by default.
// ---------------------------------------------------------------------------
async function findDuplicateWebViews() {
    return api.runOnBackend(() => {
        const byUrl = new Map();
        for (const note of api.searchForNotes("#webViewSrc")) {
            if (note.type !== "webView" || note.isDeleted) continue;
            const url = note.getLabelValue("webViewSrc");
            if (!url) continue;
            if (!byUrl.has(url)) byUrl.set(url, []);
            byUrl.get(url).push({
                noteId: note.noteId,
                title: note.title,
                dateCreated: note.dateCreated,
                childCount: note.getChildNotes().length,
                attributeCount: note.getOwnedAttributes().length,
                parents: note.getParentNotes().map((parent) => ({ noteId: parent.noteId, title: parent.title }))
            });
        }

        return [...byUrl.entries()]
            .filter(([, notes]) => notes.length > 1)
            .map(([url, notes]) => ({
                url,
                notes: notes.sort((a, b) => String(a.dateCreated || "").localeCompare(String(b.dateCreated || "")))
            }))
            .sort((a, b) => b.notes.length - a.notes.length);
    }, []);
}

// ---------------------------------------------------------------------------
// Folds `duplicateNoteIds` into `keeperNoteId`: everything each duplicate holds
// is moved onto the keeper — child notes, owned attributes it doesn't already
// have, and a clone of the keeper into every parent the duplicate sat under —
// before the now-empty duplicate is deleted. Returns a per-duplicate report.
// ---------------------------------------------------------------------------
async function mergeWebViewDuplicates(keeperNoteId, duplicateNoteIds) {
    return api.runOnBackend((keeperNoteId, duplicateNoteIds) => {
        const keeper = api.getNote(keeperNoteId);
        if (!keeper || keeper.isDeleted) throw new Error("the note to keep no longer exists");

        const merged = [];
        const skipped = [];

        for (const noteId of duplicateNoteIds) {
            if (noteId === keeperNoteId) continue;

            const note = api.getNote(noteId);
            if (!note || note.isDeleted) {
                skipped.push({ noteId, reason: "note no longer exists" });
                continue;
            }

            // The keeper's own placement under the duplicate is dropped rather than
            // moved, since a note can't be its own child.
            for (const child of note.getChildNotes()) {
                if (child.noteId !== keeperNoteId) api.ensureNoteIsPresentInParent(child.noteId, keeperNoteId);
                api.toggleNoteInParent(false, child.noteId, noteId, "");
            }

            for (const attribute of note.getOwnedAttributes()) {
                if (attribute.type === "label" && attribute.name === "webViewSrc") continue;
                const held = keeper.getOwnedAttributes(attribute.type, attribute.name);
                if (held.some((existing) => existing.value === attribute.value)) continue;
                keeper.addAttribute(attribute.type, attribute.name, attribute.value, attribute.isInheritable);
            }

            // Deleting is only safe once the keeper provably sits everywhere the
            // duplicate did, so a failed clone must not cost a placement.
            const keeperParents = new Set(keeper.getParentNotes().map((parent) => parent.noteId));
            let failure = null;
            for (const parent of note.getParentNotes()) {
                if (keeperParents.has(parent.noteId)) continue;
                try {
                    api.ensureNoteIsPresentInParent(keeperNoteId, parent.noteId);
                    keeperParents.add(parent.noteId);
                } catch (error) {
                    failure = `could not clone into "${parent.title}": ${error.message}`;
                    break;
                }
            }
            if (failure) {
                skipped.push({ noteId, reason: failure });
                continue;
            }

            note.deleteNote();
            merged.push(noteId);
        }

        return { merged, skipped };
    }, [keeperNoteId, duplicateNoteIds]);
}

// ---------------------------------------------------------------------------
// Renames a note to the page's title, but only while its title is still one this
// addon generated: a title the user set themselves is kept. #webViewAutoTitle holds
// the last auto-applied title, so a title that no longer matches it is the user's.
// Notes predating that label count as auto-titled only while their title is still
// the URL or its hostname, which is what a note gets when it is created here.
// ---------------------------------------------------------------------------
async function renameNote(noteId, title) {
    const trimmed = (title || "").trim();
    if (!trimmed) return;

    await api.runOnBackend((noteId, title) => {
        const note = api.getNote(noteId);
        if (!note) return;

        const auto = note.getLabelValue("webViewAutoTitle");
        if (auto === null || auto === undefined) {
            const src = note.getLabelValue("webViewSrc") || "";
            let hostname = "";
            try { hostname = new URL(src).hostname; } catch {}
            if (note.title !== src && note.title !== hostname) return;
        } else if (auto !== note.title) {
            return;
        }

        // Skipping the write when nothing changed keeps a page reporting the same
        // title repeatedly from churning the note's revisions.
        if (note.title !== title) {
            note.title = title;
            note.save();
        }
        if (auto !== title) note.setLabel("webViewAutoTitle", title);
    }, [noteId, trimmed]);
}

// ---------------------------------------------------------------------------
// The note a saved page is filed under: the one configured in settings, else
// whichever note carries an #inbox label.
// ---------------------------------------------------------------------------
async function resolveSaveParentNoteId(saveParentNoteId) {
    if (saveParentNoteId) return saveParentNoteId;

    const results = await api.searchForNotes("#inbox");
    if (results.length === 0) throw new Error("no Save Location is set and no note is labelled #inbox");
    return results[0].noteId;
}

// ---------------------------------------------------------------------------
// Opens a URL in the system's default browser. Uses the renderer's electronApi
// bridge — backend scripts can't require("electron"), it isn't on the allowed
// module list.
// ---------------------------------------------------------------------------
function openExternal(url) {
    window.electronApi?.shell?.openExternal(url);
}

// ---------------------------------------------------------------------------
// Where a note for a clicked link is filed: under the note the link was clicked
// in, the way tree style tabs nest a tab under its opener, or alongside it, the
// way a browser puts the new tab next to the one it came from.
// ---------------------------------------------------------------------------
async function resolveLinkParentNoteId(noteId, linkPlacement) {
    if (linkPlacement !== "sibling") return noteId;

    const note = await api.getNote(noteId);
    return note?.getParentNoteIds()[0] || noteId;
}

// ---------------------------------------------------------------------------
// Deletes the Web View note itself, for clearing out saved links once you're
// done with them. Its children move up under its own parent first, so closing a
// page you branched from leaves the pages it opened where you can still reach
// them. Trilium's delete is soft, so the note stays recoverable from Recent
// Changes. The parent is activated afterwards, since the tab would otherwise be
// left sitting on a note that no longer exists.
// ---------------------------------------------------------------------------
async function deleteWebViewNote(noteId) {
    const parentNoteId = await api.runOnBackend((noteId) => {
        const note = api.getNote(noteId);
        if (!note || note.isDeleted) return null;

        const parentNoteId = note.getParentNotes()[0]?.noteId;
        if (parentNoteId) {
            for (const child of note.getChildNotes()) {
                if (child.noteId !== parentNoteId) api.ensureNoteIsPresentInParent(child.noteId, parentNoteId);
                api.toggleNoteInParent(false, child.noteId, noteId, "");
            }
        }

        note.deleteNote();
        return parentNoteId;
    }, [noteId]);

    if (parentNoteId) await api.activateNote(parentNoteId);
}

// ---------------------------------------------------------------------------
// Points the note at the page you ended up on. Trilium keys the <webview> on this
// label's value, so writing it tears the element down and loads the page again —
// which is why this is only ever called as the note is being left, where the
// element is going away regardless.
// ---------------------------------------------------------------------------
async function updateWebViewSrc(noteId, url) {
    if (!/^https?:/i.test(url || "")) return;

    return api.runOnBackend((noteId, url) => {
        const note = api.getNote(noteId);
        if (!note || note.isDeleted || note.getLabelValue("webViewSrc") === url) return;
        note.setLabel("webViewSrc", url);
    }, [noteId, url]);
}

// ---------------------------------------------------------------------------
// The note's own back/forward stack, so it outlives the <webview> element, which
// loses Chromium's history every time Trilium mounts a fresh one. It is kept in an
// attachment rather than the note's content — which the New Tab list's ordering and
// the search index both read — under a role of this addon's own, since Trilium only
// erases unused attachments whose role says they live in a note's content.
// ---------------------------------------------------------------------------
const HISTORY_ATTACHMENT_TITLE = "webViewHistory.json";
const HISTORY_ATTACHMENT_ROLE = "webViewHistory";
const HISTORY_LIMIT = 50;

async function loadWebViewHistory(noteId) {
    return api.runOnBackend((noteId, title) => {
        const attachment = api.getNote(noteId)?.getAttachmentByTitle(title);
        if (!attachment) return null;

        try {
            const history = JSON.parse(String(attachment.getContent()));
            return Array.isArray(history?.entries) ? history : null;
        } catch {
            return null;
        }
    }, [noteId, HISTORY_ATTACHMENT_TITLE]);
}

async function saveWebViewHistory(noteId, history) {
    return api.runOnBackend((noteId, title, role, content) => {
        const note = api.getNote(noteId);
        if (!note || note.isDeleted) return;
        note.saveAttachment({ title, role, mime: "application/json", content }, "title");
    }, [noteId, HISTORY_ATTACHMENT_TITLE, HISTORY_ATTACHMENT_ROLE, JSON.stringify(history)]);
}

// ---------------------------------------------------------------------------
// Where a page the guest just landed on sits in that stack: the one we are already
// on, a step back or forward along it, or somewhere new, which drops whatever was
// ahead the way a browser does. `settling` is for the first page after the element
// mounts, where a URL anywhere in the stack is where we left off rather than a
// visit. Returns null when nothing about the stack changed.
// ---------------------------------------------------------------------------
function recordHistoryVisit(history, url, title, settling) {
    if (!/^https?:/i.test(url || "")) return null;

    const entries = Array.isArray(history?.entries) ? history.entries : [];
    const index = Number.isInteger(history?.index) ? history.index : entries.length - 1;
    const current = entries[index];

    if (current && current.url === url) {
        if (!title || current.title === title) return null;
        const renamed = entries.slice();
        renamed[index] = { url, title };
        return { entries: renamed, index };
    }

    const step = [index - 1, index + 1].find((candidate) => entries[candidate]?.url === url);
    const known = step !== undefined ? step : (settling ? entries.findIndex((entry) => entry.url === url) : -1);
    if (known >= 0) return { entries, index: known };

    const grown = [...entries.slice(0, index + 1), { url, title: title || url }];
    const overflow = Math.max(0, grown.length - HISTORY_LIMIT);
    return { entries: grown.slice(overflow), index: grown.length - overflow - 1 };
}

// ---------------------------------------------------------------------------
// Guest-page script, injected on every page load, that swallows link clicks and
// reports them to the toolbar. Trilium's <webview> has no preload script, so the
// guest's console is the only channel back to the host; the host's `will-navigate`
// can't be cancelled, hence intercepting the click instead of the navigation.
// A plain click opens the link's note; ctrl/cmd-click and right-click report
// `background`, which files the note without leaving the page. With `everyLink`
// off, a plain click is only taken when the page's own <a> asks for a new tab —
// every other link is left to navigate the page it is on. Re-running the script
// updates that flag; the listeners are only bound the first time.
// ---------------------------------------------------------------------------
const LINK_MESSAGE_PREFIX = "web-preview:link:";

function linkInterceptScript(everyLink) {
    return `(() => {
    const state = window.__webPreviewLinks || (window.__webPreviewLinks = {});
    state.everyLink = ${everyLink ? "true" : "false"};
    if (state.installed) return;
    state.installed = true;
    const anchorOf = (event) => {
        const anchor = event.target && event.target.closest && event.target.closest("a[href]");
        return anchor && /^https?:/i.test(anchor.href) ? anchor : null;
    };
    // A page marks a link as its own new tab with target="_blank", or by naming a
    // frame that doesn't exist, which the browser opens as a new tab as well.
    const wantsNewTab = (anchor) => {
        const target = (anchor.target || "").trim();
        if (!target || target === "_self") return false;
        if (target === "_blank") return true;
        return !window.frames[target];
    };
    const report = (event, anchor, background) => {
        event.preventDefault();
        event.stopPropagation();
        console.log(${JSON.stringify(LINK_MESSAGE_PREFIX)} + JSON.stringify({ url: anchor.href, title: (anchor.textContent || "").trim(), background }));
    };
    document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.shiftKey || event.altKey) return;
        const anchor = anchorOf(event);
        if (!anchor) return;
        const background = event.ctrlKey || event.metaKey;
        if (background || state.everyLink || wantsNewTab(anchor)) report(event, anchor, background);
    }, true);
    document.addEventListener("contextmenu", (event) => {
        if (event.defaultPrevented) return;
        const anchor = anchorOf(event);
        if (anchor) report(event, anchor, true);
    }, true);
})()`;
}

// ---------------------------------------------------------------------------
// Reads one console message from the guest page, returning {url, title, background}
// for a clicked link and null for the page's own console output.
// ---------------------------------------------------------------------------
function parseLinkMessage(message) {
    if (typeof message !== "string" || !message.startsWith(LINK_MESSAGE_PREFIX)) return null;
    try {
        return JSON.parse(message.slice(LINK_MESSAGE_PREFIX.length));
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// What was typed as an address to go straight to, or null when it is a search
// term rather than one. A full URL is taken as it stands; a bare host gets a
// scheme put on it.
// ---------------------------------------------------------------------------
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST_RE = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i;
const BARE_HOST_RE = /^[^\s/?#]+\.[a-z]{2,}(?:[:/?#]|$)/i;

function parseAddress(text) {
    const trimmed = text.trim();
    let url = null;
    if (SCHEME_RE.test(trimmed)) url = trimmed;
    // A bare host or IP is nearly always a server on the LAN, which rarely speaks TLS.
    else if (LOCAL_HOST_RE.test(trimmed)) url = `http://${trimmed}`;
    else if (BARE_HOST_RE.test(trimmed)) url = `https://${trimmed}`;

    return url ? { url, title: hostnameOf(url) } : null;
}

// ---------------------------------------------------------------------------
// What was typed as a search on `urlTemplate`, whose `%s` placeholder receives it
// URL-encoded. Returns null when no template was given, so the caller can say no
// provider is set up.
// ---------------------------------------------------------------------------
function buildSearchTarget(text, urlTemplate) {
    const trimmed = text.trim();
    if (!urlTemplate) return null;
    return { url: urlTemplate.replace(/%s/g, encodeURIComponent(trimmed)), title: trimmed };
}

// ---------------------------------------------------------------------------
// Hostname of a URL, falling back to the URL itself when it can't be parsed.
function hostnameOf(url) {
    try {
        return new URL(url).hostname || url;
    } catch {
        return url;
    }
}

// ---------------------------------------------------------------------------
// SponsorBlock. The lookup itself is shared with youtube-manager@beatlink; what
// belongs here is applying its answer to a page loaded in the <webview>.
// ---------------------------------------------------------------------------
const sponsorBlock = require("libSponsorBlock.js");

// ---------------------------------------------------------------------------
// Guest-page script that seeks the page's <video> past whichever segments the
// host has pushed into it. Injected on every load like the link interceptor,
// and self-guarding so re-injection is harmless. It polls rather than listening
// for timeupdate because YouTube replaces the <video> element between videos.
// ---------------------------------------------------------------------------
const SPONSORBLOCK_SCRIPT = `(() => {
    if (window.__webPreviewSponsorBlock) return;

    const state = { videoId: "", segments: [], notify: true, skipped: new Set() };
    window.__webPreviewSponsorBlock = state;

    state.apply = (next) => {
        state.videoId = next.videoId || "";
        state.segments = next.segments || [];
        state.notify = !!next.notify;
        state.skipped = new Set();
    };

    const LABELS = ${JSON.stringify(sponsorBlock.SPONSORBLOCK_LABELS)};

    function toast(text) {
        let el = document.getElementById("web-preview-sponsorblock-toast");
        if (!el) {
            el = document.createElement("div");
            el.id = "web-preview-sponsorblock-toast";
            el.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:rgba(0,0,0,.85);color:#fff;font:13px sans-serif;padding:8px 12px;border-radius:6px;pointer-events:none;transition:opacity .3s";
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = "1";
        clearTimeout(el.hideTimer);
        el.hideTimer = setTimeout(() => { el.style.opacity = "0"; }, 2500);
    }

    const ID_RE = new RegExp(${JSON.stringify(sponsorBlock.YOUTUBE_ID_RE.source)}, "i");

    setInterval(() => {
        if (state.segments.length === 0) return;
        // Segments fetched for the previous video must never be applied to the one
        // a single-page navigation has already swapped in.
        const match = ID_RE.exec(location.href);
        if (!match || match[1] !== state.videoId) return;

        const video = document.querySelector("video");
        if (!video || video.paused) return;

        for (const segment of state.segments) {
            // A segment is skipped once only, so rewinding into one plays it.
            if (state.skipped.has(segment.uuid)) continue;
            if (video.currentTime < segment.start || video.currentTime >= segment.end - 0.2) continue;
            state.skipped.add(segment.uuid);
            video.currentTime = segment.end;
            if (state.notify) toast("Skipped: " + (LABELS[segment.category] || segment.category));
            break;
        }
    }, 250);
})()`;

// The call that hands the guest script a video's segments.
function sponsorBlockApplyScript(payload) {
    return `window.__webPreviewSponsorBlock && window.__webPreviewSponsorBlock.apply(${JSON.stringify(payload)})`;
}

module.exports = { createWebViewNote, listWebViewNotes, matchWebViewNotes, resolveUserAgent, applyUserAgent, findDuplicateWebViews, mergeWebViewDuplicates, renameNote, resolveSaveParentNoteId, openExternal, resolveLinkParentNoteId, deleteWebViewNote, updateWebViewSrc, loadWebViewHistory, saveWebViewHistory, recordHistoryVisit, linkInterceptScript, parseLinkMessage, parseAddress, buildSearchTarget, SPONSORBLOCK_SCRIPT, sponsorBlockApplyScript };
