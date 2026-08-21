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
        return note.noteId;
    }, [parentNoteId, url, title, reuseExisting]);
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
// Renames a note, skipping the write when the title already matches so that a
// page reporting the same title repeatedly doesn't churn the note's revisions.
// ---------------------------------------------------------------------------
async function renameNote(noteId, title) {
    const trimmed = (title || "").trim();
    if (!trimmed) return;

    const note = await api.getNote(noteId);
    if (!note || note.title === trimmed) return;

    await api.runOnBackend((noteId, title) => {
        const note = api.getNote(noteId);
        note.title = title;
        note.save();
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
// Deletes the Web View note itself, for clearing out saved links once you're
// done with them. Trilium's delete is soft,
// so the note stays recoverable from Recent Changes. The parent is read before
// the delete and activated after, since the tab would otherwise be left sitting
// on a note that no longer exists.
// ---------------------------------------------------------------------------
async function deleteWebViewNote(noteId) {
    const note = await api.getNote(noteId);
    const parentNoteId = note?.getParentNoteIds()[0];

    await api.runOnBackend((noteId) => api.getNote(noteId).deleteNote(), [noteId]);

    if (parentNoteId) await api.activateNote(parentNoteId);
}

// ---------------------------------------------------------------------------
// Guest-page script, injected on every page load, that swallows link clicks and
// reports them to the toolbar. Trilium's <webview> has no preload script, so the
// guest's console is the only channel back to the host; the host's `will-navigate`
// can't be cancelled, hence intercepting the click instead of the navigation.
// ---------------------------------------------------------------------------
const LINK_MESSAGE_PREFIX = "web-preview:link:";

const LINK_INTERCEPT_SCRIPT = `(() => {
    if (window.__webPreviewLinkIntercept) return;
    window.__webPreviewLinkIntercept = true;
    document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const anchor = event.target && event.target.closest && event.target.closest("a[href]");
        if (!anchor || !/^https?:/i.test(anchor.href)) return;
        event.preventDefault();
        event.stopPropagation();
        console.log(${JSON.stringify(LINK_MESSAGE_PREFIX)} + JSON.stringify({ url: anchor.href, title: (anchor.textContent || "").trim() }));
    }, true);
})()`;

// ---------------------------------------------------------------------------
// Reads one console message from the guest page, returning {url, title} for a
// clicked link and null for the page's own console output.
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
// Turns what was typed into the New Tab box into the URL to open and a note title.
// A full URL or a bare host goes straight there; anything else is a query for
// `urlTemplate`, whose `%s` placeholder receives it URL-encoded. Returns null for
// a query when no template was given, so the caller can say no provider is set up.
// ---------------------------------------------------------------------------
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST_RE = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i;
const BARE_HOST_RE = /^[^\s/?#]+\.[a-z]{2,}(?:[:/?#]|$)/i;

function buildNewTabTarget(text, urlTemplate) {
    const trimmed = text.trim();
    let url = null;
    if (SCHEME_RE.test(trimmed)) url = trimmed;
    // A bare host or IP is nearly always a server on the LAN, which rarely speaks TLS.
    else if (LOCAL_HOST_RE.test(trimmed)) url = `http://${trimmed}`;
    else if (BARE_HOST_RE.test(trimmed)) url = `https://${trimmed}`;

    if (url) return { url, title: hostnameOf(url) };
    if (!urlTemplate) return null;
    return { url: urlTemplate.replace(/%s/g, encodeURIComponent(trimmed)), title: trimmed };
}

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

module.exports = { createWebViewNote, findDuplicateWebViews, mergeWebViewDuplicates, renameNote, resolveSaveParentNoteId, openExternal, deleteWebViewNote, LINK_INTERCEPT_SCRIPT, parseLinkMessage, buildNewTabTarget, SPONSORBLOCK_SCRIPT, sponsorBlockApplyScript };
